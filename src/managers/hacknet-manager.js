import { DEFAULTS } from "/src/lib/constants.js";
import { log, formatMoney } from "/src/lib/utils.js";

// Relative production of a node given its stats. The constant gain-per-level (1.5)
// and the player/BitNode multipliers scale every candidate equally, so they cancel
// when ranking by payback ratio and are omitted here.
function nodeProduction(level, ram, cores) {
  return level * Math.pow(1.035, ram - 1) * ((cores + 5) / 6);
}

// Pick the upgrade with the lowest payback time (cost / production gained), NOT the
// cheapest one — the cheapest upgrade is almost never the best return on investment.
function getBestUpgrade(ns) {
  const numNodes = ns.hacknet.numNodes();
  let best = null;

  const consider = (cand) => {
    if (!isFinite(cand.cost) || cand.cost <= 0) return;
    if (!isFinite(cand.payback) || cand.payback <= 0) return;
    if (!best || cand.payback < best.payback) best = cand;
  };

  // A fresh node produces at base stats (level 1, ram 1, core 1).
  const newNodeCost = ns.hacknet.getPurchaseNodeCost();
  consider({ type: "new", cost: newNodeCost, node: -1, payback: newNodeCost / nodeProduction(1, 1, 1) });

  for (let i = 0; i < numNodes; i++) {
    const s = ns.hacknet.getNodeStats(i);
    const base = nodeProduction(s.level, s.ram, s.cores);

    const levelCost = ns.hacknet.getLevelUpgradeCost(i, 1);
    consider({ type: "level", cost: levelCost, node: i, payback: levelCost / (nodeProduction(s.level + 1, s.ram, s.cores) - base) });

    const ramCost = ns.hacknet.getRamUpgradeCost(i, 1); // one level doubles RAM
    consider({ type: "ram", cost: ramCost, node: i, payback: ramCost / (nodeProduction(s.level, s.ram * 2, s.cores) - base) });

    const coreCost = ns.hacknet.getCoreUpgradeCost(i, 1);
    consider({ type: "core", cost: coreCost, node: i, payback: coreCost / (nodeProduction(s.level, s.ram, s.cores + 1) - base) });
  }

  return best;
}

/** @param {NS} ns */
export async function main(ns) {
  ns.disableLog("ALL");
  const cycleMs = DEFAULTS.hacknetCycleMs;

  while (true) {
    const money = ns.getPlayer().money;
    const budget = money * DEFAULTS.hacknetBudgetPercent;

    const best = getBestUpgrade(ns);
    if (best && best.cost <= budget) {
      let success = false;
      switch (best.type) {
        case "new":
          success = ns.hacknet.purchaseNode() >= 0;
          if (success) log(ns, `Hacknet: purchased node #${ns.hacknet.numNodes() - 1} for ${formatMoney(best.cost)}`);
          break;
        case "level":
          success = ns.hacknet.upgradeLevel(best.node, 1);
          if (success) log(ns, `Hacknet: upgraded node ${best.node} level for ${formatMoney(best.cost)}`);
          break;
        case "ram":
          success = ns.hacknet.upgradeRam(best.node, 1);
          if (success) log(ns, `Hacknet: upgraded node ${best.node} RAM for ${formatMoney(best.cost)}`);
          break;
        case "core":
          success = ns.hacknet.upgradeCore(best.node, 1);
          if (success) log(ns, `Hacknet: upgraded node ${best.node} cores for ${formatMoney(best.cost)}`);
          break;
      }
    }

    await ns.sleep(cycleMs);
  }
}
