import { DARKWEB_EXTRAS, DEFAULTS, PROGRAMS } from "/src/lib/constants.js";
import { selectProgramsToBuy } from "/src/lib/programs.js";
import { planPurchases } from "/src/lib/purchasing.js";
import { formatMoney, tlog } from "/src/lib/utils.js";

// Buys the TOR router and every darkweb program the budget reaches. See
// docs/API-COVERAGE-AUDIT.md §5.1 — rooter.js can only open as many ports as it has
// programs, and until now those were bought by hand, so root coverage stalled behind
// manual shopping.
//
//   run /src/tools/program-buyer.js          buy what the budget allows
//   run /src/tools/program-buyer.js dry      report what it would buy, buy nothing
//
// ONE-SHOT: does its job and exits. The daemon re-runs it every ~5 min (see MANAGERS
// `oneShot` in constants.js), so it must stay idempotent — the fileExists filter is what
// makes repeat runs no-ops.
//
// RAM, and why it is a one-shot rather than a manager. Singularity costs are multiplied
// 16/4/1 by Source-File 4 level:
//                              base    SF4.1    SF4.2   SF4.3
//   script base                1.6      1.6      1.6     1.6
//   ns.hasTorRouter            0.05     0.05     0.05    0.05   (top-level NS: NOT multiplied)
//   ns.fileExists              0.1      0.1      0.1     0.1
//   ns.getPlayer               0.5      0.5      0.5     0.5
//   singularity.purchaseTor    2       32        8       2
//   singularity.purchaseProgram 2      32        8       2
//   singularity.getDarkwebProgramCost 0.5  8     2       0.5
//                                   ─────────────────────────
//                                     74.25    20.25    6.75
// Holding 74 GB permanently for a job that finishes after seven purchases would cost more
// than DEFAULTS.reservedHomeRAM protects for the whole botnet.

/** @param {NS} ns */
export async function main(ns) {
  const dryRun = String(ns.args[0] ?? "").toLowerCase() === "dry";

  // hasTorRouter is the cheap gate (0.05 GB, unmultiplied). Checking via
  // getDarkwebPrograms() instead would cost 16 GB at SF4.1 for the same answer.
  if (!ns.hasTorRouter()) {
    if (dryRun) {
      tlog(ns, "program-buyer: no TOR router — would buy it first");
      return;
    }
    if (!ns.singularity.purchaseTor()) {
      tlog(ns, "program-buyer: can't afford the TOR router yet");
      return;
    }
    tlog(ns, "program-buyer: bought the TOR router");
  }

  // Port openers first (they unblock rooting), then the subsystem unlocks.
  const catalog = [...PROGRAMS.map((p) => p.name), ...DARKWEB_EXTRAS];
  const owned = catalog.filter((name) => ns.fileExists(name, "home"));
  const wanted = selectProgramsToBuy(catalog, owned);

  if (wanted.length === 0) {
    tlog(ns, "program-buyer: every darkweb program already owned");
    return;
  }

  // getDarkwebProgramCost throws for a name this BitNode's darkweb doesn't stock, and
  // returns -1 when it isn't purchasable — planPurchases skips negatives, so an absent
  // DarkscapeNavigator.exe costs us a skipped row rather than a failed run.
  /** @type {{name: ProgramName, cost: number}[]} */
  const items = [];
  for (const name of wanted) {
    try {
      items.push({ name, cost: ns.singularity.getDarkwebProgramCost(name) });
    } catch {
      // not sold here
    }
  }

  const money = ns.getPlayer().money;
  const plan = planPurchases({
    money,
    reserveFraction: 1 - DEFAULTS.programBudgetPercent,
    items,
  });

  if (plan.buy.length === 0) {
    const cheapest = items.filter((i) => i.cost >= 0).sort((a, b) => a.cost - b.cost)[0];
    tlog(
      ns,
      `program-buyer: ${wanted.length} program(s) left, none within budget` +
        (cheapest ? ` (cheapest ${cheapest.name} at ${formatMoney(cheapest.cost)})` : "")
    );
    return;
  }

  if (dryRun) {
    tlog(ns, `program-buyer: would buy ${plan.buy.length} for ${formatMoney(plan.spend)}`);
    for (const item of plan.buy) ns.tprint(`    ${item.name} — ${formatMoney(item.cost)}`);
    return;
  }

  let bought = 0;
  for (const item of plan.buy) {
    if (ns.singularity.purchaseProgram(item.name)) {
      bought++;
      tlog(ns, `program-buyer: bought ${item.name} for ${formatMoney(item.cost)}`);
    }
  }
  tlog(ns, `program-buyer: ${bought}/${plan.buy.length} bought, ${wanted.length - bought} left`);
}
