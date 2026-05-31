import { log } from "/src/lib/utils.js";
import { PORTS } from "/src/lib/constants.js";
import { writePortData } from "/src/lib/port-registry.js";

function hasBladeburnerAPI(ns) {
  try {
    ns.bladeburner.getRank();
    return true;
  } catch {
    return false;
  }
}

function getStamina(ns) {
  const [current, max] = ns.bladeburner.getStamina();
  return { current, max, ratio: current / max };
}

function getBestAction(ns) {
  const stamina = getStamina(ns);

  if (stamina.ratio < 0.5) return { type: "General", name: "Training" };

  const city = ns.bladeburner.getCity();
  const chaos = ns.bladeburner.getCityChaos(city);
  if (chaos > 50) return { type: "General", name: "Diplomacy" };

  const blackOps = ns.bladeburner.getBlackOpNames();
  for (const op of blackOps) {
    const rank = ns.bladeburner.getRank();
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

/** @param {NS} ns */
export async function main(ns) {
  ns.disableLog("ALL");

  if (!hasBladeburnerAPI(ns)) {
    ns.tprint("ERROR: Bladeburner API required (Source-File 6 or 7)");
    return;
  }

  log(ns, "Bladeburner Manager started");

  while (true) {
    upgradeSkills(ns);

    const action = getBestAction(ns);
    const [currentType, currentName] = ns.bladeburner.getCurrentAction()
      ? [ns.bladeburner.getCurrentAction().type, ns.bladeburner.getCurrentAction().name]
      : [null, null];

    if (currentType !== action.type || currentName !== action.name) {
      ns.bladeburner.startAction(action.type, action.name);
      log(ns, `Bladeburner: ${action.type} -> ${action.name}`);
    }

    const stamina = getStamina(ns);
    writePortData(ns, PORTS.BLADEBURNER_STATUS, {
      rank: ns.bladeburner.getRank(),
      action: `${action.type}:${action.name}`,
      stamina: `${stamina.current.toFixed(0)}/${stamina.max.toFixed(0)}`,
      skillPoints: ns.bladeburner.getSkillPoints(),
    });

    await ns.sleep(5000);
  }
}
