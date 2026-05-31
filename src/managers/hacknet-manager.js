import { DEFAULTS } from "/src/lib/constants.js";
import { log, formatMoney } from "/src/lib/utils.js";

function getBestUpgrade(ns) {
  const numNodes = ns.hacknet.numNodes();
  let best = null;

  const newNodeCost = ns.hacknet.getPurchaseNodeCost();
  if (isFinite(newNodeCost) && newNodeCost > 0) {
    best = { type: "new", cost: newNodeCost, node: -1 };
  }

  for (let i = 0; i < numNodes; i++) {
    const stats = ns.hacknet.getNodeStats(i);

    const upgrades = [
      { type: "level", cost: ns.hacknet.getLevelUpgradeCost(i, 1), node: i },
      { type: "ram", cost: ns.hacknet.getRamUpgradeCost(i, 1), node: i },
      { type: "core", cost: ns.hacknet.getCoreUpgradeCost(i, 1), node: i },
    ];

    for (const upgrade of upgrades) {
      if (!isFinite(upgrade.cost) || upgrade.cost <= 0) continue;
      if (!best || upgrade.cost < best.cost) {
        best = upgrade;
      }
    }
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
