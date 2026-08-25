import {
  CRIME_TIME_MS,
  GANG_KARMA_REQUIREMENT,
  KNOWN_CRIMES,
  fallbackCrime,
  needsRecommit,
  rankCrimes,
  selectNextCrime,
} from "/src/lib/crime.js";
import { hasFormulas } from "/src/lib/formulas.js";
import { formatMoney, formatTime, log } from "/src/lib/utils.js";

// The crime loop. Launched and stopped by tools/crime.js — run that first, it prints the
// BitNode read that tells you whether crime is even the right lever here.
//
//   run /src/tools/crime-worker.js [money|karma] [--nofocus]
//
// NOT A DAEMON MANAGER, for exactly the reason tools/grafting.js isn't: this takes over
// the player. advanced/faction-manager.js calls workForFaction() every 30 s, which cancels
// a crime outright — it now yields while this worker is running (it checks ns.isRunning on
// this script). The consequence is stated plainly: WHILE THIS RUNS, FACTION REPUTATION
// STOPS ACCUMULATING. That is the trade. Stop the worker and the rep grind resumes on the
// faction manager's next cycle.
//
// WHY THIS IS A RECONCILER, NOT A `while (true) { commitCrime() }` LOOP. A player crime is
// a CrimeTask extending PlayerBaseTask — it accrues `cyclesWorked` toward a payout.
// Re-issuing commitCrime() resets that counter, so the naive loop everyone posts cancels
// its own crime on every iteration and can bank nothing. This checks getCurrentWork() and
// only calls commitCrime when the crime that SHOULD be running isn't. That is correct
// whether player crimes auto-repeat (it never interrupts) or resolve once (getCurrentWork
// reads null and it re-issues), which is why it is written this way rather than tuned to
// one of the two. Same trap needsReassignment() guards sleeves against in
// advanced/sleeve-manager.js.
//
// RAM (every singularity call carries the ×16/×4/×1 Source-File 4 multiplier):
//                                        base   SF4.1   SF4.2  SF4.3
//   script base                           1.6     1.6     1.6    1.6
//   ns.getPlayer                          0.5     0.5     0.5    0.5
//   ns.fileExists (hasFormulas)           0.1     0.1     0.1    0.1
//   ns.formulas.work.*                    0       0       0      0
//   singularity.getCurrentWork            0.5     8       2      0.5
//   singularity.commitCrime               5      80      20      5
//   singularity.stopAction                1      16       4      1
//                                             ────────────────────────
//                                             106.2    28.2    8.7
// Those totals are hand-summed from the table above. `run /src/tools/crime.js` prints the
// MEASURED cost (ns.getScriptRam) against free home RAM — trust that one if they disagree.
// At SF4.1 that is a big bite out of home. If it will not fit, delete the ns.atExit block
// below to save 16 GB — you lose only the automatic release of the player on exit, which
// the faction manager's next workForFaction() would do anyway.

const CYCLE_MS = 5_000;

/**
 * Crime that should be running right now.
 *
 * Formulas.exe gives exact per-crime money and success chance for 0 GB, which is what
 * makes real expected-value arithmetic affordable here at all. Without it there is no way
 * to get a success chance at any price this script can pay, so it drops to a stat ladder —
 * the same degradation lib/gang.js makes in legacyBestTask.
 *
 * @param {NS} ns
 * @param {Player} player
 * @param {"money" | "karma"} goal
 * @param {string | null} currentCrime
 * @param {boolean} useFormulas
 */
function pickCrime(ns, player, goal, currentCrime, useFormulas) {
  if (!useFormulas) return fallbackCrime(player.skills, { goal });

  const candidates = KNOWN_CRIMES.map((name) => ({
    name,
    money: ns.formulas.work.crimeGains(player, name).money,
    chance: ns.formulas.work.crimeSuccessChance(player, name),
  }));

  return selectNextCrime(rankCrimes(candidates, { goal }), currentCrime);
}

/** @param {NS} ns */
export async function main(ns) {
  ns.disableLog("ALL");

  const args = ns.args.map(String);
  const goal = args.includes("karma") ? "karma" : "money";
  // commitCrime's own default is focus=true, and that is kept: crime is a full takeover
  // either way, and an unfocused work penalty applies unless you own the Neuroreceptor
  // Management Implant. --nofocus is there for when you would rather keep clicking around
  // the UI and accept whatever that costs.
  const focus = !args.includes("--nofocus");

  const useFormulas = hasFormulas(ns);
  if (!useFormulas) {
    log(ns, "Formulas.exe not owned — falling back to a stat ladder. No success chances,");
    log(ns, "so no expected-value ranking. tools/program-buyer.js buys the file.");
  }

  // Killing this script releases the player. Without it the crime keeps running after the
  // worker is gone, which reads as the suite being stuck on crime forever.
  ns.atExit(() => {
    try {
      ns.singularity.stopAction();
    } catch {}
  });

  const startMoney = ns.getPlayer().money;
  const startKarma = ns.getPlayer().karma;
  const startedAt = Date.now();
  let lastCrime = null;

  log(ns, `Crime worker started — goal: ${goal}, focus: ${focus}`);

  while (true) {
    const player = ns.getPlayer();

    // Read the live work FIRST: it supplies the crime that selectNextCrime measures its
    // switch margin against, so the worker never abandons a running crime for one that is
    // only marginally better and never banks anything.
    let currentWork = null;
    try {
      currentWork = ns.singularity.getCurrentWork();
    } catch {
      log(ns, "ERROR: Singularity API unavailable — Source-File 4 required outside BitNode 4.");
      return;
    }
    const currentCrime = currentWork && currentWork.type === "CRIME" ? currentWork.crimeType : null;

    const desired = pickCrime(ns, player, goal, currentCrime, useFormulas);

    if (desired && needsRecommit(currentWork, desired)) {
      try {
        const actualMs = ns.singularity.commitCrime(desired, focus);

        // commitCrime returns the real duration, so the constant table in lib/crime.js is
        // checked against the running game on every switch rather than trusted. A fork or
        // a rebalance surfaces here as a log line instead of as a silently mis-ranked crime.
        const tableMs = CRIME_TIME_MS[desired];
        if (tableMs !== undefined && Math.abs(actualMs - tableMs) > 1) {
          log(ns, `WARNING: ${desired} takes ${actualMs}ms, lib/crime.js says ${tableMs}ms — ranking is off.`);
        }

        if (desired !== lastCrime) {
          log(ns, `Committing ${desired} (${formatTime(actualMs)}/attempt)`);
          lastCrime = desired;
        }
      } catch (err) {
        log(ns, `ERROR: commitCrime(${desired}) failed: ${err}`);
        return;
      }
    }

    const elapsedSec = Math.max(1, (Date.now() - startedAt) / 1000);
    // WALLET delta, NOT crime income. HWGW, the stock trader and the contract solver are
    // all banking money concurrently, and nothing here can separate their share from
    // crime's. Labelled honestly rather than dressed up as a crime rate — for that, read
    // the formulas-derived $/sec table in `run /src/tools/crime.js`, which is exact.
    const walletDelta = player.money - startMoney;
    // Karma counts DOWN, so progress is how far below the starting value we have got.
    // Karma has no other source while this runs, so its rate IS crime's.
    const karmaGained = startKarma - player.karma;

    ns.print(
      `[${lastCrime}] wallet ${formatMoney(walletDelta)} all sources ` +
        `(${formatMoney(walletDelta / elapsedSec)}/s) | ` +
        `karma ${player.karma.toFixed(0)} (${(karmaGained / elapsedSec).toFixed(2)}/s crime)`
    );

    if (goal === "karma") {
      if (player.karma <= GANG_KARMA_REQUIREMENT) {
        log(ns, `Karma ${player.karma.toFixed(0)} — gang threshold reached.`);
        log(ns, "Create the gang from the Factions screen (Slum Snakes is the usual pick);");
        log(ns, "advanced/gang-manager.js takes over automatically once you are in one.");
        return;
      }
      const remaining = player.karma - GANG_KARMA_REQUIREMENT;
      const rate = karmaGained / elapsedSec;
      const eta = rate > 0 ? formatTime((remaining / rate) * 1000) : "unknown";
      ns.print(`  gang in ${remaining.toFixed(0)} karma — ETA ${eta}`);
    }

    await ns.sleep(CYCLE_MS);
  }
}
