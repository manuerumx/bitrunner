import { DEFAULTS } from "/src/lib/constants.js";
import { needsReassignment, planSleeveSpending } from "/src/lib/sleeves.js";
import { log, formatMoney } from "/src/lib/utils.js";

function hasSleeveAPI(ns) {
  try {
    ns.sleeve.getNumSleeves();
    return true;
  } catch {
    return false;
  }
}

/**
 * @param {NS} ns
 * @returns {{ type: "recovery" } | { type: "sync" }
 *   | { type: "faction", faction: FactionName, workType: FactionWorkType }
 *   | { type: "gym", stat: GymType }
 *   | { type: "crime", crime: CrimeType }}
 */
function getSleeveTask(ns, sleeveNum, totalSleeves) {
  const sleeve = ns.sleeve.getSleeve(sleeveNum);

  if (sleeve.shock > 50) return { type: "recovery" };

  if (sleeve.sync < 100) return { type: "sync" };

  const player = ns.getPlayer();
  const factions = player.factions;

  if (sleeveNum === 0 && factions.length > 0) {
    return { type: "faction", faction: factions[factions.length - 1], workType: "hacking" };
  }

  if (sleeveNum === 1) {
    return { type: "gym", stat: "str" };
  }

  if (sleeveNum === 2) {
    return { type: "crime", crime: "Homicide" };
  }

  return { type: "crime", crime: "Mug" };
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

  while (true) {
    // Re-read every cycle. This used to be read once before the loop, so a sleeve bought
    // mid-run — including by this manager's own purchase step below — was never assigned
    // work until the daemon restarted the script.
    const numSleeves = ns.sleeve.getNumSleeves();

    for (let i = 0; i < numSleeves; i++) {
      const task = getSleeveTask(ns, i, numSleeves);

      // Re-issuing an assignment restarts the task, discarding progress: crimes and
      // faction work accumulate cycles toward a payout, so a 30 s reassignment loop can
      // hold a sleeve permanently at zero. Only act when the live task differs.
      if (!needsReassignment(ns.sleeve.getTask(i), task)) continue;

      try {
        let ok = true;
        switch (task.type) {
          case "recovery":
            ok = ns.sleeve.setToShockRecovery(i);
            break;
          case "sync":
            ok = ns.sleeve.setToSynchronize(i);
            break;
          case "faction":
            ok = ns.sleeve.setToFactionWork(i, task.faction, task.workType);
            break;
          case "gym":
            ok = ns.sleeve.setToGymWorkout(i, "Powerhouse Gym", task.stat);
            break;
          case "crime":
            ok = ns.sleeve.setToCommitCrime(i, task.crime);
            break;
        }
        if (ok === false) {
          // Assignment was rejected (e.g. the faction doesn't offer that work type). Don't leave
          // the sleeve idle — fall back to a crime, which is always available.
          ns.sleeve.setToCommitCrime(i, "Mug");
          log(ns, `Sleeve ${i}: ${task.type} rejected, fell back to crime`);
        }
      } catch {}
    }

    const money = ns.getPlayer().money;
    for (let i = 0; i < numSleeves; i++) {
      const augs = ns.sleeve.getSleevePurchasableAugs(i);
      for (const aug of augs) {
        if (aug.cost < money * 0.01) {
          try {
            ns.sleeve.purchaseSleeveAug(i, aug.name);
            log(ns, `Sleeve ${i}: bought ${aug.name}`);
          } catch {}
        }
      }
    }

    // Buy sleeves and memory. A new sleeve compounds — it earns from the moment it exists —
    // so it outranks memory on an existing one. Both are permanent: memory survives an
    // augmentation install, unlike shock and sync which reset with the run.
    buySleeveCapacity(ns, numSleeves);

    await ns.sleep(30000);
  }
}
