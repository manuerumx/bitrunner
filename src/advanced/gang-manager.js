import { log, formatMoney } from "/src/lib/utils.js";
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

function getBestTask(ns, member) {
  if (member.avgCombat < 100) return "Train Combat";
  if (member.hack < 100) return "Train Hacking";

  const gangInfo = ns.gang.getGangInformation();
  if (gangInfo.wantedPenalty < 0.9 && gangInfo.wantedLevel > 1) return "Vigilante Justice";

  if (member.avgCombat < 500) return "Mug People";
  return "Human Trafficking";
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

function buyEquipment(ns, name) {
  const equipment = ns.gang.getEquipmentNames();
  const money = ns.getPlayer().money;

  for (const equip of equipment) {
    const cost = ns.gang.getEquipmentCost(equip);
    if (cost < money * 0.01) {
      try {
        ns.gang.purchaseEquipment(name, equip);
      } catch {}
    }
  }
}

/** @param {NS} ns */
export async function main(ns) {
  ns.disableLog("ALL");

  if (!hasGangAPI(ns)) {
    ns.tprint("ERROR: Gang API required (Source-File 2 or BitNode 2). Must create gang first.");
    return;
  }

  log(ns, "Gang Manager started");

  while (true) {
    const gangInfo = ns.gang.getGangInformation();
    const members = ns.gang.getMemberNames();

    tryRecruit(ns);

    let totalIncome = 0;
    for (const name of ns.gang.getMemberNames()) {
      tryAscend(ns, name);

      const member = getMemberInfo(ns, name);
      const task = getBestTask(ns, member);

      if (member.task !== task) {
        ns.gang.setMemberTask(name, task);
      }

      buyEquipment(ns, name);
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

    writePortData(ns, PORTS.GANG_STATUS, {
      members: ns.gang.getMemberNames().length,
      income: totalIncome,
      territory: gangInfo.territory,
      respect: gangInfo.respect,
      wantedPenalty: gangInfo.wantedPenalty,
      warfare: canWarfare,
    });

    await ns.sleep(10000);
  }
}
