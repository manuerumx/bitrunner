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

  for (let i = 0; i < 100; i++) {
    let purchased = false;
    for (const faction of factions) {
      try {
        const price = ns.singularity.getAugmentationPrice("NeuroFlux Governor");
        if (price > ns.getPlayer().money) break;

        const repReq = ns.singularity.getAugmentationRepReq("NeuroFlux Governor");
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

  let simulatedMoney = ns.getPlayer().money;
  for (const aug of augs) {
    if (aug.price <= simulatedMoney) {
      affordable.push(aug);
      tlog(ns, `  [CAN BUY] ${aug.name} from ${aug.faction} - ${formatMoney(aug.price)}`);
      simulatedMoney -= aug.price;
      totalCost += aug.price;
    } else {
      tlog(ns, `  [NEED $]  ${aug.name} from ${aug.faction} - ${formatMoney(aug.price)}`);
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
    tlog(ns, "\nDry run. Use 'run advanced/augmentation-buyer.js install' to purchase.");
    tlog(ns, "Use 'run advanced/augmentation-buyer.js install reset' to purchase and reset.");
  }
}
