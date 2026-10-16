// Sleeve decision logic. See docs/API-COVERAGE-AUDIT.md §5.6.

import { planPurchases } from "/src/lib/purchasing.js";
import {
  CRIME_MONEY,
  GANG_KARMA_REQUIREMENT,
  KNOWN_CRIMES,
  crimeSuccessChance,
  pickAchievableCrime,
} from "/src/lib/crime.js";

import { FACTION_WORK_TYPES } from "/src/lib/faction-work.js";
import { CONTRACTS_BY_REWARD, bestPayingAction } from "/src/lib/bladeburner.js";

// ns.sleeve.getTask() reports the live task in the game's own vocabulary; sleeve-manager
// picks tasks in its own. This maps our task descriptor onto the fields getTask returns,
// so the two can be compared without the manager knowing either shape in detail.
const TASK_MATCHERS = {
  recovery: (live) => live.type === "RECOVERY",
  sync: (live) => live.type === "SYNCHRO",
  crime: (live, want) => live.type === "CRIME" && live.crimeType === want.crime,
  gym: (live, want) => live.type === "CLASS" && live.classType === want.stat,
  // Any allowed work type matches: demanding the first one would re-issue a sleeve that
  // landed on security work because the faction has no field work, every cycle.
  // betterFactionWorkTypes handles moving up to a better type.
  faction: (live, want) =>
    live.type === "FACTION" &&
    live.factionName === want.faction &&
    want.workTypes.includes(live.factionWorkType),
  company: (live, want) => live.type === "COMPANY" && live.companyName === want.company,
  infiltrate: (live) => live.type === "INFILTRATE",
  bladeburner: (live, want) =>
    live.type === "BLADEBURNER" &&
    live.actionType === want.actionType &&
    live.actionName === want.actionName,
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
 * Which crime a sleeve should commit.
 *
 * Ranked on expected yield per second among the crimes this sleeve lands at least
 * minChance of the time; see pickAchievableCrime for why the floor exists and what
 * happens below it.
 *
 * @param {{skills: any, mults?: {crime_success?: number}}} sleeve
 * @param {{goal?: "money" | "karma", currentCrime?: string | null, minChance?: number,
 *   chanceOf?: (person: any, crime: CrimeType) => number}} [opts]
 *   chanceOf defaults to the local formula; the manager passes ns.formulas' when owned
 * @returns {CrimeType}
 */
export function chooseSleeveCrime(
  sleeve,
  { goal = "money", currentCrime = null, minChance, chanceOf = crimeSuccessChance } = {},
) {
  const candidates = KNOWN_CRIMES.map((name) => ({
    name,
    money: CRIME_MONEY[name],
    chance: chanceOf(sleeve, name),
  }));
  return pickAchievableCrime(candidates, currentCrime, { goal, minChance }) ?? "Shoplift";
}

/**
 * Which sleeves work Bladeburner, and as what.
 *
 * Up to `count` eligible sleeves. One infiltrates Synthoids, which refills the contract
 * and operation counts the player draws from; the rest take on contracts, which earns
 * rank. Contracts succeed on combat stats and infiltration doesn't need them, so the
 * strongest sleeves are chosen and the weakest of them infiltrates. A sleeve already on
 * Bladeburner work keeps its place and role, since moving it restarts its action.
 *
 * @param {Array<{sleeveNum: number, eligible: boolean, combat: number,
 *   current: "infiltrate" | "contracts" | null}>} sleeves
 * @param {{count: number}} opts
 * @returns {Map<number, "infiltrate" | "contracts" | null>}
 */
export function assignBladeburner(sleeves, { count }) {
  /** @type {Map<number, "infiltrate" | "contracts" | null>} */
  const result = new Map(sleeves.map((s) => [s.sleeveNum, null]));
  const chosen = sleeves
    .filter((s) => s.eligible)
    .sort((a, b) => Number(Boolean(b.current)) - Number(Boolean(a.current)) || b.combat - a.combat)
    .slice(0, Math.max(0, count));
  if (chosen.length === 0) return result;

  const weakest = [...chosen].sort((a, b) => a.combat - b.combat)[0];
  const infiltrator = chosen.find((s) => s.current === "infiltrate") ?? weakest;
  for (const s of chosen) result.set(s.sleeveNum, s === infiltrator ? "infiltrate" : "contracts");
  return result;
}

/**
 * The task for a sleeve in a Bladeburner role.
 *
 * A contracts sleeve takes the best-paying contract it lands at least minChance of the
 * time (judged on the low end of the game's estimate) that still has some left. With none,
 * it runs Field Analysis: the estimates start out wide, which is what holds every contract
 * below the floor early on, and Field Analysis narrows them.
 *
 * @param {"infiltrate" | "contracts"} role
 * @param {Array<{name: string, chance: number, count: number}>} contracts
 * @param {{minChance: number}} opts
 */
export function bladeburnerTaskFor(role, contracts, { minChance }) {
  if (role === "infiltrate") return { type: "infiltrate" };
  const left = contracts.filter((c) => c.count >= 1);
  const contract = bestPayingAction(left, CONTRACTS_BY_REWARD, minChance);
  if (contract) return { type: "bladeburner", actionType: "Contracts", actionName: contract };
  return { type: "bladeburner", actionType: "General", actionName: "Field Analysis" };
}

/**
 * What a sleeve should be doing.
 *
 * Shock recovery until shock reaches workShock (DEFAULTS.sleeveWorkShock — see there for
 * why it isn't 0). Shock keeps falling while the sleeve works, so it reaches 0 on its own
 * later, which is when sleeve augmentations become buyable. Sync comes next, because it
 * controls how much of a sleeve's exp the player also gains.
 *
 * After that: karma for a gang, then the Bladeburner task assignBladeburner() gave this
 * sleeve (see bladeburnerTaskFor), then the faction assignFactions() gave it, then
 * the company assignCompanies() gave it, then a money crime. Faction work outranks company
 * work because faction rep buys augmentations now, while company rep only unlocks a
 * faction to grind later.
 *
 * @param {{shock: number, sync: number, skills: any,
 *   mults?: {crime_success?: number}}} sleeve
 * @param {{needKarma: boolean, faction: string | null, company?: string | null,
 *   bladeburner?: {type: string, actionType?: string, actionName?: string} | null,
 *   workShock: number, currentCrime?: string | null, minChance?: number,
 *   chanceOf?: (person: any, crime: CrimeType) => number}} ctx
 */
export function chooseSleeveTask(sleeve, ctx) {
  const { needKarma, faction, company = null, bladeburner = null, workShock, currentCrime, minChance, chanceOf } =
    ctx;
  const crime = (goal) => chooseSleeveCrime(sleeve, { goal, currentCrime, minChance, chanceOf });

  if (sleeve.shock > workShock) return { type: "recovery" };
  if (sleeve.sync < 100) return { type: "sync" };
  if (needKarma) return { type: "crime", crime: crime("karma") };
  // Rebuilt as literals so the result types as one task shape alongside the others.
  if (bladeburner?.type === "infiltrate") return { type: "infiltrate" };
  if (bladeburner) {
    return { type: "bladeburner", actionType: bladeburner.actionType, actionName: bladeburner.actionName };
  }
  if (faction) return { type: "faction", faction, workTypes: FACTION_WORK_TYPES };
  if (company) return { type: "company", company };
  return { type: "crime", crime: crime("money") };
}

/**
 * Factions worth a sleeve's time, best first.
 *
 * advanced/faction-manager.js publishes the factions that still have augmentations needing
 * reputation; rep earned anywhere else buys nothing, so those are the only ones handed out.
 * The faction the player is working stays in: the game only forbids two SLEEVES on one
 * faction, and the player's pick is the top-priority one, so it gets a sleeve as well.
 * With no published list (faction manager disabled) every joined faction is offered, most
 * recently joined first, which is usually the one whose augmentations are next.
 *
 * @param {string[]} joined  player.factions
 * @param {{pendingFactions?: string[]} | null} status
 *   FACTION_STATUS port payload
 * @returns {string[]}
 */
export function factionWorkOrder(joined, status) {
  if (!status || !Array.isArray(status.pendingFactions)) return [...joined].reverse();
  return status.pendingFactions.filter((f) => joined.includes(f));
}

/**
 * Joined factions that are NOT in the published pending list, most recently joined first.
 *
 * Their augmentations are all within reach on reputation already, so they rank below
 * pending factions and below company work. They still beat a money crime for a sleeve
 * with nothing else to do: the rep turns into favor on the next run and pays for
 * NeuroFlux Governor levels. Empty without a published list, because factionWorkOrder
 * already offers every joined faction then.
 *
 * @param {string[]} joined  player.factions
 * @param {{pendingFactions?: string[]} | null} status  FACTION_STATUS port payload
 * @returns {string[]}
 */
export function spareFactions(joined, status) {
  if (!status || !Array.isArray(status.pendingFactions)) return [];
  const pending = status.pendingFactions;
  return [...joined].reverse().filter((f) => !pending.includes(f));
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

/**
 * Give each eligible sleeve its own company. The game applies the same one-sleeve-each
 * rule to companies as to factions, and moving a sleeve restarts its work just the same.
 */
export const assignCompanies = assignFactions;
