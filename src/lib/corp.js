// Corporation decision logic, kept pure so it is testable without the (expensive) corp API.
//
// See docs/API-COVERAGE-AUDIT.md §5.5. Every ns.corporation.* function is documented at
// 20 GB (NetscriptDefinitions.d.ts), so anything that touches this namespace has to be
// budgeted deliberately — run tools/ram-report.js to see what the game actually charges
// before adding calls to a persistent manager.

// Materials that multiply a division's production while they are HELD in the warehouse.
// They are inputs to the production multiplier, never output to be sold: liquidating them
// liquidates the multiplier. corp-manager.js used to sell all four on the same
// "stored > 0 && producing" rule it applied to actual output goods.
/** @type {CorpMaterialName[]} */
export const BOOST_MATERIALS = ["Hardware", "Robots", "AI Cores", "Real Estate"];

// Materials the manager inspects each cycle: the common outputs plus the four boosters.
// Boosters are inspected (not skipped) so selectMaterialsToSell stays the one place that
// decides what may be sold.
/** @type {CorpMaterialName[]} */
export const TRACKED_MATERIALS = ["Food", "Plants", ...BOOST_MATERIALS];

// Membership checks run against plain strings; BOOST_MATERIALS itself keeps the narrow
// CorpMaterialName type so it can be passed straight to the corporation API.
const BOOST_NAMES = /** @type {string[]} */ (BOOST_MATERIALS);

/**
 * Which of a division's materials should be put on sale this cycle.
 *
 * Sell only what the division actually produces and has in stock. Anything with zero
 * production is bought stock (boost materials, or inputs) rather than output.
 *
 * Generic in the name type so a CorpMaterialName[] input yields a CorpMaterialName[]
 * output, ready for ns.corporation.sellMaterial.
 *
 * @template {string} T
 * @param {Array<{name: T, stored: number, productionAmount: number}>} materials
 * @returns {T[]} material names to sell
 */
export function selectMaterialsToSell(materials) {
  return materials
    .filter((m) => !BOOST_NAMES.includes(m.name))
    .filter((m) => m.stored > 0 && m.productionAmount > 0)
    .map((m) => m.name);
}

/**
 * How much of each boost material to buy, toward a per-industry target.
 *
 * Warehouse space is shared across every material, so the free space is consumed as the
 * plan is built — an overfilled warehouse stalls production outright, which costs more
 * than the boost is worth.
 *
 * `targets` is walked in insertion order, which makes **key order the priority order**: on a
 * warehouse too small for everything, earlier keys fill and later ones are starved. See the
 * note on DEFAULTS.corpBoostTargets in constants.js before reordering it.
 *
 * @param {{targets: Record<string, number>, stored: Record<string, number>, freeSpace: number}} input
 * @returns {Array<{name: string, amount: number}>}
 */
export function planBoostPurchases({ targets, stored, freeSpace }) {
  const plan = [];
  let space = freeSpace;

  for (const [name, target] of Object.entries(targets)) {
    const shortfall = target - (stored[name] ?? 0);
    const amount = Math.min(shortfall, space);
    if (amount <= 0) continue;
    plan.push({ name, amount });
    space -= amount;
  }

  return plan;
}
