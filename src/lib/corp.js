// Corporation decision logic, kept pure so it is testable without the (expensive) corp API.
//
// Corporation calls cost 10-20 GB each. test/corp-ram.test.js pins every corp script's RAM and
// rejects names that aren't corporation functions; run tools/ram-report.js api to see what
// the game actually charges.

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

// ── Setup ───────────────────────────────────────────────────────────────────

// One-time unlocks corp-setup.js buys, on either side of the city expansion. Smart Supply
// comes before the cities: without it nothing buys Agriculture's Water and Chemicals, so
// nothing is produced. The API unlocks come last: what they gate (hiring, warehouses, sell
// orders) can be done by hand in the UI for free, and they cost a large share of the seed money.
/** @type {CorpUnlockName[]} */
export const SETUP_UNLOCKS_FIRST = ["Smart Supply"];
/** @type {CorpUnlockName[]} */
export const SETUP_UNLOCKS_LAST = ["Warehouse API", "Office API"];

/** @typedef {{kind: "unlock" | "city", name: string, cost: number}} SetupStep */

/**
 * @param {"unlock" | "city"} kind
 * @param {string} name
 * @param {number} cost
 * @returns {SetupStep}
 */
const setupStep = (kind, name, cost) => ({ kind, name, cost });

/**
 * The setup purchases to make now, in order, and the first one still waiting for money.
 *
 * Order: SETUP_UNLOCKS_FIRST, the cities the division isn't in yet, SETUP_UNLOCKS_LAST. It is
 * strict: planning stops at the first step that doesn't fit in `funds - reserve`, so a cheap
 * later step never spends money an earlier, more important one is waiting for.
 *
 * Creating the corporation and the division come before this (corp-setup.js does them
 * directly): the city list only exists once there is a division.
 *
 * @param {{unlocks: string[], cities: string[], allCities: string[],
 *          unlockCosts: Record<string, number>, cityCost: number,
 *          funds: number, reserve: number}} input
 * @returns {{buy: SetupStep[], waiting: SetupStep | null}}
 */
export function planSetup({ unlocks, cities, allCities, unlockCosts, cityCost, funds, reserve }) {
  const missing = (/** @type {string[]} */ names) => names.filter((name) => !unlocks.includes(name));
  const steps = [
    ...missing(SETUP_UNLOCKS_FIRST).map((name) => setupStep("unlock", name, unlockCosts[name])),
    ...allCities.filter((city) => !cities.includes(city)).map((name) => setupStep("city", name, cityCost)),
    ...missing(SETUP_UNLOCKS_LAST).map((name) => setupStep("unlock", name, unlockCosts[name])),
  ];

  const buy = [];
  let budget = funds - reserve;
  for (const step of steps) {
    if (step.cost > budget) return { buy, waiting: step };
    buy.push(step);
    budget -= step.cost;
  }
  return { buy, waiting: null };
}

