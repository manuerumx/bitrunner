import { log, formatMoney } from "/src/lib/utils.js";
import { scanNetwork } from "/src/lib/scanner.js";
import { PORTS } from "/src/lib/constants.js";
import { writePortData } from "/src/lib/port-registry.js";

const PRIORITY_AUGS = [
  "CashRoot Starter Kit",
  "Neuroreceptor Management Implant",
  "BitRunners Neurolink",
  "The Black Hand",
  "Artificial Synaptic Potentiation",
  "Enhanced Myelin Sheathing",
  "Synaptic Enhancement Implant",
  "Neural-Retention Enhancement",
  "Cranial Signal Processors - Gen I",
  "Cranial Signal Processors - Gen II",
  "Cranial Signal Processors - Gen III",
  "Cranial Signal Processors - Gen IV",
  "Cranial Signal Processors - Gen V",
  "Neurotrainer I",
  "Neurotrainer II",
  "Neurotrainer III",
];

function hasSingularity(ns) {
  try {
    ns.singularity.getCurrentWork();
    return true;
  } catch {
    return false;
  }
}

function getJoinedFactions(ns) {
  try {
    return ns.getPlayer().factions;
  } catch {
    return [];
  }
}

function getAvailableAugs(ns, faction) {
  try {
    const augs = ns.singularity.getAugmentationsFromFaction(faction);
    const owned = ns.singularity.getOwnedAugmentations(true);
    return augs.filter((a) => !owned.includes(a) && a !== "NeuroFlux Governor");
  } catch {
    return [];
  }
}

function getBestFactionForWork(ns) {
  const factions = getJoinedFactions(ns);
  let bestFaction = null;
  let bestAugCount = 0;

  for (const faction of factions) {
    const augs = getAvailableAugs(ns, faction);
    const hasPriority = augs.some((a) => PRIORITY_AUGS.includes(a));
    const score = augs.length + (hasPriority ? 100 : 0);

    if (score > bestAugCount) {
      bestAugCount = score;
      bestFaction = faction;
    }
  }

  return bestFaction;
}

/** @param {NS} ns */
export async function main(ns) {
  ns.disableLog("ALL");

  if (!hasSingularity(ns)) {
    ns.print("ERROR: Singularity API required (Source-File 4)");
    return;
  }

  log(ns, "Faction Manager started");

  while (true) {
    const invitations = ns.singularity.checkFactionInvitations();
    for (const faction of invitations) {
      ns.singularity.joinFaction(faction);
      log(ns, `Joined faction: ${faction}`);
    }

    const currentWork = ns.singularity.getCurrentWork();
    const bestFaction = getBestFactionForWork(ns);

    if (bestFaction) {
      const augs = getAvailableAugs(ns, bestFaction);
      let maxRepNeeded = 0;
      for (const aug of augs) {
        const repReq = ns.singularity.getAugmentationRepReq(aug);
        maxRepNeeded = Math.max(maxRepNeeded, repReq);
      }

      const currentRep = ns.singularity.getFactionRep(bestFaction);

      if (currentRep < maxRepNeeded) {
        const isWorkingForBest = currentWork && currentWork.type === "FACTION" && currentWork.factionName === bestFaction;

        if (!isWorkingForBest) {
          try {
            ns.singularity.workForFaction(bestFaction, "hacking", false);
            log(ns, `Working for ${bestFaction} (${augs.length} augs, need ${formatMoney(maxRepNeeded)} rep)`);
          } catch {
            try {
              ns.singularity.workForFaction(bestFaction, "field", false);
            } catch {
              try {
                ns.singularity.workForFaction(bestFaction, "security", false);
              } catch {}
            }
          }
        }
      }

      writePortData(ns, PORTS.FACTION_STATUS, {
        currentFaction: bestFaction,
        rep: ns.singularity.getFactionRep(bestFaction),
        targetRep: maxRepNeeded,
        availableAugs: augs.length,
      });
    }

    await ns.sleep(30000);
  }
}
