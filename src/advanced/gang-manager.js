import { log } from "/src/lib/utils.js";
import {
  chooseTask,
  needsWantedReduction,
  nextMemberName,
  planEquipmentPurchases,
  planWarfare,
  powerBuilders,
  rankEquipment,
  respectChasers,
  selectBestTask,
  shouldAscend,
} from "/src/lib/gang.js";
import { getConfig } from "/src/lib/config.js";
import { hasFormulas } from "/src/lib/formulas.js";
import { DEFAULTS, PORTS } from "/src/lib/constants.js";
import { writePortData } from "/src/lib/port-registry.js";

// Only gear costing under this fraction of cash is bought — see planEquipmentPurchases.
const EQUIP_ITEM_FRACTION = 0.01;

function hasGangAPI(ns) {
  try {
    return ns.gang.inGang();
  } catch {
    return false;
  }
}

/**
 * Formulas-ranked task for a member, or null without Formulas.exe (chooseTask then uses
 * its ladder).
 *
 * formulas.gang.moneyGain/respectGain/wantedLevelGain take exactly the three objects the
 * manager already holds, so this is real per-member, per-task arithmetic rather than the
 * hardcoded stat thresholds the ladder uses. Without Formulas.exe the ladder stays: there
 * is no way to compute real per-task gains, and a hand-derived approximation of the game's
 * scaling would be a guess dressed up as an improvement.
 *
 * @param {NS} ns
 * @param {any} member
 * @param {any} gangInfo
 * @param {string[]} taskNames  empty without Formulas.exe
 * @param {boolean} preferRespect  whether this member is one of the respectChasers
 */
function rankedTask(ns, member, gangInfo, taskNames, preferRespect) {
  if (taskNames.length === 0) return null;

  const scored = taskNames.map((name) => {
    const stats = ns.gang.getTaskStats(name);
    return {
      name,
      money: ns.formulas.gang.moneyGain(gangInfo, member, stats),
      respect: ns.formulas.gang.respectGain(gangInfo, member, stats),
      wanted: ns.formulas.gang.wantedLevelGain(gangInfo, member, stats),
    };
  });

  return selectBestTask(scored, {
    needWantedReduction: needsWantedReduction(gangInfo),
    preferRespect,
  });
}

function tryRecruit(ns) {
  while (ns.gang.canRecruitMember()) {
    const name = nextMemberName(ns.gang.getMemberNames());
    if (!ns.gang.recruitMember(name)) break;
    log(ns, `Recruited: ${name}`);
  }
}

function tryAscend(ns, name, isHacking) {
  if (!shouldAscend(ns.gang.getAscensionResult(name), { isHacking })) return;
  ns.gang.ascendMember(name);
  log(ns, `Ascended ${name}`);
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

/** @param {NS} ns */
export async function main(ns) {
  ns.disableLog("ALL");

  if (!hasGangAPI(ns)) {
    ns.print("ERROR: Gang API required (Source-File 2 or BitNode 2). Must create gang first.");
    return;
  }

  // Formulas.exe turns task selection from a threshold ladder into exact per-member
  // arithmetic. Checked once: the file cannot disappear mid-run.
  const useFormulas = hasFormulas(ns);
  log(ns, `Gang Manager started (task ranking: ${useFormulas ? "formulas" : "ladder"})`);

  let trainNow = false;
  while (true) {
    // Manual override from tools/gang-train.js, re-read every cycle.
    const wantTrain = getConfig(ns).gangTrainNow === true;
    if (wantTrain !== trainNow) {
      trainNow = wantTrain;
      log(ns, `Train-now: ${trainNow ? "ON — every member training" : "OFF"}`);
    }

    // Recruit first, so the gang information below already reflects a full roster.
    tryRecruit(ns);

    const gangInfo = ns.gang.getGangInformation();
    const rosterFull = gangInfo.respectForNextRecruit === Infinity;

    // Ascend before reading members: ascension resets stats, and the power plan below
    // should see the members as they now are.
    const names = ns.gang.getMemberNames();
    for (const name of names) tryAscend(ns, name, gangInfo.isHacking);
    const members = names.map((name) => ns.gang.getMemberInformation(name));

    // Warfare is planned before tasks are handed out: building power means the strongest
    // members on "Territory Warfare".
    const builders = powerBuilders(members);
    const rivals = Object.entries(ns.gang.getAllGangInformation())
      .filter(([name]) => name !== gangInfo.faction)
      .map(([name, info]) => ({ name, territory: info.territory, chance: ns.gang.getChanceToWinClash(name) }));
    const war = planWarfare({ territory: gangInfo.territory, rosterFull, builderPower: builders.power, rivals });

    if (gangInfo.territoryWarfareEngaged !== war.engage) {
      ns.gang.setTerritoryWarfare(war.engage);
      log(ns, `Territory warfare: ${war.engage ? "ENABLED" : "DISABLED"}`);
    }

    // Fetch the equipment catalog and task list once per cycle, not once per member.
    const catalogue = rankedCatalogue(ns, !gangInfo.isHacking);
    const taskNames = useFormulas ? ns.gang.getTaskNames() : [];

    // Recruiting is gated on respect, so part of the roster chases it until the roster is
    // full; the rest keep earning.
    const chasers = respectChasers(names, rosterFull);

    let totalIncome = 0;
    const roster = [];
    for (const member of members) {
      const { name } = member;
      const ranked = rankedTask(ns, member, gangInfo, taskNames, chasers.has(name));
      const buildPower = war.buildPower && builders.names.has(name);
      const task = chooseTask(member, gangInfo, { buildPower, ranked, trainNow });

      if (member.task !== task) {
        ns.gang.setMemberTask(name, task);
      }

      roster.push({ name, owned: [...member.upgrades, ...member.augmentations] });
      totalIncome += member.moneyGain;
    }

    const purchases = planEquipmentPurchases(roster, catalogue, ns.getPlayer().money, {
      itemFraction: EQUIP_ITEM_FRACTION,
      budgetFraction: DEFAULTS.gangEquipBudgetPercent,
    });
    for (const { member, item } of purchases) {
      ns.gang.purchaseEquipment(member, item);
    }

    /** @type {GangStatus} */
    const status = {
      members: roster.length,
      income: totalIncome,
      territory: gangInfo.territory,
      respect: gangInfo.respect,
      wantedPenalty: gangInfo.wantedPenalty,
      warfare: war.engage,
    };
    writePortData(ns, PORTS.GANG_STATUS, status);

    await ns.sleep(10000);
  }
}
