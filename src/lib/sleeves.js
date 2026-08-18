// Sleeve decision logic. See docs/API-COVERAGE-AUDIT.md §5.6.

import { planPurchases } from "/src/lib/purchasing.js";

// ns.sleeve.getTask() reports the live task in the game's own vocabulary; sleeve-manager
// picks tasks in its own. This maps our task descriptor onto the fields getTask returns,
// so the two can be compared without the manager knowing either shape in detail.
const TASK_MATCHERS = {
  recovery: (live) => live.type === "RECOVERY",
  sync: (live) => live.type === "SYNCHRO",
  crime: (live, want) => live.type === "CRIME" && live.crimeType === want.crime,
  gym: (live, want) => live.type === "CLASS" && live.classType === want.stat,
  faction: (live, want) =>
    live.type === "FACTION" &&
    live.factionName === want.faction &&
    live.factionWorkType === want.workType,
};

/**
 * Does this sleeve need a new assignment, or is it already doing what we want?
 *
 * The manager used to re-issue every setTo* call on each cycle. Several of those restart
 * the task, discarding partial progress — crimes and faction work accumulate cycles
 * toward a payout, so a 30 s re-assignment loop can keep a sleeve permanently at zero.
 *
 * @param {any | null} live  ns.sleeve.getTask(), null when the sleeve is idle
 * @param {{type: string} & Record<string, any>} desired
 */
export function needsReassignment(live, desired) {
  if (!live) return true;
  const matcher = TASK_MATCHERS[desired.type];
  if (!matcher) return true;
  return !matcher(live, desired);
}

/**
 * How to spend this cycle's sleeve budget.
 *
 * A new sleeve outranks memory because it compounds — it earns from the moment it exists.
 * Memory comes next and is bought cheapest-first so a partial budget spreads across
 * sleeves instead of stalling on the most expensive one. Both are permanent: memory
 * survives an augmentation install, unlike shock and sync which reset with the run.
 *
 * @param {{money: number, reserveFraction?: number, sleeveCost: number | null,
 *   memoryCosts: Array<{sleeveNum: number, cost: number}>}} input
 */
export function planSleeveSpending({ money, reserveFraction = 0, sleeveCost, memoryCosts }) {
  const items = [];
  if (sleeveCost !== null && sleeveCost !== undefined) {
    items.push({ name: "sleeve", cost: sleeveCost });
  }
  for (const m of [...memoryCosts].sort((a, b) => a.cost - b.cost)) {
    items.push({ name: `memory-${m.sleeveNum}`, cost: m.cost, sleeveNum: m.sleeveNum });
  }

  return planPurchases({ money, reserveFraction, items });
}
