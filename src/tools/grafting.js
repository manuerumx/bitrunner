import { PORTS } from "/src/lib/constants.js";
import { GRAFT_HACKING_ONLY_FILE, pickNextGraft, selectGraftTargets } from "/src/lib/grafting.js";
import { readPortData, writePortData } from "/src/lib/port-registry.js";
import { formatMoney, formatTime, tlog } from "/src/lib/utils.js";

// Grafts augmentations at VitaLife in New Tokyo. See docs/API-COVERAGE-AUDIT.md §5.11.
//
//   run /src/tools/grafting.js              list what you can afford to graft
//   run /src/tools/grafting.js graft        graft the cheapest affordable augmentation
//   run /src/tools/grafting.js graft <name> graft a specific augmentation (exact name)
//   run /src/tools/grafting.js queue        graft one after another, cheapest first, until
//                                           nothing fits or you start other work
//       --skip-hacking   leave out augmentations that only boost hacking/hacknet (worthless
//                        in BitNode-8). Runs graft-stats-worker.js once to find them.
//       --max-share 0.25 most of net worth one graft may cost (default 0.25)
//
// Queue mode and the BN8 stock trader: advanced/stock-trader-bn8.js stays fully invested,
// so cash alone never covers a graft. The queue sizes grafts against the net worth the
// trader publishes on PORTS.STOCK_STATUS, then posts a CashRequest on PORTS.CASH_REQUEST
// and refreshes it until the trader has sold enough to cover it. Without the trader running
// the queue just waits for cash to accumulate, and says so.
//
// MANUAL ON PURPOSE — this is not a daemon manager, for the same reason
// augmentation-buyer.js isn't: grafting takes over the player.
//
//   * graftAugmentation() cancels whatever you are currently doing.
//   * faction-manager.js calls workForFaction() every 30 s, which would cancel the graft
//     right back. It now leaves an in-progress graft alone (it checks getCurrentWork() for
//     type "GRAFTING"), so the two no longer fight — but if you have disabled that guard or
//     are running some other work loop, stop it first:
//         run /src/tools/manager-toggle.js disable faction
//
// Why it matters: grafting buys an augmentation for money alone, with no faction
// reputation required. That is the exact constraint faction-manager.js spends its whole
// cycle grinding against.
//
// RAM (only travelToCity carries the Singularity ×16/×4/×1 multiplier):
//                                        base   SF4.1   SF4.2  SF4.3
//   script base                           1.6     1.6     1.6    1.6
//   grafting.getGraftableAugmentations    5       5       5      5
//   grafting.getAugmentationGraftPrice    3.75    3.75    3.75   3.75
//   grafting.getAugmentationGraftTime     3.75    3.75    3.75   3.75
//   grafting.graftAugmentation            7.5     7.5     7.5    7.5
//   grafting.waitForOngoingGrafting       0       0       0      0
//   ns.getPlayer                          0.5     0.5     0.5    0.5
//   singularity.travelToCity              2      32       8      2
//   ns.run + ns.isRunning (queue)         1.1     1.1     1.1    1.1
//                                             ────────────────────────
//                                              55.2    31.2   25.2
// graft-stats-worker.js runs separately, once: 1.6 + 5 × 16/4/1 GB (81.6 / 21.6 / 6.6).

const VITALIFE_CITY = "New Tokyo";
const STATS_WORKER = "/src/tools/graft-stats-worker.js";
// The flight to New Tokyo; graftAugmentation needs it on top of the price.
const TRAVEL_COST = 200_000;
// How often the queue refreshes its cash request. The trader drops a request it hasn't
// seen refreshed in 30 s, so this keeps it alive with margin to spare.
const REQUEST_REFRESH_MS = 3_000;
// Trader status older than this means the trader isn't running.
const STATUS_MAX_AGE_MS = 30_000;

/** @param {NS} ns */
function hasGraftingAPI(ns) {
  try {
    ns.grafting.getGraftableAugmentations();
    return true;
  } catch {
    return false;
  }
}

/** @param {NS} ns */
export async function main(ns) {
  if (!hasGraftingAPI(ns)) {
    ns.tprint("Grafting API required (Source-File 10) — the same SF that unlocks sleeves.");
    return;
  }

  const args = ns.args.map(String);
  if (args[0]?.toLowerCase() === "queue") return runQueue(ns);
  const doGraft = args[0]?.toLowerCase() === "graft";
  const wanted = doGraft ? args.slice(1).join(" ") : "";

  const money = ns.getPlayer().money;

  // getGraftableAugmentations() already filters out augmentations you own. It does NOT
  // filter on money or prerequisites — selectGraftTargets handles money, and an unmet
  // prerequisite just makes graftAugmentation() return false.
  const candidates = ns.grafting.getGraftableAugmentations().map((name) => ({
    name,
    price: ns.grafting.getAugmentationGraftPrice(name),
    time: ns.grafting.getAugmentationGraftTime(name),
  }));

  const affordable = selectGraftTargets(candidates, { money });

  if (!doGraft) {
    ns.tprint(`\n=== Graftable now — ${formatMoney(money)} available ===`);
    if (affordable.length === 0) {
      const cheapest = candidates.sort((a, b) => a.price - b.price)[0];
      ns.tprint("  Nothing affordable yet.");
      if (cheapest) ns.tprint(`  Cheapest: ${cheapest.name} at ${formatMoney(cheapest.price)}`);
      return;
    }
    for (const c of affordable) {
      ns.tprint(`  ${c.name} — ${formatMoney(c.price)}, ${formatTime(c.time)}`);
    }
    ns.tprint(`\n${affordable.length} affordable. Graft the cheapest with:`);
    ns.tprint("  run /src/tools/grafting.js graft");
    ns.tprint("Grafting needs no faction reputation — only money and time.");
    return;
  }

  const target = wanted
    ? candidates.find((c) => c.name.toLowerCase() === wanted.toLowerCase())
    : affordable[0];

  if (!target) {
    ns.tprint(wanted ? `No graftable augmentation named "${wanted}".` : "Nothing affordable to graft.");
    return;
  }
  if (target.price > money) {
    ns.tprint(`${target.name} costs ${formatMoney(target.price)}; you have ${formatMoney(money)}.`);
    return;
  }

  // graftAugmentation throws outright if you are not in New Tokyo.
  if (!ns.singularity.travelToCity(VITALIFE_CITY)) {
    ns.tprint(`Could not travel to ${VITALIFE_CITY} (need $200k for the flight).`);
    return;
  }

  if (!ns.grafting.graftAugmentation(target.name, true)) {
    ns.tprint(`Grafting ${target.name} was refused — usually an unmet prerequisite augmentation.`);
    return;
  }

  tlog(ns, `Grafting ${target.name} (${formatMoney(target.price)}, ~${formatTime(target.time)})`);
  ns.tprint("Leave this running — cancelling the script does not cancel the graft, but");
  ns.tprint("starting other work will. The faction manager knows to leave it alone.");

  // 0 GB, and it accounts for intelligence and focus bonuses that getAugmentationGraftTime
  // does not — so this is the only accurate way to know when the graft actually finished.
  await ns.grafting.waitForOngoingGrafting();
  tlog(ns, `Grafting finished: ${target.name}`);
}

/**
 * Graft one augmentation after another until nothing fits the budget or the player starts
 * other work. See the header for how it gets cash out of the BN8 stock trader.
 *
 * @param {NS} ns
 */
async function runQueue(ns) {
  ns.disableLog("ALL");
  const flags = ns.flags([
    ["skip-hacking", false],
    ["max-share", 0.25],
  ]);
  const maxShare = Number(flags["max-share"]);

  /** @type {Set<string>} */
  const skip = new Set();
  if (flags["skip-hacking"]) {
    for (const name of await hackingOnlyAugs(ns)) skip.add(name);
    tlog(ns, `Queue: skipping ${skip.size} hacking/hacknet-only augmentations`);
  }

  // Never leave a request behind: the trader would hold that cash back for 30 s more.
  ns.atExit(() => ns.clearPort(PORTS.CASH_REQUEST));

  // A graft already running (e.g. this script was restarted) finishes first.
  try {
    await ns.grafting.waitForOngoingGrafting();
  } catch {
    // The player is doing other work. graftAugmentation() will cancel it, as single mode does.
  }

  let warnedNoTrader = false;
  while (true) {
    const candidates = ns.grafting.getGraftableAugmentations().map((name) => ({
      name,
      price: ns.grafting.getAugmentationGraftPrice(name),
      time: ns.grafting.getAugmentationGraftTime(name),
    }));
    const status = /** @type {StockStatus | null} */ (readPortData(ns, PORTS.STOCK_STATUS));
    const traderUp = status !== null && Date.now() - status.updatedAt <= STATUS_MAX_AGE_MS;
    const netWorth = traderUp ? status.netWorth : ns.getPlayer().money;

    const target = pickNextGraft(candidates, { netWorth, maxShare, skip });
    if (!target) {
      tlog(ns, `Queue done: nothing left costs under ${formatMoney(netWorth * maxShare)} (${(maxShare * 100).toFixed(0)}% of ${formatMoney(netWorth)}).`);
      return;
    }

    // Wait for the cash, keeping the request alive so the trader sells to cover it.
    const need = target.price + TRAVEL_COST;
    tlog(ns, `Queue: next is ${target.name} (${formatMoney(target.price)}, ~${formatTime(target.time)})`);
    while (ns.getPlayer().money < need) {
      writePortData(ns, PORTS.CASH_REQUEST, /** @type {CashRequest} */ ({
        requester: "grafting",
        amount: need,
        updatedAt: Date.now(),
      }));
      const s = /** @type {StockStatus | null} */ (readPortData(ns, PORTS.STOCK_STATUS));
      if (!warnedNoTrader && (s === null || Date.now() - s.updatedAt > STATUS_MAX_AGE_MS)) {
        tlog(ns, "Queue: stock-trader-bn8.js isn't running, so nothing will sell to cover this — waiting for cash.");
        warnedNoTrader = true;
      }
      await ns.sleep(REQUEST_REFRESH_MS);
    }
    ns.clearPort(PORTS.CASH_REQUEST);

    if (!ns.singularity.travelToCity(VITALIFE_CITY)) {
      tlog(ns, `Queue stopped: could not travel to ${VITALIFE_CITY}.`);
      return;
    }
    if (!ns.grafting.graftAugmentation(target.name, true)) {
      // Almost always an unmet prerequisite; move on rather than retry it forever.
      tlog(ns, `Queue: ${target.name} was refused (likely an unmet prerequisite) — skipping it.`);
      skip.add(target.name);
      continue;
    }

    tlog(ns, `Grafting ${target.name}`);
    await ns.grafting.waitForOngoingGrafting();

    // The promise also resolves on cancellation. A finished graft is owned, so it drops off
    // the graftable list; one still on it was cancelled — the player started other work,
    // and grafting over it would undo whatever they chose to do.
    if (ns.grafting.getGraftableAugmentations().includes(target.name)) {
      tlog(ns, `Queue stopped: ${target.name} was cancelled (other work started).`);
      return;
    }
    tlog(ns, `Grafting finished: ${target.name}`);
  }
}

/**
 * Names of graftable augmentations that only boost hacking/hacknet, via the one-shot
 * worker so this script doesn't carry getAugmentationStats' RAM for its whole run.
 *
 * @param {NS} ns
 * @returns {Promise<string[]>}
 */
async function hackingOnlyAugs(ns) {
  const pid = ns.run(STATS_WORKER, 1, ...ns.grafting.getGraftableAugmentations());
  if (pid === 0) {
    tlog(ns, `Queue: could not start ${STATS_WORKER} (not enough free RAM?) — grafting without --skip-hacking.`);
    return [];
  }
  while (ns.isRunning(pid)) await ns.sleep(200);
  try {
    const names = JSON.parse(ns.read(GRAFT_HACKING_ONLY_FILE));
    return Array.isArray(names) ? names.map(String) : [];
  } catch {
    return [];
  }
}
