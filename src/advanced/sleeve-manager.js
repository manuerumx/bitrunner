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
    ns.print("ERROR: Sleeve API required (Source-File 10)");
    return;
  }

  const numSleeves = ns.sleeve.getNumSleeves();
  log(ns, `Sleeve Manager started (${numSleeves} sleeves)`);

  while (true) {
    for (let i = 0; i < numSleeves; i++) {
      const task = getSleeveTask(ns, i, numSleeves);

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

    await ns.sleep(30000);
  }
}
