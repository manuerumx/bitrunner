import { log } from "/src/lib/utils.js";

function hasSleeveAPI(ns) {
  try {
    ns.sleeve.getNumSleeves();
    return true;
  } catch {
    return false;
  }
}

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

/** @param {NS} ns */
export async function main(ns) {
  ns.disableLog("ALL");

  if (!hasSleeveAPI(ns)) {
    ns.tprint("ERROR: Sleeve API required (Source-File 10)");
    return;
  }

  const numSleeves = ns.sleeve.getNumSleeves();
  log(ns, `Sleeve Manager started (${numSleeves} sleeves)`);

  while (true) {
    for (let i = 0; i < numSleeves; i++) {
      const task = getSleeveTask(ns, i, numSleeves);

      try {
        switch (task.type) {
          case "recovery":
            ns.sleeve.setToShockRecovery(i);
            break;
          case "sync":
            ns.sleeve.setToSynchronize(i);
            break;
          case "faction":
            ns.sleeve.setToFactionWork(i, task.faction, task.workType);
            break;
          case "gym":
            ns.sleeve.setToGymWorkout(i, "Powerhouse Gym", task.stat);
            break;
          case "crime":
            ns.sleeve.setToCommitCrime(i, task.crime);
            break;
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

    await ns.sleep(30000);
  }
}
