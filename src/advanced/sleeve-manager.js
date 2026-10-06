import { sleeveCompanies } from "/src/lib/companies.js";
import { DEFAULTS, PORTS } from "/src/lib/constants.js";
import { hasFormulas } from "/src/lib/formulas.js";
import { readPortData } from "/src/lib/port-registry.js";
import {
  assignCompanies,
  assignFactions,
  canBuySleeveAugs,
  chooseSleeveCrime,
  chooseSleeveTask,
  factionWorkOrder,
  needsKarma,
  needsReassignment,
  planSleeveSpending,
  spareFactions,
} from "/src/lib/sleeves.js";
// Imported directly, not re-exported through sleeves.js: the game's RAM calculator
// doesn't follow `export ... from` and fails with "Could not calculate ram usage".
import { betterFactionWorkTypes } from "/src/lib/faction-work.js";
import { log, formatMoney } from "/src/lib/utils.js";

function hasSleeveAPI(ns) {
  try {
    ns.sleeve.getNumSleeves();
    return true;
  } catch {
    return false;
  }
}

// A faction or company the game refused (no work a sleeve can do, e.g. a gang faction) is
// skipped for this long before being tried again.
// Retrying every cycle would bounce the sleeve between the attempt and its fallback crime,
// and each switch throws away the crime's progress.
const WORK_RETRY_MS = 5 * 60 * 1000;

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
 * The player's gang faction, or null. Nobody can work for it — its reputation comes from
 * the gang — so it is never offered to a sleeve.
 *
 * @param {NS} ns
 */
function gangFaction(ns) {
  try {
    return ns.gang.inGang() ? ns.gang.getGangInformation().faction : null;
  } catch {
    return null;
  }
}

/**
 * Try each faction work type until the game accepts one. setToFactionWork returns false
 * for a work type the faction doesn't offer, and throws when another sleeve
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
  // Holds companies as well. A megacorp and its faction share a name, but a company is
  // only offered while its faction isn't joined, so the two never collide.
  /** @type {Map<string, number>} */
  const rejectedWork = new Map();

  while (true) {
    // Re-read every cycle. This used to be read once before the loop, so a sleeve bought
    // mid-run — including by this manager's own purchase step below — was never assigned
    // work until the daemon restarted the script.
    const numSleeves = ns.sleeve.getNumSleeves();
    const player = ns.getPlayer();
    const needKarma = needsKarma({ karma: player.karma, inGang: isInGang(ns), canGang });

    const now = Date.now();
    for (const [faction, retryAt] of rejectedWork) {
      if (retryAt <= now) rejectedWork.delete(faction);
    }

    const sleeves = [];
    for (let i = 0; i < numSleeves; i++) {
      sleeves.push({ sleeveNum: i, info: ns.sleeve.getSleeve(i), live: ns.sleeve.getTask(i) });
    }

    const workReady = (s) => s.info.shock <= workShock && s.info.sync >= 100 && !needKarma;
    const rejected = [...rejectedWork.keys()];
    const gang = gangFaction(ns);
    if (gang) rejected.push(gang);

    // Factions with augmentations still needing rep, as published by faction-manager.js.
    const factionStatus = /** @type {FactionStatus | null} */ (readPortData(ns, PORTS.FACTION_STATUS));
    const factions = assignFactions(
      sleeves.map((s) => ({
        sleeveNum: s.sleeveNum,
        eligible: workReady(s),
        current: s.live?.type === "FACTION" ? s.live.factionName : null,
      })),
      factionWorkOrder(player.factions, factionStatus),
      { exclude: rejected },
    );

    // Sleeves left without a faction go to a company whose faction is still locked.
    const companies = assignCompanies(
      sleeves.map((s) => ({
        sleeveNum: s.sleeveNum,
        eligible: workReady(s) && !factions.get(s.sleeveNum),
        current: s.live?.type === "COMPANY" ? s.live.companyName : null,
      })),
      sleeveCompanies(player.jobs, player.factions),
      { exclude: rejected },
    );

    // Sleeves with neither go to a joined faction that has no augmentation left needing
    // rep: the rep still becomes favor and NeuroFlux levels, which beats a money crime.
    const taken = [...factions.values()].filter((f) => f !== null);
    const spares = assignFactions(
      sleeves.map((s) => ({
        sleeveNum: s.sleeveNum,
        eligible: workReady(s) && !factions.get(s.sleeveNum) && !companies.get(s.sleeveNum),
        current: s.live?.type === "FACTION" ? s.live.factionName : null,
      })),
      spareFactions(player.factions, factionStatus),
      { exclude: [...rejected, ...taken] },
    );

    // Exact success chances for 0 GB when Formulas.exe is owned; otherwise chooseSleeveTask
    // uses lib/crime.js's port of the same formula. Re-checked each cycle because
    // program-buyer.js can buy the file mid-run.
    const chanceOf = hasFormulas(ns)
      ? (person, crime) => ns.formulas.work.crimeSuccessChance(person, crime)
      : undefined;

    for (const { sleeveNum: i, info, live } of sleeves) {
      const crimeCtx = {
        currentCrime: live?.type === "CRIME" ? live.crimeType : null,
        minChance: DEFAULTS.sleeveCrimeMinChance,
        chanceOf,
      };
      const task = chooseSleeveTask(info, {
        needKarma,
        faction: factions.get(i) ?? spares.get(i) ?? null,
        company: companies.get(i) ?? null,
        workShock,
        ...crimeCtx,
      });

      // Re-issuing an assignment restarts the task, discarding progress: crimes and
      // faction work accumulate cycles toward a payout, so a 30 s reassignment loop can
      // hold a sleeve permanently at zero. Only act when the live task differs.
      if (!needsReassignment(live, task)) {
        // Already on the right faction, possibly on a worse work type (hacking when field
        // is offered). Only better types are tried, so the live work is never restarted.
        if (task.type === "faction" && live?.type === "FACTION") {
          const better = betterFactionWorkTypes(live.factionWorkType);
          if (better.length > 0 && startFactionWork(ns, i, task.faction, better)) {
            log(ns, `Sleeve ${i}: ${task.faction} switched from ${live.factionWorkType} work`);
          }
        }
        continue;
      }

      // Don't leave the sleeve idle until the next cycle picks other work.
      const rejectWork = (name) => {
        rejectedWork.set(name, now + WORK_RETRY_MS);
        ns.sleeve.setToCommitCrime(i, chooseSleeveCrime(info, crimeCtx));
        log(ns, `Sleeve ${i}: ${name} rejected the sleeve, skipping it for now`);
      };

      try {
        switch (task.type) {
          case "recovery":
            ns.sleeve.setToShockRecovery(i);
            break;
          case "sync":
            ns.sleeve.setToSynchronize(i);
            break;
          case "faction":
            if (!startFactionWork(ns, i, task.faction, task.workTypes)) rejectWork(task.faction);
            break;
          case "company": {
            let started = false;
            try {
              started = ns.sleeve.setToCompanyWork(i, /** @type {CompanyName} */ (task.company));
            } catch {}
            if (started) log(ns, `Sleeve ${i}: working at ${task.company}`);
            else rejectWork(task.company);
            break;
          }
          case "crime":
            ns.sleeve.setToCommitCrime(i, task.crime);
            log(ns, `Sleeve ${i}: committing ${task.crime}`);
            // A sleeve on a money crime means every faction and company was taken or
            // unavailable. Say which, so "why isn't it working for a faction" has an answer.
            if (!needKarma) {
              const published = Array.isArray(factionStatus?.pendingFactions);
              log(ns, `  joined: ${player.factions.join(", ") || "none"}`);
              log(ns, `  pending (${published ? "published" : "NOT published"}): ${factionWorkOrder(player.factions, factionStatus).join(", ") || "none"}`);
              log(ns, `  skipped: ${rejected.join(", ") || "none"}`);
              log(ns, `  taken: ${[...taken, ...[...spares.values()].filter(Boolean)].join(", ") || "none"}`);
            }
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
