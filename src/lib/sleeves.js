// Sleeve decision logic. See docs/API-COVERAGE-AUDIT.md §5.6.

import { planPurchases } from "/src/lib/purchasing.js";
import { fallbackCrime, GANG_KARMA_REQUIREMENT } from "/src/lib/crime.js";

/**
 * Faction work a sleeve may do, best first. Not every faction offers hacking work, so the
 * manager tries these in order and keeps whichever the game accepts.
 * @type {FactionWorkType[]}
 */
export const FACTION_WORK_TYPES = ["hacking", "field", "security"];

// ns.sleeve.getTask() reports the live task in the game's own vocabulary; sleeve-manager
// picks tasks in its own. This maps our task descriptor onto the fields getTask returns,
// so the two can be compared without the manager knowing either shape in detail.
const TASK_MATCHERS = {
  recovery: (live) => live.type === "RECOVERY",
  sync: (live) => live.type === "SYNCHRO",
  crime: (live, want) => live.type === "CRIME" && live.crimeType === want.crime,
  gym: (live, want) => live.type === "CLASS" && live.classType === want.stat,
  // Any allowed work type matches: demanding the first one would re-issue a sleeve that
  // landed on field work because the faction has no hacking, wiping its progress each cycle.
  faction: (live, want) =>
    live.type === "FACTION" &&
    live.factionName === want.faction &&
    want.workTypes.includes(live.factionWorkType),
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

/**
 * Sleeve augmentations can only be bought at zero shock — purchaseSleeveAug refuses
 * otherwise.
 *
 * @param {{shock: number}} sleeve
 */
export function canBuySleeveAugs(sleeve) {
  return sleeve.shock <= 0;
}

/**
 * Should sleeves commit crimes for karma?
 *
 * Only while a gang is possible (Source-File 2, or BitNode 2 itself), not yet created,
 * and karma is still above the requirement. Without SF2 karma unlocks nothing.
 *
 * @param {{karma: number, inGang: boolean, canGang: boolean}} state
 */
export function needsKarma({ karma, inGang, canGang }) {
  return canGang && !inGang && karma > GANG_KARMA_REQUIREMENT;
}

/**
 * What a sleeve should be doing.
 *
 * Shock recovery until shock reaches workShock (DEFAULTS.sleeveWorkShock — see there for
 * why it isn't 0). Shock keeps falling while the sleeve works, so it reaches 0 on its own
 * later, which is when sleeve augmentations become buyable. Sync comes next, because it
 * controls how much of a sleeve's exp the player also gains.
 *
 * After that, karma for a gang, then the faction assignFactions() gave this sleeve, then a
 * money crime. Karma is always Homicide: both its success chance and Mug's scale linearly
 * with combat stats, and Homicide yields 12x the karma per attempt in 3/4 the time.
 *
 * @param {{shock: number, sync: number,
 *   skills: {strength: number, defense: number, dexterity: number, agility: number}}} sleeve
 * @param {{needKarma: boolean, faction: string | null, workShock: number}} ctx
 */
export function chooseSleeveTask(sleeve, { needKarma, faction, workShock }) {
  if (sleeve.shock > workShock) return { type: "recovery" };
  if (sleeve.sync < 100) return { type: "sync" };
  if (needKarma) return { type: "crime", crime: fallbackCrime(sleeve.skills, { goal: "karma" }) };
  if (faction) return { type: "faction", faction, workTypes: FACTION_WORK_TYPES };
  return { type: "crime", crime: fallbackCrime(sleeve.skills) };
}

/**
 * Give each eligible sleeve its own faction.
 *
 * The game rejects a second sleeve on a faction another sleeve already works, so each
 * faction goes to at most one sleeve. A sleeve keeps the faction it already has when it's
 * still available, since moving it restarts its work. Factions are handed out in the order
 * given; sleeves left without one get null.
 *
 * @param {Array<{sleeveNum: number, eligible: boolean, current: string | null}>} sleeves
 * @param {string[]} factions
 * @param {{exclude?: string[]}} [opts]
 * @returns {Map<number, string | null>}
 */
export function assignFactions(sleeves, factions, { exclude = [] } = {}) {
  const available = factions.filter((f) => !exclude.includes(f));
  const claimed = new Set();
  /** @type {Map<number, string | null>} */
  const result = new Map(sleeves.map((s) => [s.sleeveNum, null]));

  for (const s of sleeves) {
    if (s.eligible && s.current && available.includes(s.current) && !claimed.has(s.current)) {
      result.set(s.sleeveNum, s.current);
      claimed.add(s.current);
    }
  }
  for (const s of sleeves) {
    if (!s.eligible || result.get(s.sleeveNum)) continue;
    const next = available.find((f) => !claimed.has(f));
    if (!next) break;
    result.set(s.sleeveNum, next);
    claimed.add(next);
  }
  return result;
}
