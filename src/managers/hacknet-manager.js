import { DEFAULTS } from "/src/lib/constants.js";
import { scanNetwork } from "/src/lib/scanner.js";
import { log, formatMoney } from "/src/lib/utils.js";

// Hash upgrade names (see HacknetServerHashUpgrade in NetscriptDefinitions.d.ts). "Sell for Money" is
// the universal drain; the targeted pair permanently buffs a server's HWGW yield.
/** @type {HacknetServerHashUpgrade} */
const HASH_TO_MONEY = "Sell for Money";
/** @type {HacknetServerHashUpgrade[]} */
const HASH_TARGET_UPGRADES = ["Reduce Minimum Security", "Increase Maximum Money"];

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

// Richest rooted server — the best place to spend "Increase Maximum Money" / "Reduce Minimum
// Security" hashes, since boosting it compounds HWGW income. maxMoney is a cheap proxy (no
// hackAnalyze) that keeps this manager's RAM low.
/** @param {NS} ns */
export function bestHashTarget(ns) {
  let best = null;
  let bestMoney = 0;
  for (const hostname of scanNetwork(ns)) {
    if (!ns.hasRootAccess(hostname)) continue;
    const money = ns.getServerMaxMoney(hostname);
    if (money > bestMoney) {
      bestMoney = money;
      best = hostname;
    }
  }
  return best;
}

// Spend accumulated hacknet-server hashes so they never cap out and waste. No-op on BitNodes without
// hacknet servers — hashCapacity() is 0 there (the nodes produce money, not hashes), so this returns
// immediately and the manager's money-upgrade logic is all that runs.
/** @param {NS} ns */
export function spendHashes(ns, perCycle = DEFAULTS.hashTargetUpgradesPerCycle) {
  if (ns.hacknet.hashCapacity() <= 0) return { target: null, targeted: 0, money: 0 };

  const available = new Set(ns.hacknet.getHashUpgrades());
  let targeted = 0;
  let money = 0;

  // 1) Compound the richest server's HWGW yield — permanent, high-value buffs. Bounded per cycle so
  //    we don't dump the whole reserve into one server; the money drain below mops up the rest.
  const target = bestHashTarget(ns);
  if (target) {
    for (const name of HASH_TARGET_UPGRADES) {
      if (!available.has(name)) continue;
      for (let i = 0; i < perCycle; i++) {
        if (ns.hacknet.numHashes() < ns.hacknet.hashCost(name)) break;
        if (!ns.hacknet.spendHashes(name, target)) break; // false = unaffordable or already maxed
        targeted++;
      }
    }
  }

  // 2) Drain everything left to money so hashes never cap out. "Sell for Money" is always available
  //    and never wrong — it just feeds the cash economy (server-buyer, hacknet upgrades, stocks).
  if (available.has(HASH_TO_MONEY)) {
    while (ns.hacknet.numHashes() >= ns.hacknet.hashCost(HASH_TO_MONEY)) {
      if (!ns.hacknet.spendHashes(HASH_TO_MONEY)) break;
      money++;
    }
  }

  return { target, targeted, money };
}

/** @param {NS} ns */
export async function main(ns) {
  ns.disableLog("ALL");
  const cycleMs = DEFAULTS.hacknetCycleMs;

  while (true) {
    // Budget is 10% of cash at cycle start.
    const budget = ns.getPlayer().money * DEFAULTS.hacknetBudgetPercent;
    let spent = 0;

    // Expand by one node per cycle when affordable. A fresh base-level node never wins the
    // payback ranking below, so the upgrade loop alone never grows the node count — which is
    // why nodes had to be bought by hand. Steady growth here + upgrades for the rest.
    if (ns.hacknet.numNodes() < ns.hacknet.maxNumNodes()) {
      const nodeCost = ns.hacknet.getPurchaseNodeCost();
      if (nodeCost <= budget && ns.hacknet.purchaseNode() >= 0) {
        spent += nodeCost;
        log(ns, `Hacknet: purchased node #${ns.hacknet.numNodes() - 1} for ${formatMoney(nodeCost)}`);
      }
    }

    // Spend the rest of the budget on the best-payback upgrades.
    while (true) {
      const best = getBestUpgrade(ns);
      if (!best || spent + best.cost > budget) break;

      let success = false;
      switch (best.type) {
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
      if (!success) break;
      spent += best.cost;
    }

    // Hashes are a separate currency from cash — spend them every cycle so a full hash bar (which
    // silently wastes production) never sits idle. No-op unless this BitNode has hacknet servers.
    const hash = spendHashes(ns);
    if (hash.targeted > 0 || hash.money > 0) {
      const parts = [];
      if (hash.targeted > 0) parts.push(`${hash.targeted} target upgrade(s) on ${hash.target}`);
      if (hash.money > 0) parts.push(`${hash.money}x ${HASH_TO_MONEY}`);
      log(ns, `Hacknet: spent hashes — ${parts.join(", ")}`);
    }

    await ns.sleep(cycleMs);
  }
}
