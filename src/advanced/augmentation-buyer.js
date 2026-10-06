import { AUG_CATEGORIES, AUG_STATS_FILE, augCategories, orderByPreference, parsePreference } from "/src/lib/augmentations.js";
import { log, tlog, formatMoney } from "/src/lib/utils.js";

//   --prefer hacking,rep   buy augs boosting these categories first (best first), most
//                          expensive first within each; the rest follow. Categories: hacking,
//                          combat, charisma, rep, hacknet, bladeburner, crime, work.
//                          Runs aug-stats-worker.js once for the stats.

const STATS_WORKER = "/src/tools/aug-stats-worker.js";

function hasSingularity(ns) {
  try {
    ns.singularity.getCurrentWork();
    return true;
  } catch {
    return false;
  }
}

function getAllAvailableAugs(ns) {
  const factions = ns.getPlayer().factions;
  const owned = ns.singularity.getOwnedAugmentations(true);
  const augMap = new Map();

  for (const faction of factions) {
    const augs = ns.singularity.getAugmentationsFromFaction(faction);
    for (const aug of augs) {
      if (owned.includes(aug)) continue;
      if (aug === "NeuroFlux Governor") continue;

      const repReq = ns.singularity.getAugmentationRepReq(aug);
      const price = ns.singularity.getAugmentationPrice(aug);
      const factionRep = ns.singularity.getFactionRep(faction);

      if (factionRep < repReq) continue;

      if (!augMap.has(aug) || augMap.get(aug).price > price) {
        augMap.set(aug, { name: aug, faction, price, repReq });
      }
    }
  }

  return [...augMap.values()].sort((a, b) => b.price - a.price);
}

function buyNeuroFlux(ns) {
  const factions = ns.getPlayer().factions;
  let bought = 0;

  // No fixed cap — NeuroFlux's price escalates each level, so the price-vs-money check below
  // terminates the loop naturally once the next level is unaffordable.
  while (true) {
    const price = ns.singularity.getAugmentationPrice("NeuroFlux Governor");
    if (price > ns.getPlayer().money) break;
    // Rep requirement also rises per level, so recompute once per level (not per faction).
    const repReq = ns.singularity.getAugmentationRepReq("NeuroFlux Governor");

    let purchased = false;
    for (const faction of factions) {
      try {
        if (ns.singularity.getFactionRep(faction) < repReq) continue;
        if (ns.singularity.purchaseAugmentation(faction, "NeuroFlux Governor")) {
          bought++;
          purchased = true;
          break;
        }
      } catch {
        continue;
      }
    }
    if (!purchased) break;
  }

  return bought;
}

/**
 * Stats of the named augmentations, via the one-shot worker so this script doesn't carry
 * getAugmentationStats' RAM. Null if the worker could not start.
 *
 * @param {NS} ns
 * @param {string[]} names
 * @returns {Promise<Record<string, Record<string, number>> | null>}
 */
async function fetchAugStats(ns, names) {
  const pid = ns.run(STATS_WORKER, 1, ...names);
  if (pid === 0) return null;
  while (ns.isRunning(pid)) await ns.sleep(200);
  try {
    const stats = JSON.parse(ns.read(AUG_STATS_FILE));
    return stats && typeof stats === "object" ? stats : null;
  } catch {
    return null;
  }
}

/** @param {NS} ns */
export async function main(ns) {
  ns.disableLog("ALL");

  if (!hasSingularity(ns)) {
    ns.tprint("ERROR: Singularity API required (Source-File 4)");
    return;
  }

  const flags = ns.flags([["prefer", ""]]);
  const installNow = flags._[0] === "install";
  const resetNow = flags._[1] === "reset";
  // NFG levels are a money dump: each level bought multiplies every OTHER aug's
  // price by 1.9x too, so buying them early makes the rest of the catalog
  // unreachable. Only dump into NFG when the leftover cash is about to be wiped
  // by a reset, or when explicitly asked to via 'nfg' (manual-install workflow).
  const dumpIntoNfg = resetNow || flags._[1] === "nfg";

  const { prefer, unknown } = parsePreference(String(flags.prefer));
  if (unknown.length > 0) {
    ns.tprint(`ERROR: unknown --prefer categor${unknown.length === 1 ? "y" : "ies"} ${unknown.join(", ")}. Use: ${AUG_CATEGORIES.join(", ")}`);
    return;
  }

  let augs = getAllAvailableAugs(ns);
  /** @type {Record<string, Record<string, number>>} */
  let stats = {};
  if (prefer.length > 0) {
    const fetched = await fetchAugStats(ns, augs.map((a) => a.name));
    if (fetched) {
      stats = fetched;
      augs = orderByPreference(augs, stats, prefer);
    } else {
      tlog(ns, `WARN: could not start ${STATS_WORKER} (not enough free RAM?) — using the default order.`);
    }
  }
  let totalCost = 0;
  let affordable = [];

  tlog(ns, `\n=== Augmentation Buyer ===`);
  tlog(ns, `Available augmentations: ${augs.length}`);
  tlog(ns, `Player money: ${formatMoney(ns.getPlayer().money)}`);
  if (prefer.length > 0 && Object.keys(stats).length > 0) tlog(ns, `Preferring: ${prefer.join(" > ")}`);
  tlog(ns, "");

  // Each purchase multiplies the price of all REMAINING augs by 1.9x. Augs are
  // sorted most-expensive-first (correct order to maximize count) unless --prefer
  // reordered them, so we compound the multiplier as we go — otherwise the estimate
  // is wildly over-optimistic and the later (cheaper) augs fail to purchase at runtime.
  const AUG_PRICE_MULT = 1.9;
  let simulatedMoney = ns.getPlayer().money;
  let priceMult = 1;
  for (const aug of augs) {
    const realPrice = aug.price * priceMult;
    const boosts = aug.name in stats ? ` (${[...augCategories(stats[aug.name])].join(", ") || "special"})` : "";
    if (realPrice <= simulatedMoney) {
      affordable.push(aug);
      tlog(ns, `  [CAN BUY] ${aug.name}${boosts} from ${aug.faction} - ${formatMoney(realPrice)}`);
      simulatedMoney -= realPrice;
      totalCost += realPrice;
      priceMult *= AUG_PRICE_MULT;
    } else {
      tlog(ns, `  [NEED $]  ${aug.name}${boosts} from ${aug.faction} - ${formatMoney(realPrice)}`);
    }
  }

  tlog(ns, "");
  tlog(ns, `Can afford: ${affordable.length} / ${augs.length}`);
  tlog(ns, `Total cost: ${formatMoney(totalCost)}`);

  if (installNow) {
    let purchased = 0;
    if (affordable.length > 0) {
      tlog(ns, "\nPurchasing augmentations...");
      for (const aug of affordable) {
        if (ns.singularity.purchaseAugmentation(aug.faction, aug.name)) {
          tlog(ns, `  BOUGHT: ${aug.name} from ${aug.faction}`);
          purchased++;
        } else {
          tlog(ns, `  FAILED: ${aug.name}`);
        }
      }
    }

    let nfg = 0;
    if (dumpIntoNfg) {
      nfg = buyNeuroFlux(ns);
      if (nfg > 0) {
        tlog(ns, `  BOUGHT: ${nfg}x NeuroFlux Governor`);
      }
      tlog(ns, `\nPurchased ${purchased} augmentations + ${nfg} NeuroFlux Governor`);
    } else {
      tlog(ns, `\nPurchased ${purchased} augmentations. NeuroFlux Governor skipped:`);
      tlog(ns, "leftover money is kept for future augs (each NFG level makes every other aug 1.9x pricier).");
      tlog(ns, "Add 'nfg' to dump leftovers into NFG, or 'reset' to dump and install.");
    }

    if (resetNow) {
      tlog(ns, "Installing augmentations and resetting...");
      ns.singularity.installAugmentations("src/daemon.js");
    } else {
      tlog(ns, "Run with 'install reset' to install, or use ns.singularity.installAugmentations().");
    }
  } else {
    tlog(ns, "\nDry run. Use 'run src/advanced/augmentation-buyer.js install' to purchase (keeps leftover money).");
    tlog(ns, "Use 'run src/advanced/augmentation-buyer.js install nfg' to also dump leftovers into NeuroFlux Governor.");
    tlog(ns, "Use 'run src/advanced/augmentation-buyer.js install reset' to purchase, dump into NFG, and reset.");
    tlog(ns, `Add '--prefer hacking,rep' to buy augs boosting those first (${AUG_CATEGORIES.join(", ")}).`);
  }
}
