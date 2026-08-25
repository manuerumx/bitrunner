import { KNOWN_CRIMES, GANG_KARMA_REQUIREMENT, rankCrimes } from "/src/lib/crime.js";
import { hasFormulas } from "/src/lib/formulas.js";
import { formatMoney, formatRAM, formatTime, tlog } from "/src/lib/utils.js";

// Crime report and launcher. Fills the "no crime" Singularity gap in
// docs/API-COVERAGE-AUDIT.md §2.
//
//   run /src/tools/crime.js                 rank every crime by expected $/sec, and read
//                                           this BitNode's multipliers to say whether
//                                           crime money is worth chasing here at all
//   run /src/tools/crime.js start           start the crime loop, ranking on money
//   run /src/tools/crime.js start karma     rank on karma/sec instead (gang unlock)
//   run /src/tools/crime.js start --nofocus don't take UI focus
//   run /src/tools/crime.js stop            stop the loop and release the player
//
// The report is deliberately SEPARATE from tools/crime-worker.js and cheap (~9 GB flat, no
// Singularity calls at all). The worker costs 106 GB at SF4.1. Splitting them means the
// BitNode read — the part that tells you whether to bother — always runs, even when the
// loop itself will not fit in home RAM.

const WORKER = "/src/tools/crime-worker.js";

/**
 * The running crime worker, whatever arguments it was launched with, or null.
 *
 * NOT ns.isRunning: a script is keyed by filename PLUS arguments
 * (NetscriptDefinitions.d.ts:8367), so isRunning(WORKER, "home") only matches a
 * zero-argument launch — `start karma` and `start --nofocus` would both read as "not
 * running", letting `stop` kill nothing and `start` double-launch. ns.ps matches on
 * filename alone, and hands back the pid that ns.kill(pid) needs.
 *
 * @param {NS} ns
 */
function findWorker(ns) {
  return ns.ps("home").find((proc) => proc.filename === WORKER) ?? null;
}

/**
 * Source-File 4 level, and whether Singularity is usable at all.
 * Free: getResetInfo is already paid for by the BitNode report, and its ownedSF map
 * answers this without a 5 GB getOwnedSourceFiles call.
 * @param {NS} ns
 */
function singularityAccess(ns) {
  const info = ns.getResetInfo();
  const sf4 = info.ownedSF.get(4) ?? 0;
  // Inside BitNode 4 the Singularity API is free and unmultiplied regardless of SF level.
  return { node: info.currentNode, sf4, available: sf4 > 0 || info.currentNode === 4 };
}

/**
 * The levers crime money competes against, straight from the running BitNode.
 *
 * Read live rather than hardcoded per BitNode: these are the numbers that decide whether
 * crime income should be spent on servers, hacknet, or augmentations, and a remembered
 * table would be a guess about the player's actual game. getBitNodeMultipliers needs
 * BitNode 5 or Source-File 5 — which is exactly where this question gets asked.
 */
const LEVERS = [
  ["CrimeMoney", "crime payouts (this script's income)"],
  ["ScriptHackMoney", "money your HWGW botnet steals — what botnet RAM buys"],
  ["HacknetNodeMoney", "hacknet node production — what hacknet upgrades buy"],
  ["AugmentationMoneyCost", "augmentation prices (higher = worse)"],
  ["ServerMaxMoney", "money ceiling on hackable servers"],
];

/** @param {NS} ns */
function reportBitNode(ns) {
  const { node } = singularityAccess(ns);
  ns.tprint(`\n=== BitNode ${node} — where money is worth earning and spending ===`);

  let mults = null;
  try {
    mults = ns.getBitNodeMultipliers();
  } catch {
    ns.tprint("  getBitNodeMultipliers needs BitNode 5 or Source-File 5 — skipping.");
    return null;
  }

  for (const [key, label] of LEVERS) {
    const value = mults[key];
    const verdict = value > 1.05 ? "BOOSTED" : value < 0.95 ? "NERFED" : "normal";
    ns.tprint(`  ${key.padEnd(22)} ${`x${value}`.padEnd(8)} ${verdict.padEnd(8)} ${label}`);
  }

  // The comparison that actually decides where crime money should go. Both are money the
  // suite can earn per unit of investment, and in some BitNodes the ranking inverts.
  const { CrimeMoney, ScriptHackMoney, HacknetNodeMoney } = mults;
  ns.tprint("");
  if (CrimeMoney > ScriptHackMoney) {
    ns.tprint(
      `  Crime money (x${CrimeMoney}) is scaled better than script hacking (x${ScriptHackMoney}) here, so`
    );
    ns.tprint("  crime is a real income source, not just a stat/karma grind.");
  } else {
    ns.tprint(
      `  Script hacking (x${ScriptHackMoney}) is scaled at least as well as crime (x${CrimeMoney}) here.`
    );
    ns.tprint("  Crime is then mainly worth running for combat stats and karma, not income.");
  }
  if (HacknetNodeMoney < 0.5) {
    ns.tprint(
      `  Hacknet is at x${HacknetNodeMoney} — spending crime money on hacknet upgrades pays back`
    );
    ns.tprint("    poorly here unless you have Source-File 9 and are buying hashes, not cash.");
  }
  if (ScriptHackMoney < 0.5) {
    ns.tprint(
      `  Botnet RAM is at x${ScriptHackMoney} — every purchased server returns a fraction of its`
    );
    ns.tprint("    usual income, so expanding the botnet is a weaker sink than it looks.");
  }
  if (mults.AugmentationMoneyCost > 1) {
    ns.tprint(`  Augmentations cost x${mults.AugmentationMoneyCost} here — budget accordingly.`);
  }
  return mults;
}

/**
 * Print what the worker will cost against what home actually has.
 * getScriptRam reports the real static cost, Source-File 4 multiplier already applied —
 * no need to guess which SF4 level is active.
 * @param {NS} ns
 */
function reportWorkerRAM(ns) {
  const need = ns.getScriptRam(WORKER, "home");
  const free = ns.getServerMaxRam("home") - ns.getServerUsedRam("home");
  const { sf4, node, available } = singularityAccess(ns);

  ns.tprint(`\n=== Crime loop cost ===`);
  if (need === 0) {
    ns.tprint(`  ${WORKER} not found on home — sync it before starting.`);
    return false;
  }

  // Checked BEFORE the RAM verdict: without Singularity the worker still reserves its full
  // allocation, starts, throws on the first getCurrentWork() and exits. Reporting "it fits"
  // and then watching it die on launch is the worse of the two failures.
  if (!available) {
    ns.tprint("  Source-File 4 required — ns.singularity is unavailable outside BitNode 4 without it.");
    ns.tprint(`  You are in BitNode ${node} with no SF-4, so commitCrime() cannot be called at all.`);
    return false;
  }

  // Inside BitNode 4 the API is unmultiplied whatever your SF-4 level is, so the ladder
  // only applies outside it.
  const multiplier = node === 4 || sf4 >= 3 ? 1 : sf4 === 2 ? 4 : 16;
  const level = node === 4 ? `in BitNode 4 (SF-4 level ${sf4} not needed here)` : `level ${sf4}`;
  ns.tprint(`  Source-File 4 ${level} — Singularity calls cost x${multiplier}.`);
  ns.tprint(`  Needs ${formatRAM(need)}, home has ${formatRAM(free)} free.`);
  if (need > free) {
    ns.tprint("  WON'T FIT. Options, cheapest first:");
    ns.tprint("    * run /src/tools/manager-toggle.js disable <id>   free a manager's RAM");
    ns.tprint("    * run /src/tools/home-upgrader.js                 buy more home RAM");
    ns.tprint("    * a higher Source-File 4 level cuts every Singularity call 16x -> 4x -> 1x");
    return false;
  }
  return true;
}

/** @param {NS} ns */
function reportRanking(ns) {
  if (!hasFormulas(ns)) {
    ns.tprint("\n=== Crime ranking ===");
    ns.tprint("  Formulas.exe not owned — no success chances available at any RAM price,");
    ns.tprint("  so the worker falls back to a stat ladder (Mug, then Homicide).");
    ns.tprint("  run /src/tools/program-buyer.js to buy it; the ranking below needs it.");
    return;
  }

  const player = ns.getPlayer();
  const candidates = KNOWN_CRIMES.map((name) => ({
    name,
    money: ns.formulas.work.crimeGains(player, name).money,
    chance: ns.formulas.work.crimeSuccessChance(player, name),
  }));

  for (const goal of /** @type {const} */ (["money", "karma"])) {
    const ranked = rankCrimes(candidates, { goal });
    const unit = goal === "money" ? "$/sec" : "karma/sec";
    ns.tprint(`\n=== Best crimes by ${unit} ===`);
    for (const c of ranked.slice(0, 5)) {
      const rate = goal === "money" ? formatMoney(c.perSecond) : c.perSecond.toFixed(2);
      ns.tprint(
        `  ${c.name.padEnd(18)} ${String(rate).padStart(10)}/s  ` +
          `${(c.chance * 100).toFixed(0)}% chance, ${formatTime(c.timeMs)}, ${formatMoney(c.money)}/attempt`
      );
    }
  }

  const karmaToGang = player.karma - GANG_KARMA_REQUIREMENT;
  ns.tprint(`\n  Karma ${player.karma.toFixed(0)} — ${karmaToGang.toFixed(0)} short of a gang (${GANG_KARMA_REQUIREMENT}).`);
}

/** @param {NS} ns */
export async function main(ns) {
  const args = ns.args.map(String);
  const cmd = (args[0] ?? "").toLowerCase();

  if (cmd === "stop") {
    const proc = findWorker(ns);
    if (!proc) {
      ns.tprint("Crime loop is not running.");
      return;
    }
    // Killed by PID, because the worker may have been launched with arguments that a
    // filename+args kill would fail to match. The worker's ns.atExit calls
    // singularity.stopAction, so this releases the player rather than leaving the crime
    // running with nothing supervising it.
    ns.kill(proc.pid);
    tlog(ns, "Crime loop stopped — player released, faction manager resumes next cycle.");
    return;
  }

  if (cmd === "start") {
    if (findWorker(ns)) {
      ns.tprint("Crime loop already running. Stop it first: run /src/tools/crime.js stop");
      return;
    }
    if (!reportWorkerRAM(ns)) return;

    const workerArgs = args.slice(1);
    if (ns.exec(WORKER, "home", 1, ...workerArgs) === 0) {
      ns.tprint("Could not start the crime loop — see above for the RAM check.");
      return;
    }
    tlog(ns, `Crime loop started (${workerArgs.join(" ") || "money"}). tail it for live rates.`);
    ns.tprint("NOTE: faction reputation stops accumulating while this runs. Stop it with:");
    ns.tprint("  run /src/tools/crime.js stop");
    return;
  }

  reportBitNode(ns);
  reportWorkerRAM(ns);
  reportRanking(ns);

  ns.tprint("\n  run /src/tools/crime.js start        commit crimes for money");
  ns.tprint("  run /src/tools/crime.js start karma  commit crimes for karma (gang unlock)");
}
