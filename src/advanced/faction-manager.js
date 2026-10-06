import { log, formatMoney } from "/src/lib/utils.js";
import { scanNetwork } from "/src/lib/scanner.js";
import { PORTS } from "/src/lib/constants.js";
import { writePortData } from "/src/lib/port-registry.js";
import { companiesToUnlock } from "/src/lib/companies.js";
import { FACTION_WORK_TYPES, betterFactionWorkTypes } from "/src/lib/faction-work.js";

// Yielded to while it runs — see the takeover guard in the work loop below.
const CRIME_WORKER = "/src/tools/crime-worker.js";

/**
 * Is the crime loop running, whatever arguments it was launched with?
 *
 * ns.isRunning would be the obvious call and is WRONG here: a script is keyed by filename
 * PLUS arguments (NetscriptDefinitions.d.ts:8367), so isRunning(CRIME_WORKER, "home") only
 * matches a zero-argument launch. `crime.js start karma` would have slipped straight past
 * this guard and had its crime cancelled every 30 s — the exact failure the guard exists to
 * prevent, visible only in the non-default modes. ns.ps matches on filename alone (0.2 GB).
 *
 * @param {NS} ns
 */
function crimeLoopRunning(ns) {
  return ns.ps("home").some((proc) => proc.filename === CRIME_WORKER);
}

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

// Joined factions worth grinding rep for RIGHT NOW, best first: those with augs we still
// can't afford the reputation for, most such augs first. Factions whose augs are all already
// within reach are left out, so once we max a faction we advance to the next instead of
// parking idle on a faction we've already finished. The player works the first; the whole
// list is published so sleeve-manager.js can put sleeves on the rest.
function getPendingFactions(ns) {
  const scored = [];

  for (const faction of getJoinedFactions(ns)) {
    const augs = getAvailableAugs(ns, faction);
    if (augs.length === 0) continue;

    const currentRep = ns.singularity.getFactionRep(faction);
    const augsNeedingRep = augs.filter((a) => ns.singularity.getAugmentationRepReq(a) > currentRep);
    if (augsNeedingRep.length === 0) continue; // already grindable here → look elsewhere

    const hasPriority = augsNeedingRep.some((a) => PRIORITY_AUGS.includes(a));
    scored.push({ faction, score: augsNeedingRep.length + (hasPriority ? 100 : 0) });
  }

  // Stable sort, so ties keep join order — the same pick the old strict `>` scan made.
  return scored.sort((a, b) => b.score - a.score).map((s) => s.faction);
}

// Hold a job at every megacorp whose faction isn't joined yet. The player never works
// these: a sleeve can only work at a company where the player is employed, and
// sleeve-manager.js sends idle sleeves there to earn the 400k company rep the faction
// invitation needs. Re-applying every cycle is also how promotions are picked up —
// applyToCompany returns null when there is nothing new to get, including when hacking
// is still too low to be hired at all.
function holdCompanyJobs(ns) {
  for (const company of companiesToUnlock(getJoinedFactions(ns))) {
    try {
      const job = ns.singularity.applyToCompany(company, "Software");
      if (job) log(ns, `${company}: now ${job}`);
    } catch {}
  }
}

// Start working for a faction, taking the first of workTypes it offers (best first, see
// FACTION_WORK_TYPES).
//
// workForFaction does NOT throw when it can't start: it returns false — for a work type
// the faction doesn't offer, and for every type when the faction is the player's gang
// (a gang faction's reputation comes from the gang, never from working for it). The old
// try/catch chain therefore never reached field or security work, and logged "Working
// for" a faction it had failed to start.
function startFactionWork(ns, faction, workTypes = FACTION_WORK_TYPES) {
  for (const workType of workTypes) {
    try {
      if (ns.singularity.workForFaction(faction, workType, false)) return true;
    } catch {}
  }
  return false;
}

/** @param {NS} ns */
export async function main(ns) {
  ns.disableLog("ALL");

  if (!hasSingularity(ns)) {
    ns.print("ERROR: Singularity API required (Source-File 4)");
    return;
  }

  log(ns, "Faction Manager started");

  // Factions that refused every work type, i.e. the gang faction. Left out of the ranking
  // from then on: it would otherwise sit at the top of the list forever (a gang faction
  // has dozens of augs) and block the grind for every faction below it. Kept inside main,
  // not at module level — Bitburner shares module state between running instances.
  /** @type {Set<string>} */
  const unworkable = new Set();

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

    holdCompanyJobs(ns);

    const currentWork = ns.singularity.getCurrentWork();
    // Computed before the yield below: sleeves keep working factions while the player
    // grafts or runs the crime loop.
    let pendingFactions = getPendingFactions(ns).filter((f) => !unworkable.has(f));

    // Never interrupt a graft. tools/grafting.js buys augmentations with money instead of
    // reputation — the very constraint this manager exists to grind against — and
    // workForFaction() would cancel it. Grafting appears as its own work type
    // (GraftingTask), so it is distinguishable from ordinary faction work.
    //
    // Same yield for the crime loop, which is likewise a deliberate takeover of the player.
    // THE TRADE IS EXPLICIT: while tools/crime-worker.js runs, reputation stops
    // accumulating entirely. Gated on the worker being alive rather than on
    // currentWork.type === "CRIME", for two reasons: a crime the player started by hand
    // should not silently mute the rep grind forever, and killing the worker must hand the
    // player straight back — which it does, on this manager's next cycle.
    if ((currentWork && currentWork.type === "GRAFTING") || crimeLoopRunning(ns)) {
      /** @type {FactionStatus} */
      const status = { currentFaction: null, rep: 0, targetRep: 0, availableAugs: 0, pendingFactions };
      writePortData(ns, PORTS.FACTION_STATUS, status);
      await ns.sleep(30000);
      continue;
    }

    // The best faction we can actually work: already on it, or it accepts the work now.
    let bestFaction = null;
    let justStarted = false;
    for (const faction of pendingFactions) {
      const alreadyOnIt = currentWork && currentWork.type === "FACTION" && currentWork.factionName === faction;
      if (alreadyOnIt) {
        // Move up to a better work type if the faction offers one, e.g. hacking → field.
        const better = betterFactionWorkTypes(currentWork.factionWorkType);
        if (better.length > 0 && startFactionWork(ns, faction, better)) {
          log(ns, `${faction}: switched from ${currentWork.factionWorkType} work to a better type`);
        }
        bestFaction = faction;
        break;
      }
      if (startFactionWork(ns, faction)) {
        bestFaction = faction;
        justStarted = true;
        break;
      }
      unworkable.add(faction);
      log(ns, `${faction} offers no work (gang faction?) — skipping it from now on`);
    }
    // Sleeves can't work those factions either.
    pendingFactions = pendingFactions.filter((f) => !unworkable.has(f));

    if (bestFaction) {
      const augs = getAvailableAugs(ns, bestFaction);
      let maxRepNeeded = 0;
      for (const aug of augs) {
        const repReq = ns.singularity.getAugmentationRepReq(aug);
        maxRepNeeded = Math.max(maxRepNeeded, repReq);
      }

      if (justStarted) {
        log(ns, `Working for ${bestFaction} (${augs.length} augs, need ${formatMoney(maxRepNeeded)} rep)`);
      }

      /** @type {FactionStatus} */
      const status = {
        currentFaction: bestFaction,
        rep: ns.singularity.getFactionRep(bestFaction),
        targetRep: maxRepNeeded,
        availableAugs: augs.length,
        pendingFactions,
      };
      writePortData(ns, PORTS.FACTION_STATUS, status);
    } else {
      // No joined faction has augs we still need rep for — nothing to grind this cycle.
      /** @type {FactionStatus} */
      const status = { currentFaction: null, rep: 0, targetRep: 0, availableAugs: 0, pendingFactions };
      writePortData(ns, PORTS.FACTION_STATUS, status);
    }

    await ns.sleep(30000);
  }
}
