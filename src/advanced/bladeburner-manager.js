import { log } from "/src/lib/utils.js";
import { PORTS } from "/src/lib/constants.js";
import { writePortData } from "/src/lib/port-registry.js";

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

  const operations = ns.bladeburner.getOperationNames();
  let bestOp = null, bestOpChance = 0;
  for (const op of operations) {
    const count = ns.bladeburner.getActionCountRemaining("Operations", op);
    if (count <= 0) continue;
    const [minChance] = ns.bladeburner.getActionEstimatedSuccessChance("Operations", op);
    if (minChance > bestOpChance) {
      bestOpChance = minChance;
      bestOp = op;
    }
  }
  if (bestOp && bestOpChance >= 0.7) return { type: "Operations", name: bestOp };

  const contracts = ns.bladeburner.getContractNames();
  let bestContract = null, bestContractChance = 0;
  for (const contract of contracts) {
    const count = ns.bladeburner.getActionCountRemaining("Contracts", contract);
    if (count <= 0) continue;
    const [minChance] = ns.bladeburner.getActionEstimatedSuccessChance("Contracts", contract);
    if (minChance > bestContractChance) {
      bestContractChance = minChance;
      bestContract = contract;
    }
  }
  if (bestContract && bestContractChance >= 0.6) return { type: "Contracts", name: bestContract };

  return { type: "General", name: "Training" };
}

function upgradeSkills(ns) {
  const skills = ns.bladeburner.getSkillNames();
  let points = ns.bladeburner.getSkillPoints();

  const priorities = ["Blade's Intuition", "Cloak", "Short-Circuit", "Digital Observer", "Overclock"];

  // Buy one level of each priority skill we can afford, in order, decrementing
  // the available skill points as we go. Skill points are small integers, so the
  // old `cost <= points * 0.3` reserve blocked nearly every upgrade.
  for (const skill of priorities) {
    if (!skills.includes(skill)) continue;
    const cost = ns.bladeburner.getSkillUpgradeCost(skill);
    if (cost > 0 && cost <= points && ns.bladeburner.upgradeSkill(skill)) {
      points -= cost;
    }
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
