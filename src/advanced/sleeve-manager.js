import { DEFAULTS } from "/src/lib/constants.js";
import { fallbackCrime } from "/src/lib/crime.js";
import {
  assignFactions,
  canBuySleeveAugs,
  chooseSleeveTask,
  needsKarma,
  needsReassignment,
  planSleeveSpending,
} from "/src/lib/sleeves.js";
import { log, formatMoney } from "/src/lib/utils.js";

function hasSleeveAPI(ns) {
  try {
    ns.sleeve.getNumSleeves();
    return true;
  } catch {
    return false;
  }
}

// A faction the game refused (no work a sleeve can do, e.g. a gang faction, or the player is
// working it right now) is skipped for this long before being tried again. Retrying every
// cycle would bounce the sleeve between the faction attempt and its fallback crime, and
// each switch throws away the crime's progress.
const FACTION_RETRY_MS = 5 * 60 * 1000;

/** @param {NS} ns */
function canCreateGang(ns) {
  const info = ns.getResetInfo();
  return info.currentNode === 2 || (info.ownedSF.get(2) ?? 0) > 0;
}

/** @param {NS} ns */
function isInGang(ns) {
  try {
    return ns.gang.inGang();
  } catch {
    return false;
  }
}

/**
 * Try each faction work type until the game accepts one. setToFactionWork returns false
 * for a work type the faction doesn't offer, and throws when another sleeve or the player
 * already works that faction.
 *
 * @param {NS} ns
 * @param {number} sleeveNum
 * @param {string} faction
 * @param {FactionWorkType[]} workTypes
 */
function startFactionWork(ns, sleeveNum, faction, workTypes) {
  for (const workType of workTypes) {
    try {
      const name = /** @type {FactionName} */ (faction);
      if (ns.sleeve.setToFactionWork(sleeveNum, name, workType)) return true;
    } catch {}
  }
  return false;
}

/**
 * Spend the sleeve budget on a new sleeve and on memory upgrades.
 *
 * Both purchases are permanent, and memory is the highest-value sleeve spend in the game
 * because it survives resets. The budget fraction keeps this from competing with
 * augmentation-buyer.js for the same cash.
 *
 * @param {NS} ns
 * @param {number} numSleeves
 */
function buySleeveCapacity(ns, numSleeves) {
  let sleeveCost = null;
  try {
    sleeveCost = ns.sleeve.getSleeveCost();
  } catch {
    // no more sleeves for sale (or not in a BitNode that sells them)
  }

  const memoryCosts = [];
  for (let i = 0; i < numSleeves; i++) {
    try {
      memoryCosts.push({ sleeveNum: i, cost: ns.sleeve.getMemoryUpgradeCost(i, 1) });
    } catch {
      // memory already maxed on this sleeve
    }
  }

  const plan = planSleeveSpending({
    money: ns.getPlayer().money,
    reserveFraction: 1 - DEFAULTS.sleeveBudgetPercent,
    sleeveCost,
    memoryCosts,
  });

  // Unlike the setTo* calls, purchaseSleeve/upgradeMemory return a Result object, not a
  // boolean — `if (result)` would always be true, so the outcome has to be read off
  // `.success` or every attempt would log as a purchase.
  for (const item of plan.buy) {
    try {
      if (item.name === "sleeve") {
        const result = ns.sleeve.purchaseSleeve();
        if (result.success) log(ns, `Bought a new sleeve for ${formatMoney(item.cost)}`);
        else log(ns, `Sleeve purchase rejected: ${result.message}`);
      } else if (item.sleeveNum !== undefined) {
        const result = ns.sleeve.upgradeMemory(item.sleeveNum, 1);
        if (result.success) {
          log(ns, `Sleeve ${item.sleeveNum}: +1 memory for ${formatMoney(item.cost)}`);
        }
      }
    } catch {}
  }
}

/** @param {NS} ns */
export async function main(ns) {
  ns.disableLog("ALL");

  if (!hasSleeveAPI(ns)) {
    ns.print("ERROR: Sleeve API required (Source-File 10)");
    return;
  }

  log(ns, `Sleeve Manager started (${ns.sleeve.getNumSleeves()} sleeves)`);

  const canGang = canCreateGang(ns);
  const workShock = DEFAULTS.sleeveWorkShock;
  // Kept inside main, not at module level: Bitburner shares module state between every
  // running instance of a script. faction → time it may be tried again.
  /** @type {Map<string, number>} */
  const rejectedFactions = new Map();

  while (true) {
    // Re-read every cycle. This used to be read once before the loop, so a sleeve bought
    // mid-run — including by this manager's own purchase step below — was never assigned
    // work until the daemon restarted the script.
    const numSleeves = ns.sleeve.getNumSleeves();
    const player = ns.getPlayer();
    const needKarma = needsKarma({ karma: player.karma, inGang: isInGang(ns), canGang });

    const now = Date.now();
    for (const [faction, retryAt] of rejectedFactions) {
      if (retryAt <= now) rejectedFactions.delete(faction);
    }

    const sleeves = [];
    for (let i = 0; i < numSleeves; i++) {
      sleeves.push({ sleeveNum: i, info: ns.sleeve.getSleeve(i), live: ns.sleeve.getTask(i) });
    }

    // Most recently joined first, which is usually the faction whose augmentations are next.
    const factions = assignFactions(
      sleeves.map((s) => ({
        sleeveNum: s.sleeveNum,
        eligible: s.info.shock <= workShock && s.info.sync >= 100 && !needKarma,
        current: s.live?.type === "FACTION" ? s.live.factionName : null,
      })),
      [...player.factions].reverse(),
      { exclude: [...rejectedFactions.keys()] },
    );

    for (const { sleeveNum: i, info, live } of sleeves) {
      const task = chooseSleeveTask(info, {
        needKarma,
        faction: factions.get(i) ?? null,
        workShock,
      });

      // Re-issuing an assignment restarts the task, discarding progress: crimes and
      // faction work accumulate cycles toward a payout, so a 30 s reassignment loop can
      // hold a sleeve permanently at zero. Only act when the live task differs.
      if (!needsReassignment(live, task)) continue;

      try {
        switch (task.type) {
          case "recovery":
            ns.sleeve.setToShockRecovery(i);
            break;
          case "sync":
            ns.sleeve.setToSynchronize(i);
            break;
          case "faction":
            if (!startFactionWork(ns, i, task.faction, task.workTypes)) {
              rejectedFactions.set(task.faction, now + FACTION_RETRY_MS);
              // Don't leave the sleeve idle until the next cycle picks another faction.
              ns.sleeve.setToCommitCrime(i, fallbackCrime(info.skills));
              log(ns, `Sleeve ${i}: ${task.faction} rejected faction work, skipping it for now`);
            }
            break;
          case "crime":
            ns.sleeve.setToCommitCrime(i, task.crime);
            break;
        }
      } catch {}
    }

    // Augmentations only sell at zero shock. Cheapest first, re-reading money after each
    // buy so one cycle can't spend past the 1% cap.
    for (const { sleeveNum: i, info } of sleeves) {
      if (!canBuySleeveAugs(info)) continue;
      const augs = ns.sleeve.getSleevePurchasableAugs(i).sort((a, b) => a.cost - b.cost);
      for (const aug of augs) {
        if (aug.cost >= ns.getPlayer().money * 0.01) break;
        let bought = false;
        try {
          bought = ns.sleeve.purchaseSleeveAug(i, aug.name);
        } catch (e) {
          log(ns, `Sleeve ${i}: ${aug.name} purchase failed: ${e}`);
        }
        if (bought) log(ns, `Sleeve ${i}: bought ${aug.name} for ${formatMoney(aug.cost)}`);
        else break;
      }
    }

    // Buy sleeves and memory. A new sleeve compounds — it earns from the moment it exists —
    // so it outranks memory on an existing one. Both are permanent: memory survives an
    // augmentation install, unlike shock and sync which reset with the run.
    buySleeveCapacity(ns, numSleeves);

    await ns.sleep(30000);
  }
}
