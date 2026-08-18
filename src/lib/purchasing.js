// Shared money-allocation logic for every buyer in the suite.
//
// The suite has one wallet and several claimants: server-buyer.js, augmentation-buyer.js,
// and the one-shot buyers added in docs/API-COVERAGE-AUDIT.md §5. Each spends against a
// reserve fraction so no single buyer can starve the others — the same discipline
// augmentation-buyer.js needed when NeuroFlux was dumping the whole balance (059c5ae).

/**
 * Budget a buyer may spend, after holding back its reserve.
 * @param {number} money
 * @param {number} reserveFraction  0 = spend it all, 1 = spend nothing
 */
export function spendableMoney(money, reserveFraction) {
  return Math.max(0, money * (1 - reserveFraction));
}

/**
 * Walk a priority-ordered shopping list against a budget.
 *
 * The budget shrinks as the plan commits to each item — checking every item against the
 * full wallet is how a buyer promises more than it can pay for.
 *
 * Two shapes of list:
 *  - **shopping** (default): items are independent, so an unaffordable one is skipped and
 *    cheaper items still get bought. Port openers work this way — a partial set of
 *    programs still opens ports.
 *  - **ladder** (`stopOnUnaffordable`): items depend on their predecessor, so the walk
 *    stops at the first one out of reach. The market unlocks work this way — the TIX API
 *    is unusable without the WSE account underneath it.
 *
 * Items with a negative cost are unavailable, not free: the ns cost getters return -1 for
 * "you cannot buy this yet" (e.g. getDarkwebProgramCost before the TOR router).
 *
 * Generic in the item type so callers keep whatever extra fields (and whatever narrow
 * `name` literal type) they put in — e.g. ProgramName, or a sleeve index alongside a cost.
 *
 * @template {{name: string, cost: number}} T
 * @param {{money: number, reserveFraction?: number,
 *   items: readonly T[], stopOnUnaffordable?: boolean}} input
 * @returns {{buy: T[], spend: number}}
 */
export function planPurchases({ money, reserveFraction = 0, items, stopOnUnaffordable = false }) {
  let budget = spendableMoney(money, reserveFraction);
  const buy = [];
  let spend = 0;

  for (const item of items) {
    if (item.cost < 0) continue;
    if (item.cost > budget) {
      if (stopOnUnaffordable) break;
      continue;
    }
    buy.push(item);
    budget -= item.cost;
    spend += item.cost;
  }

  return { buy, spend };
}
