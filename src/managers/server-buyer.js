import { DEFAULTS } from "/src/lib/constants.js";
import { deployWorkers } from "/src/lib/deployer.js";
import { pickServerName } from "/src/lib/server-names.js";
import { log, formatMoney, formatRAM } from "/src/lib/utils.js";

/**
 * Biggest RAM tier worth buying right now: double up while half the wallet still covers
 * the next tier, stopping at the game's own per-server ceiling.
 *
 * The ceiling comes from ns.cloud.getRamLimit() (0.05 GB) rather than a hardcoded
 * constant — this fork's cap need not match vanilla's 1 PB, and it may scale with
 * progression. See docs/API-COVERAGE-AUDIT.md §5.10.
 *
 * @param {NS} ns
 * @param {number} money
 */
export function pickPurchaseRam(ns, money) {
  const limit = ns.cloud.getRamLimit();
  let targetRAM = Math.min(DEFAULTS.purchasedServerRAM, limit);

  while (targetRAM * 2 <= limit && ns.cloud.getServerCost(targetRAM * 2) < money / 2) {
    targetRAM *= 2;
  }
  return targetRAM;
}

/**
 * Smallest server still below the cloud RAM limit, and the tier it would move to.
 * Null when every server is maxed out.
 *
 * @param {NS} ns
 * @param {string[]} owned
 * @returns {{hostname: string, ram: number, newRam: number} | null}
 */
export function pickUpgradeTarget(ns, owned) {
  const limit = ns.cloud.getRamLimit();
  const smallest = owned
    .map((h) => ({ hostname: h, ram: ns.getServerMaxRam(h) }))
    .sort((a, b) => a.ram - b.ram)[0];

  if (!smallest || smallest.ram >= limit) return null;
  return { ...smallest, newRam: smallest.ram * 2 };
}

/** @param {NS} ns */
export async function main(ns) {
  ns.disableLog("ALL");
  const cycleMs = DEFAULTS.serverBuyerCycleMs;

  while (true) {
    const money = ns.getPlayer().money;
    const maxServers = ns.cloud.getServerLimit();
    const owned = ns.cloud.getServerNames();

    if (owned.length < maxServers) {
      const targetRAM = pickPurchaseRam(ns, money);
      const cost = ns.cloud.getServerCost(targetRAM);

      if (money > cost * 2) {
        const hostname = ns.cloud.purchaseServer(pickServerName(owned), targetRAM);
        if (hostname) {
          deployWorkers(ns, hostname);
          log(ns, `BOUGHT: ${hostname} (${formatRAM(targetRAM)}) for ${formatMoney(cost)}`);
        }
      }
    } else {
      // At the server cap: keep upgrading the smallest server while we can afford it
      // (always keeping ~half our cash in reserve), instead of one upgrade per cycle.
      let remaining = money;
      while (true) {
        const target = pickUpgradeTarget(ns, owned);
        if (!target) break;

        const cost = ns.cloud.getServerUpgradeCost(target.hostname, target.newRam);
        if (!(cost > 0) || cost >= remaining / 2) break;
        if (!ns.cloud.upgradeServer(target.hostname, target.newRam)) break;

        remaining -= cost;
        log(ns, `UPGRADED: ${target.hostname} ${formatRAM(target.ram)} -> ${formatRAM(target.newRam)}`);
      }
    }

    await ns.sleep(cycleMs);
  }
}
