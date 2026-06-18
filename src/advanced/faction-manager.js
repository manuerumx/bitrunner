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

// City factions are mutually exclusive — joining one permanently bars the others.
const CITY_FACTIONS = ["Sector-12", "Aevum", "Volhaven", "Chongqing", "New Tokyo", "Ishima"];

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

// Pick the joined faction most worth grinding rep for RIGHT NOW: the one with the most augs
// we still can't afford the reputation for. Factions whose augs are all already within reach
// score 0 and are skipped, so once we max a faction we advance to the next instead of parking
// idle on a faction we've already finished.
function getBestFactionForWork(ns) {
  const factions = getJoinedFactions(ns);
  let bestFaction = null;
  let bestScore = 0;

  for (const faction of factions) {
    const augs = getAvailableAugs(ns, faction);
    if (augs.length === 0) continue;

    const currentRep = ns.singularity.getFactionRep(faction);
    const augsNeedingRep = augs.filter((a) => ns.singularity.getAugmentationRepReq(a) > currentRep);
    if (augsNeedingRep.length === 0) continue; // already grindable here → look elsewhere

    const hasPriority = augsNeedingRep.some((a) => PRIORITY_AUGS.includes(a));
    const score = augsNeedingRep.length + (hasPriority ? 100 : 0);

    if (score > bestScore) {
      bestScore = score;
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
    let inCityFaction = getJoinedFactions(ns).some((f) => CITY_FACTIONS.includes(f));
    for (const faction of invitations) {
      // Only auto-join a city faction if we're not already committed to one (they're mutually
      // exclusive); claim the first, skip the rest, so we don't blindly forfeit augs.
      if (CITY_FACTIONS.includes(faction)) {
        if (inCityFaction) continue;
        inCityFaction = true;
      }
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

      // bestFaction is only returned while it still has augs needing rep, so always grind it.
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

      /** @type {FactionStatus} */
      const status = {
        currentFaction: bestFaction,
        rep: ns.singularity.getFactionRep(bestFaction),
        targetRep: maxRepNeeded,
        availableAugs: augs.length,
      };
      writePortData(ns, PORTS.FACTION_STATUS, status);
    } else {
      // No joined faction has augs we still need rep for — nothing to grind this cycle.
      /** @type {FactionStatus} */
      const status = { currentFaction: null, rep: 0, targetRep: 0, availableAugs: 0 };
      writePortData(ns, PORTS.FACTION_STATUS, status);
    }

    await ns.sleep(30000);
  }
}
