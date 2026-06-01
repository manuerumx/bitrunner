import { tlog, formatMoney } from "/src/lib/utils.js";

function hasSingularity(ns) {
  try {
    ns.singularity.getCurrentWork();
    return true;
  } catch {
    return false;
  }
}

function hasTIX(ns) {
  try {
    ns.stock.getSymbols();
    return true;
  } catch {
    return false;
  }
}

function sellAllStocks(ns) {
  if (!hasTIX(ns)) return 0;
  let totalGain = 0;
  const symbols = ns.stock.getSymbols();

  for (const sym of symbols) {
    const [longShares, , shortShares] = ns.stock.getPosition(sym);
    if (longShares > 0) {
      const gain = ns.stock.sellStock(sym, longShares);
      if (gain > 0) totalGain += gain * longShares;
    }
    if (shortShares > 0) {
      try {
        const gain = ns.stock.sellShort(sym, shortShares);
        if (gain > 0) totalGain += gain * shortShares;
      } catch {}
    }
  }

  return totalGain;
}

// Report open positions and their current liquidation value WITHOUT selling.
function getStockSummary(ns) {
  if (!hasTIX(ns)) return null;
  let positions = 0;
  let liquidationValue = 0;
  for (const sym of ns.stock.getSymbols()) {
    const [longShares, , shortShares] = ns.stock.getPosition(sym);
    if (longShares > 0) {
      positions++;
      liquidationValue += ns.stock.getSaleGain(sym, longShares, "L");
    }
    if (shortShares > 0) {
      positions++;
      try { liquidationValue += ns.stock.getSaleGain(sym, shortShares, "S"); } catch {}
    }
  }
  return { positions, liquidationValue };
}

/** @param {NS} ns */
export async function main(ns) {
  if (!hasSingularity(ns)) {
    ns.tprint("ERROR: Singularity API required (Source-File 4)");
    return;
  }

  tlog(ns, "\n=== PRE-RESET CHECKLIST ===\n");

  tlog(ns, "1. Stock positions:");
  const stocks = getStockSummary(ns);
  if (!stocks) {
    tlog(ns, "   No TIX access — nothing to sell.");
  } else if (stocks.positions === 0) {
    tlog(ns, "   Flat — no open positions.");
  } else {
    tlog(ns, `   ${stocks.positions} open position(s), ~${formatMoney(stocks.liquidationValue)} if sold now.`);
    tlog(ns, "   -> Cash out at a profit first:  run src/tools/sell-stocks.js");
    tlog(ns, "      (or dump immediately:         run src/tools/sell-stocks.js now)");
  }

  tlog(ns, "\n2. Current augmentation status:");
  const owned = ns.singularity.getOwnedAugmentations(true);
  const installed = ns.singularity.getOwnedAugmentations(false);
  const pending = owned.length - installed.length;
  tlog(ns, `   Installed: ${installed.length}`);
  tlog(ns, `   Pending install: ${pending}`);

  tlog(ns, `\n3. Player status:`);
  tlog(ns, `   Money: ${formatMoney(ns.getPlayer().money)}`);
  tlog(ns, `   Hacking: ${ns.getHackingLevel()}`);

  const factions = ns.getPlayer().factions;
  tlog(ns, `\n4. Faction status (${factions.length} joined):`);
  for (const faction of factions) {
    const rep = ns.singularity.getFactionRep(faction);
    const favor = ns.singularity.getFactionFavor(faction);
    const augs = ns.singularity.getAugmentationsFromFaction(faction)
      .filter((a) => !owned.includes(a) && a !== "NeuroFlux Governor");
    if (augs.length > 0 || rep > 1000) {
      tlog(ns, `   ${faction}: ${formatMoney(rep)} rep, ${favor} favor, ${augs.length} augs available`);
    }
  }

  if (pending > 0) {
    tlog(ns, `\n${pending} augmentations pending install.`);
    tlog(ns, "Run 'run src/advanced/augmentation-buyer.js install reset' to purchase more and reset.");
  } else {
    tlog(ns, "\nNo pending augmentations. Run augmentation-buyer first.");
  }

  if (ns.args[0] === "go") {
    // Safety net: dump any positions still open before the reset wipes them. If you already
    // ran sell-stocks.js to exit at a profit, this usually sells nothing.
    const dumped = sellAllStocks(ns);
    if (dumped > 0) tlog(ns, `\nForce-sold remaining positions for ~${formatMoney(dumped)} (gross).`);
    tlog(ns, "\nInstalling augmentations and resetting...");
    ns.singularity.installAugmentations("src/daemon.js");
  } else {
    tlog(ns, "\nUse 'run src/tools/reset-prep.js go' to install augs and reset.");
  }
}
