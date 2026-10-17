import { log } from "/src/lib/utils.js";
import { PORTS } from "/src/lib/constants.js";
import { writePortData } from "/src/lib/port-registry.js";
import { CONTRACTS_BY_REWARD, OPERATIONS_BY_REWARD, bestPayingAction } from "/src/lib/bladeburner.js";

// The six cities a Bladeburner division operates in. There is no getCityNames() in the API,
// so the list is spelled out; switchCity validates it strictly at runtime.
/** @type {BladeburnerCityName[]} */
export const BLADEBURNER_CITIES = [
  "Aevum",
  "Chongqing",
  "Sector-12",
  "New Tokyo",
  "Ishima",
  "Volhaven",
];

// Team members can only be assigned to Operations and Black Operations, where they raise the
// success chance. Contracts and General actions (Training, Diplomacy, ...) are solo.
const TEAM_ACTIONS = ["Operations", "Black Operations"];

// A new city must beat the current one by this factor before we relocate. Switching costs
// action time, so a near-tie is not worth acting on — without a margin the manager would
// ping-pong between two comparable cities every cycle.
const CITY_SWITCH_MARGIN = 1.25;

// A success estimate wider than this (max − min) is worth narrowing with Field Analysis
// before falling back to Training.
const ESTIMATE_SPREAD_LIMIT = 0.1;

// HP fractions bracketing a stay in the Regeneration Chamber. A failed contract or operation
// costs HP, and at zero the game hospitalizes you for $100k per missing HP. The chamber is
// free but heals only 2 HP per 60 s, so it starts late and stops with a cushion; stopping
// at the start line would send the next failure straight to hospital.
export const REGEN_START = 0.2;
export const REGEN_STOP = 0.5;

/**
 * Should the player be in (or stay in) the Regeneration Chamber?
 * @param {{current: number, max: number}} hp
 * @param {boolean} regenerating  whether the chamber is the current action
 */
export function needsRegen(hp, regenerating) {
  const ratio = hp.current / hp.max;
  return regenerating ? ratio < REGEN_STOP : ratio <= REGEN_START;
}

// Recruit up to this many team members. Team size lifts Operation and Black Op success with
// steep diminishing returns, and recruiting only trains charisma, so past this point idle
// time is better spent on Training.
export const TEAM_TARGET = 10;

// A failed recruitment costs the whole action time; below this, Training is the better use.
export const RECRUIT_MIN_CHANCE = 0.5;

/**
 * What to do when no action clears its success floor.
 *
 * Every action is judged on the low end of the game's estimate, and right after joining
 * that estimate is wide ("40.6% ~ 100.0%"), so nothing qualified and the manager trained
 * for hours. The width is the game's uncertainty about the city's population, which Field
 * Analysis narrows and Training doesn't. Once every estimate is narrow and still short,
 * the idle time builds the team while it is small, then goes to Training for the stats.
 *
 * @param {Array<[number, number]>} estimates  [min, max] success chance per contract and
 *   operation with any count left
 * @param {{teamSize?: number, recruitChance?: number}} [recruit]  current team size and the
 *   low end of Recruitment's success estimate
 * @returns {{ type: BladeburnerActionType, name: BladeburnerActionName }}
 */
export function fallbackAction(estimates, { teamSize = 0, recruitChance = 0 } = {}) {
  const wide = estimates.some(([min, max]) => max - min > ESTIMATE_SPREAD_LIMIT);
  if (wide) return { type: "General", name: "Field Analysis" };
  if (teamSize < TEAM_TARGET && recruitChance >= RECRUIT_MIN_CHANCE) {
    return { type: "General", name: "Recruitment" };
  }
  return { type: "General", name: "Training" };
}

/**
 * How much a level of each skill is worth, relative to the others.
 *
 * Success chance across the board comes first (Blade's Intuition), then Operations, which pay
 * the rank (Digital Observer), and speed on everything (Overclock). Stats and contracts follow.
 * Cloak and Short-Circuit only help a few actions each, and money and Field Analysis matter
 * least here.
 * @type {Record<BladeburnerSkillName, number>}
 */
export const SKILL_WEIGHTS = {
  "Blade's Intuition": 4, // +3% success, every action
  "Digital Observer": 3, // +4% success, Operations and Black Ops
  Overclock: 3, // −1% action time, caps at 90
  Reaper: 2, // +2% combat stats
  "Evasive System": 2, // +4% dexterity and agility
  Tracer: 2, // +4% success, Contracts
  Hyperdrive: 2, // +10% Bladeburner experience
  Cloak: 1.5, // +5.5% success, stealth actions
  "Short-Circuit": 1.5, // +5.5% success, retirement actions
  "Cyber's Edge": 1, // +2% max stamina
  Datamancer: 0.5, // +5% Field Analysis effectiveness
  "Hands of Midas": 0.5, // +10% contract money
};

/**
 * The skill to level next, or null to keep saving.
 *
 * Picks the best weight per point among skills that can still level, and waits until it is
 * affordable rather than spend on a worse one.
 *
 * @param {Partial<Record<string, number>>} costs  next-level cost per skill (Infinity when maxed)
 * @param {number} points  unspent skill points
 * @returns {string | null}
 */
export function pickSkill(costs, points) {
  let best = null;
  let bestRatio = Infinity;
  for (const [name, cost] of Object.entries(costs)) {
    const weight = SKILL_WEIGHTS[name] ?? 0;
    if (!(weight > 0 && cost > 0 && Number.isFinite(cost))) continue;
    if (cost / weight < bestRatio) {
      best = name;
      bestRatio = cost / weight;
    }
  }
  return best !== null && costs[best] <= points ? best : null;
}

function hasBladeburnerAPI(ns) {
  try {
    ns.bladeburner.getRank();
    return true;
  } catch {
    return false;
  }
}

/**
 * Where the division should be operating.
 *
 * Population drives both contract availability and the reliability of success estimates;
 * chaos raises difficulty and degrades those estimates. The manager previously only ran
 * Diplomacy in place when chaos climbed, which grinds one city down instead of moving to a
 * better one.
 *
 * `population / (1 + chaos)` is a heuristic, not a game formula — it just expresses "prefer
 * people, discount disorder". A city with no population left scores zero whatever its chaos.
 *
 * @param {NS} ns
 * @returns {{city: BladeburnerCityName, population: number, chaos: number, score: number}}
 */
export function pickBestCity(ns) {
  let best = null;
  for (const city of BLADEBURNER_CITIES) {
    const population = ns.bladeburner.getCityEstimatedPopulation(city);
    const chaos = ns.bladeburner.getCityChaos(city);
    const score = population / (1 + chaos);
    if (!best || score > best.score) best = { city, population, chaos, score };
  }
  return best;
}

/**
 * Is another city worth relocating to?
 *
 * getCityEstimatedPopulation returns an *estimate*, and it moves between calls — so two
 * comparable cities would otherwise trade first place cycle to cycle and the manager would
 * spend its time relocating instead of acting. The margin makes a switch mean something.
 *
 * @param {{currentScore: number, bestScore: number, margin: number}} input
 */
export function shouldSwitchCity({ currentScore, bestScore, margin }) {
  return bestScore > currentScore * margin;
}

/**
 * How many team members to commit to an action.
 * @param {string} actionType
 * @param {number} available  current team size
 */
export function teamSizeFor(actionType, available) {
  return TEAM_ACTIONS.includes(actionType) ? available : 0;
}

function getStamina(ns) {
  const [current, max] = ns.bladeburner.getStamina();
  return { current, max, ratio: current / max };
}

/**
 * @param {NS} ns
 * @returns {{ type: BladeburnerActionType, name: BladeburnerActionName }}
 */
function getBestAction(ns) {
  const regenerating = ns.bladeburner.getCurrentAction()?.name === "Hyperbolic Regeneration Chamber";
  if (needsRegen(ns.getPlayer().hp, regenerating)) {
    return { type: "General", name: "Hyperbolic Regeneration Chamber" };
  }

  const stamina = getStamina(ns);

  if (stamina.ratio < 0.5) return { type: "General", name: "Training" };

  const city = ns.bladeburner.getCity();
  const chaos = ns.bladeburner.getCityChaos(city);
  if (chaos > 50) return { type: "General", name: "Diplomacy" };

  const blackOps = ns.bladeburner.getBlackOpNames();
  const rank = ns.bladeburner.getRank();
  for (const op of blackOps) {
    const reqRank = ns.bladeburner.getBlackOpRank(op);
    if (rank < reqRank) continue;

    const count = ns.bladeburner.getActionCountRemaining("Black Operations", op);
    if (count <= 0) continue;

    const [minChance, maxChance] = ns.bladeburner.getActionEstimatedSuccessChance("Black Operations", op);
    if (minChance >= 0.8) return { type: "Black Operations", name: op };
  }

  /** @type {Array<[number, number]>} */
  const estimates = [];

  // Each action with some count left, judged on the low end of its estimate.
  const candidates = (type, names) => {
    const out = [];
    for (const name of names) {
      if (ns.bladeburner.getActionCountRemaining(type, name) <= 0) continue;
      const [minChance, maxChance] = ns.bladeburner.getActionEstimatedSuccessChance(type, name);
      estimates.push([minChance, maxChance]);
      out.push({ name, chance: minChance });
    }
    return out;
  };

  const op = bestPayingAction(candidates("Operations", ns.bladeburner.getOperationNames()), OPERATIONS_BY_REWARD, 0.7);
  if (op) return { type: "Operations", name: /** @type {BladeburnerActionName} */ (op) };

  const contract = bestPayingAction(candidates("Contracts", ns.bladeburner.getContractNames()), CONTRACTS_BY_REWARD, 0.6);
  if (contract) return { type: "Contracts", name: /** @type {BladeburnerActionName} */ (contract) };

  const [recruitChance] = ns.bladeburner.getActionEstimatedSuccessChance("General", "Recruitment");
  return fallbackAction(estimates, { teamSize: ns.bladeburner.getTeamSize(), recruitChance });
}

function upgradeSkills(ns) {
  let points = ns.bladeburner.getSkillPoints();
  while (true) {
    /** @type {Partial<Record<string, number>>} */
    const costs = {};
    for (const skill of ns.bladeburner.getSkillNames()) {
      costs[skill] = ns.bladeburner.getSkillUpgradeCost(skill);
    }
    const skill = /** @type {BladeburnerSkillName | null} */ (pickSkill(costs, points));
    if (!skill || !ns.bladeburner.upgradeSkill(skill)) return;
    log(ns, `Bladeburner: upgraded ${skill} (${costs[skill]} SP)`);
    points -= costs[skill];
  }
}

/**
 * Get into the division, and into its faction, if we aren't already.
 *
 * The manager could act but never *enter*: it required the player to have joined by hand,
 * and the try/catch probe couldn't tell "no Source File" from "not joined yet".
 * inBladeburner() (0 GB) answers that directly.
 *
 * @param {NS} ns
 * @returns {boolean} whether we are in the division now
 */
function ensureJoined(ns) {
  if (ns.bladeburner.inBladeburner()) return true;

  // Needs 100 in each combat stat; returns false until then, so this is safe to retry.
  if (!ns.bladeburner.joinBladeburnerDivision()) return false;
  log(ns, "Joined the Bladeburner division");

  // Separate from the division: the faction is what pays reputation for augmentations.
  if (ns.bladeburner.joinBladeburnerFaction()) log(ns, "Joined the Bladeburner faction");
  return true;
}

/** @param {NS} ns */
export async function main(ns) {
  ns.disableLog("ALL");

  if (!hasBladeburnerAPI(ns)) {
    ns.print("ERROR: Bladeburner API required (Source-File 6 or 7)");
    return;
  }

  log(ns, "Bladeburner Manager started");

  while (true) {
    if (!ensureJoined(ns)) {
      // Combat stats too low to enlist yet. Sleeves and gym work raise them; check back.
      await ns.sleep(30000);
      continue;
    }

    upgradeSkills(ns);

    // Relocate when another city is meaningfully better. The margin stops it from
    // ping-ponging between two near-equal cities every 5 s, which would waste the
    // action time each switch costs.
    const here = ns.bladeburner.getCity();
    const best = pickBestCity(ns);
    if (best.city !== here) {
      const currentScore =
        ns.bladeburner.getCityEstimatedPopulation(here) / (1 + ns.bladeburner.getCityChaos(here));
      const worthIt = shouldSwitchCity({ currentScore, bestScore: best.score, margin: CITY_SWITCH_MARGIN });
      if (worthIt && ns.bladeburner.switchCity(best.city)) {
        log(ns, `Bladeburner: moved to ${best.city} (pop ${best.population.toFixed(0)}, chaos ${best.chaos.toFixed(1)})`);
      }
    }

    const action = getBestAction(ns);
    const current = ns.bladeburner.getCurrentAction();
    const currentType = current ? current.type : null;
    const currentName = current ? current.name : null;

    if (currentType !== action.type || currentName !== action.name) {
      // Commit the squad before starting: team size is per-action, and Operations and Black
      // Ops both gain success chance from it. Contracts and General actions are solo.
      const team = teamSizeFor(action.type, ns.bladeburner.getTeamSize());
      if (team > 0) ns.bladeburner.setTeamSize(action.type, action.name, team);

      ns.bladeburner.startAction(action.type, action.name);
      log(ns, `Bladeburner: ${action.type} -> ${action.name}${team > 0 ? ` (team ${team})` : ""}`);
    }

    const stamina = getStamina(ns);
    /** @type {BladeburnerStatus} */
    const status = {
      rank: ns.bladeburner.getRank(),
      action: `${action.type}:${action.name}`,
      stamina: `${stamina.current.toFixed(0)}/${stamina.max.toFixed(0)}`,
      skillPoints: ns.bladeburner.getSkillPoints(),
    };
    writePortData(ns, PORTS.BLADEBURNER_STATUS, status);

    await ns.sleep(5000);
  }
}
