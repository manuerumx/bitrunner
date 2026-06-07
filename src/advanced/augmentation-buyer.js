import { log, tlog, formatMoney } from "/src/lib/utils.js";

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

/** @param {NS} ns */
export async function main(ns) {
  ns.disableLog("ALL");

  if (!hasSingularity(ns)) {
    ns.tprint("ERROR: Singularity API required (Source-File 4)");
    return;
  }

  const installNow = ns.args[0] === "install";

  const augs = getAllAvailableAugs(ns);
  let totalCost = 0;
  let affordable = [];

  tlog(ns, `\n=== Augmentation Buyer ===`);
  tlog(ns, `Available augmentations: ${augs.length}`);
  tlog(ns, `Player money: ${formatMoney(ns.getPlayer().money)}`);
  tlog(ns, "");

  // Each purchase multiplies the price of all REMAINING augs by 1.9x. Augs are
  // sorted most-expensive-first (correct order to maximize count), so we compound
  // the multiplier as we go — otherwise the estimate is wildly over-optimistic and
  // the later (cheaper) augs fail to purchase at runtime.
  const AUG_PRICE_MULT = 1.9;
  let simulatedMoney = ns.getPlayer().money;
  let priceMult = 1;
  for (const aug of augs) {
    const realPrice = aug.price * priceMult;
    if (realPrice <= simulatedMoney) {
      affordable.push(aug);
      tlog(ns, `  [CAN BUY] ${aug.name} from ${aug.faction} - ${formatMoney(realPrice)}`);
      simulatedMoney -= realPrice;
      totalCost += realPrice;
      priceMult *= AUG_PRICE_MULT;
    } else {
      tlog(ns, `  [NEED $]  ${aug.name} from ${aug.faction} - ${formatMoney(realPrice)}`);
    }
  }

  tlog(ns, "");
  tlog(ns, `Can afford: ${affordable.length} / ${augs.length}`);
  tlog(ns, `Total cost: ${formatMoney(totalCost)}`);

  if (installNow && affordable.length > 0) {
    tlog(ns, "\nPurchasing augmentations...");

    let purchased = 0;
    for (const aug of affordable) {
      if (ns.singularity.purchaseAugmentation(aug.faction, aug.name)) {
        tlog(ns, `  BOUGHT: ${aug.name} from ${aug.faction}`);
        purchased++;
      } else {
        tlog(ns, `  FAILED: ${aug.name}`);
      }
    }

    const nfg = buyNeuroFlux(ns);
    if (nfg > 0) {
      tlog(ns, `  BOUGHT: ${nfg}x NeuroFlux Governor`);
    }

    tlog(ns, `\nPurchased ${purchased} augmentations + ${nfg} NeuroFlux Governor`);
    tlog(ns, "Run with 'install' arg again or use ns.singularity.installAugmentations() to install.");

    if (ns.args[1] === "reset") {
      tlog(ns, "Installing augmentations and resetting...");
      ns.singularity.installAugmentations("src/daemon.js");
    }
  } else if (!installNow) {
    tlog(ns, "\nDry run. Use 'run src/advanced/augmentation-buyer.js install' to purchase.");
    tlog(ns, "Use 'run src/advanced/augmentation-buyer.js install reset' to purchase and reset.");
  }
}
