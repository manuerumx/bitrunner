import { DEFAULTS } from "/src/lib/constants.js";
import { planMarketUnlocks } from "/src/lib/market.js";
import { formatMoney, tlog } from "/src/lib/utils.js";

// Buys the World Stock Exchange ladder so stock-trader.js can actually trade. See
// docs/API-COVERAGE-AUDIT.md §5.4 — the trader could never buy its own access, and
// without 4S data its entire buy/sell body was unreachable.
//
//   run /src/tools/market-access.js          climb the ladder as far as the budget goes
//   run /src/tools/market-access.js dry      report the next rung, buy nothing
//
// ONE-SHOT: exits when it can't afford the next rung; the daemon re-runs it every ~5 min.
// Idempotent — the has* probes skip anything already owned.
//
// No Source-File multiplier applies to ns.stock, so this is cheap regardless of SF4 level:
//   script base                                                1.6
//   stock.getConstants                                         0    (prices AND commission)
//   hasWseAccount / hasTixApiAccess / has4SData / has4SDataTixApi  0.2  (4 × 0.05)
//   purchaseWseAccount / purchaseTixApi / purchase4SMarketData /
//     purchase4SMarketDataTixApi                              10.0  (4 × 2.5)
//   ns.getPlayer                                               0.5
//                                                            ─────
//                                                             12.3 GB

/** @param {NS} ns */
export async function main(ns) {
  const dryRun = String(ns.args[0] ?? "").toLowerCase() === "dry";

  // getConstants is 0 GB and carries all four prices — no hardcoded costs needed.
  const costs = ns.stock.getConstants();
  const has = {
    wse: ns.stock.hasWseAccount(),
    tixApi: ns.stock.hasTixApiAccess(),
    fourS: ns.stock.has4SData(),
    fourSTixApi: ns.stock.has4SDataTixApi(),
  };

  const plan = planMarketUnlocks({
    has,
    costs,
    money: ns.getPlayer().money,
    reserveFraction: 1 - DEFAULTS.marketAccessBudgetPercent,
  });

  if (plan.buy.length === 0) {
    const owned = Object.values(has).filter(Boolean).length;
    tlog(
      ns,
      owned === 4
        ? "market-access: full WSE + TIX + 4S access already owned"
        : `market-access: ${owned}/4 unlocks owned, next rung out of budget`
    );
    return;
  }

  if (dryRun) {
    tlog(ns, `market-access: would buy ${plan.buy.length} for ${formatMoney(plan.spend)}`);
    for (const rung of plan.buy) ns.tprint(`    ${rung.label} — ${formatMoney(rung.cost)}`);
    return;
  }

  // Ladder order matters: each purchase is a prerequisite for the next.
  for (const rung of plan.buy) {
    let ok = false;
    if (rung.name === "wse") ok = ns.stock.purchaseWseAccount();
    else if (rung.name === "tixApi") ok = ns.stock.purchaseTixApi();
    else if (rung.name === "fourS") ok = ns.stock.purchase4SMarketData();
    else if (rung.name === "fourSTixApi") ok = ns.stock.purchase4SMarketDataTixApi();

    if (!ok) {
      tlog(ns, `market-access: ${rung.label} purchase rejected — stopping here`);
      return;
    }
    tlog(ns, `market-access: bought ${rung.label} for ${formatMoney(rung.cost)}`);
  }
}
