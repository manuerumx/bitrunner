// Corporation decision logic, kept pure so it is testable without the (expensive) corp API.
//
// Corporation calls cost 10-20 GB each. test/corp-ram.test.js pins every corp script's RAM and
// rejects names that aren't corporation functions; run tools/ram-report.js api to see what
// the game actually charges.

// Materials that multiply a division's production while they are HELD in the warehouse.
// They are inputs to the production multiplier, never output to be sold: liquidating them
// liquidates the multiplier.
/** @type {CorpMaterialName[]} */
export const BOOST_MATERIALS = ["Hardware", "Robots", "AI Cores", "Real Estate"];

// Warehouse space per unit of each boost material (getMaterialData(name).size). Hardcoded to
// keep getMaterialData's 10 GB out of corp-boost.js.
/** @type {Record<string, number>} */
export const BOOST_SIZES = { Hardware: 0.06, Robots: 0.5, "AI Cores": 0.1, "Real Estate": 0.005 };

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


// ── Offices ─────────────────────────────────────────────────────────────────

/**
 * How many employees each job gets in an office of `size`.
 *
 * One of each job first, in the key order of `weights`, so a 3-person office gets the first
 * three jobs. Every later hire goes to the job whose (count + 1) / weight is lowest, ties to
 * the earlier key. Jobs with weight 0 get nobody.
 *
 * @param {number} size
 * @param {Record<string, number>} weights
 * @returns {Record<string, number>}
 */
export function planJobs(size, weights) {
  const jobs = Object.keys(weights).filter((job) => weights[job] > 0);
  /** @type {Record<string, number>} */
  const counts = Object.fromEntries(jobs.map((job) => [job, 0]));
  for (let i = 0; i < size && jobs.length > 0; i++) {
    let pick = jobs[0];
    let best = Infinity;
    for (const job of jobs) {
      const score = counts[job] === 0 ? -1 : (counts[job] + 1) / weights[job];
      if (score < best) {
        best = score;
        pick = job;
      }
    }
    counts[pick]++;
  }
  return counts;
}

/**
 * The setJobAssignment calls that take an office from `current` to `target` head counts, in an
 * order that works: raising a job draws from Unassigned, so every cut comes first. Jobs not in
 * `target` (Intern, say) are cut to zero. Unassigned itself is never set.
 *
 * @param {Record<string, number>} current employeeJobs from getOffice
 * @param {Record<string, number>} target from planJobs
 * @returns {Array<{job: string, count: number}>}
 */
export function orderJobAssignments(current, target) {
  const cuts = [];
  const raises = [];
  for (const job of new Set([...Object.keys(current), ...Object.keys(target)])) {
    if (job === "Unassigned") continue;
    const have = current[job] ?? 0;
    const want = target[job] ?? 0;
    if (want < have) cuts.push({ job, count: want });
    else if (want > have) raises.push({ job, count: want });
  }
  return [...cuts, ...raises];
}

/**
 * Whether an office needs tea (energy) or a party (morale): either below `floor` of its max.
 *
 * @param {{avgEnergy: number, maxEnergy: number, avgMorale: number, maxMorale: number}} office
 * @param {number} floor
 * @returns {{tea: boolean, party: boolean}}
 */
export function wellbeingActions(office, floor) {
  return {
    tea: office.avgEnergy < office.maxEnergy * floor,
    party: office.avgMorale < office.maxMorale * floor,
  };
}

// ── Boost materials ─────────────────────────────────────────────────────────

/**
 * An industry's boost factors keyed by material name.
 *
 * @param {{hardwareFactor?: number, robotFactor?: number, aiCoreFactor?: number, realEstateFactor?: number}} data
 *   getIndustryData's result
 * @returns {Record<string, number>}
 */
export function boostFactors(data) {
  return {
    Hardware: data.hardwareFactor ?? 0,
    Robots: data.robotFactor ?? 0,
    "AI Cores": data.aiCoreFactor ?? 0,
    "Real Estate": data.realEstateFactor ?? 0,
  };
}

/**
 * The boost-material mix that maximizes a division's production for `space` units of room.
 *
 * The game's multiplier is (Π (1 + 0.002·xᵢ)^cᵢ)^0.73, xᵢ the amount held and cᵢ the industry's
 * factor. Maximizing Σ cᵢ·ln(1 + 0.002·xᵢ) subject to Σ sᵢ·xᵢ = space (sᵢ the size per unit)
 * gives, by Lagrange multipliers:
 *
 *     xᵢ = cᵢ·(space + 500·Σsⱼ) / (sᵢ·Σcⱼ) − 500
 *
 * A negative xᵢ means the material isn't worth its room at this budget. The one with the
 * lowest cᵢ/sᵢ is dropped and the rest re-solved, until every amount is positive.
 *
 * @param {Record<string, number>} factors per material; 0 or missing means unused
 * @param {Record<string, number>} sizes space per unit
 * @param {number} space
 * @returns {Record<string, number>} whole units of each material in `sizes`
 */
export function optimalBoostAmounts(factors, sizes, space) {
  /** @type {Record<string, number>} */
  const result = Object.fromEntries(Object.keys(sizes).map((name) => [name, 0]));
  if (space <= 0) return result;

  let active = Object.keys(sizes).filter((name) => (factors[name] ?? 0) > 0);
  while (active.length > 0) {
    const sumC = active.reduce((total, name) => total + factors[name], 0);
    const sumS = active.reduce((total, name) => total + sizes[name], 0);
    const amount = (/** @type {string} */ name) => (factors[name] * (space + 500 * sumS)) / (sizes[name] * sumC) - 500;

    const negative = active.filter((name) => amount(name) < 0);
    if (negative.length === 0) {
      // The epsilon keeps float error (20499.999...) from flooring a whole unit away.
      for (const name of active) result[name] = Math.floor(amount(name) + 1e-6);
      return result;
    }
    const value = (/** @type {string} */ name) => factors[name] / sizes[name];
    const worst = negative.reduce((a, b) => (value(a) <= value(b) ? a : b));
    active = active.filter((name) => name !== worst);
  }
  return result;
}

/**
 * How much of each boost material to buy toward its target.
 *
 * Free warehouse space and money are both limits. When either runs short, every purchase is
 * scaled down by the same fraction, so a tight budget keeps the optimal mix rather than
 * filling up on whichever material happens to come first.
 *
 * @param {{targets: Record<string, number>, stored: Record<string, number>,
 *          sizes: Record<string, number>, prices: Record<string, number>,
 *          freeSpace: number, budget: number}} input
 * @returns {Array<{name: string, amount: number}>}
 */
export function planBoostPurchases({ targets, stored, sizes, prices, freeSpace, budget }) {
  const wanted = Object.entries(targets)
    .map(([name, target]) => ({ name, amount: target - (stored[name] ?? 0) }))
    .filter((want) => want.amount > 0);
  if (wanted.length === 0) return [];

  const space = wanted.reduce((total, want) => total + want.amount * sizes[want.name], 0);
  const cost = wanted.reduce((total, want) => total + want.amount * prices[want.name], 0);
  const scale = Math.min(1, Math.max(0, freeSpace) / space, Math.max(0, budget) / cost);

  return wanted
    .map((want) => ({ name: want.name, amount: Math.floor(want.amount * scale) }))
    .filter((buy) => buy.amount > 0);
}

// ── Upgrades and research ───────────────────────────────────────────────────

/**
 * Corp-wide upgrades to level now: one level each, cheapest first, while `budget` lasts.
 *
 * @param {Record<string, number>} costs next-level cost per upgrade
 * @param {number} budget
 * @returns {string[]}
 */
export function planUpgrades(costs, budget) {
  const plan = [];
  let left = budget;
  for (const [name, cost] of Object.entries(costs).sort((a, b) => a[1] - b[1])) {
    if (cost > left) break;
    plan.push(name);
    left -= cost;
  }
  return plan;
}

/**
 * The next research to buy: the first in `priority` not yet owned, if it costs at most
 * `spend` of the division's research points. Strict order, so points build up for the
 * important ones, and prerequisites are bought first if `priority` lists them first.
 *
 * @param {string[]} priority
 * @param {string[]} owned
 * @param {(name: string) => number} costOf
 * @param {number} points
 * @param {number} spend fraction of points one research may take
 * @returns {{name: string, cost: number} | null}
 */
export function nextResearch(priority, owned, costOf, points, spend) {
  const name = priority.find((n) => !owned.includes(n));
  if (name === undefined) return null;
  const cost = costOf(name);
  return cost <= points * spend ? { name, cost } : null;
}

