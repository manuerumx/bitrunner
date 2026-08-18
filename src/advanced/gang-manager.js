import { log, formatMoney } from "/src/lib/utils.js";
import { rankEquipment, selectBestTask } from "/src/lib/gang.js";
import { hasFormulas } from "/src/lib/formulas.js";
import { PORTS } from "/src/lib/constants.js";
import { writePortData } from "/src/lib/port-registry.js";

const COMBAT_STATS = ["str", "def", "dex", "agi"];
const ASCEND_THRESHOLD = 1.5;
const WARFARE_WIN_THRESHOLD = 0.55;

function hasGangAPI(ns) {
  try {
    return ns.gang.inGang();
  } catch {
    return false;
  }
}

function getMemberInfo(ns, name) {
  const info = ns.gang.getMemberInformation(name);
  const avgCombat = (info.str + info.def + info.dex + info.agi) / 4;
  return { ...info, name, avgCombat };
}

// Fallback ladder, used when Formulas.exe isn't owned. Deliberately unchanged: without
// the formulas API there is no way to compute real per-task gains, and a hand-derived
// approximation of the game's scaling would be a guess dressed up as an improvement.
function legacyBestTask(member, gangInfo) {
  if (member.avgCombat < 100) return "Train Combat";
  if (member.hack < 100) return "Train Hacking";

  if (gangInfo.wantedPenalty < 0.9 && gangInfo.wantedLevel > 1) return "Vigilante Justice";

  if (member.avgCombat < 500) return "Mug People";
  return "Human Trafficking";
}

/**
 * Best task for a member, ranked on exact gains when Formulas.exe is available.
 *
 * formulas.gang.moneyGain/respectGain/wantedLevelGain take exactly the three objects the
 * manager already holds, so this is real per-member, per-task arithmetic rather than the
 * four hardcoded stat thresholds the ladder uses.
 *
 * Training still comes from the ladder: training tasks earn no money and no respect, so
 * they score zero under the formulas and would never be chosen, however untrained the
 * member is.
 *
 * @param {NS} ns
 * @param {any} member
 * @param {any} gangInfo
 * @param {string[]} taskNames
 * @param {boolean} useFormulas
 */
function getBestTask(ns, member, gangInfo, taskNames, useFormulas) {
  if (!useFormulas) return legacyBestTask(member, gangInfo);

  if (member.avgCombat < 100) return "Train Combat";
  if (member.hack < 100) return "Train Hacking";

  const scored = taskNames.map((name) => {
    const stats = ns.gang.getTaskStats(name);
    return {
      name,
      money: ns.formulas.gang.moneyGain(gangInfo, member, stats),
      respect: ns.formulas.gang.respectGain(gangInfo, member, stats),
      wanted: ns.formulas.gang.wantedLevelGain(gangInfo, member, stats),
    };
  });

  // Recruiting is gated on respect, so chase respect until the roster is full.
  const best = selectBestTask(scored, {
    needWantedReduction: gangInfo.wantedPenalty < 0.9 && gangInfo.wantedLevel > 1,
    preferRespect: ns.gang.getRecruitsAvailable() > 0,
  });

  return best ?? legacyBestTask(member, gangInfo);
}

function tryRecruit(ns) {
  while (ns.gang.canRecruitMember()) {
    const members = ns.gang.getMemberNames();
    const name = `Runner-${members.length}`;
    if (ns.gang.recruitMember(name)) {
      log(ns, `Recruited: ${name}`);
    } else {
      break;
    }
  }
}

function tryAscend(ns, name) {
  const result = ns.gang.getAscensionResult(name);
  if (!result) return false;

  const avgMult = COMBAT_STATS.reduce((sum, s) => sum + result[s], 0) / COMBAT_STATS.length;
  if (avgMult >= ASCEND_THRESHOLD) {
    ns.gang.ascendMember(name);
    log(ns, `Ascended ${name} (${avgMult.toFixed(2)}x mult)`);
    return true;
  }
  return false;
}

/**
 * Build the equipment catalogue once per cycle, ranked by usable stat gain per dollar.
 *
 * Previously every member bought anything under 1% of cash in catalogue order, which
 * spends a combat gang's money on charisma and hacking gear that does nothing for it.
 *
 * @param {NS} ns
 * @param {boolean} combat  whether this is a combat gang
 */
function rankedCatalogue(ns, combat) {
  const items = ns.gang.getEquipmentNames().map((equip) => ({
    name: equip,
    type: ns.gang.getEquipmentType(equip),
    cost: ns.gang.getEquipmentCost(equip),
    stats: ns.gang.getEquipmentStats(equip),
  }));
  return rankEquipment(items, { combat });
}

function buyEquipment(ns, name, catalogue, money) {
  for (const equip of catalogue) {
    if (equip.cost < money * 0.01) {
      try {
        ns.gang.purchaseEquipment(name, equip.name);
      } catch {}
    }
  }
}

/** @param {NS} ns */
export async function main(ns) {
  ns.disableLog("ALL");

  if (!hasGangAPI(ns)) {
    ns.print("ERROR: Gang API required (Source-File 2 or BitNode 2). Must create gang first.");
    return;
  }

  // Formulas.exe turns task selection from a four-threshold ladder into exact per-member
  // arithmetic. Checked once: the file cannot disappear mid-run.
  const useFormulas = hasFormulas(ns);
  log(ns, `Gang Manager started (task ranking: ${useFormulas ? "formulas" : "ladder"})`);

  while (true) {
    const gangInfo = ns.gang.getGangInformation();

    tryRecruit(ns);

    // Fetch the equipment catalog, task list and cash once per cycle, not once per member.
    const catalogue = rankedCatalogue(ns, !gangInfo.isHacking);
    const taskNames = useFormulas ? ns.gang.getTaskNames() : [];
    const money = ns.getPlayer().money;

    let totalIncome = 0;
    for (const name of ns.gang.getMemberNames()) {
      tryAscend(ns, name);

      const member = getMemberInfo(ns, name);
      const task = getBestTask(ns, member, gangInfo, taskNames, useFormulas);

      if (member.task !== task) {
        ns.gang.setMemberTask(name, task);
      }

      buyEquipment(ns, name, catalogue, money);
      totalIncome += member.moneyGain;
    }

    const otherGangs = ns.gang.getAllGangInformation();
    let canWarfare = true;
    for (const [gangName, info] of Object.entries(otherGangs)) {
      if (gangName === gangInfo.faction) continue;
      const chance = ns.gang.getChanceToWinClash(gangName);
      if (chance < WARFARE_WIN_THRESHOLD) {
        canWarfare = false;
        break;
      }
    }

    if (gangInfo.territoryWarfareEngaged !== canWarfare) {
      ns.gang.setTerritoryWarfare(canWarfare);
      log(ns, `Territory warfare: ${canWarfare ? "ENABLED" : "DISABLED"}`);
    }

    /** @type {GangStatus} */
    const status = {
      members: ns.gang.getMemberNames().length,
      income: totalIncome,
      territory: gangInfo.territory,
      respect: gangInfo.respect,
      wantedPenalty: gangInfo.wantedPenalty,
      warfare: canWarfare,
    };
    writePortData(ns, PORTS.GANG_STATUS, status);

    await ns.sleep(10000);
  }
}
