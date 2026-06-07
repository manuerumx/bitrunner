import { DEFAULTS } from "/src/lib/constants.js";
import { deployWorkers } from "/src/lib/deployer.js";
import { log, formatMoney, formatRAM } from "/src/lib/utils.js";

/** @param {NS} ns */
export async function main(ns) {
  ns.disableLog("ALL");
  const cycleMs = DEFAULTS.serverBuyerCycleMs;
  const prefix = "bitrunner-";

  while (true) {
    const money = ns.getPlayer().money;
    const maxServers = ns.cloud.getServerLimit();
    const owned = ns.cloud.getServerNames();

    if (owned.length < maxServers) {
      let targetRAM = DEFAULTS.purchasedServerRAM;
      const cost = ns.cloud.getServerCost(targetRAM);

      if (money > cost * 2) {
        while (targetRAM * 2 <= DEFAULTS.maxPurchasedServerRAM && ns.cloud.getServerCost(targetRAM * 2) < money / 2) {
          targetRAM *= 2;
        }

        const hostname = ns.cloud.purchaseServer(prefix + owned.length, targetRAM);
        if (hostname) {
          deployWorkers(ns, hostname);
          log(ns, `BOUGHT: ${hostname} (${formatRAM(targetRAM)}) for ${formatMoney(ns.cloud.getServerCost(targetRAM))}`);
        }
      }
    } else {
      // At the server cap: keep upgrading the smallest server while we can afford it
      // (always keeping ~half our cash in reserve), instead of one upgrade per cycle.
      let remaining = money;
      while (true) {
        const smallest = owned
          .map((h) => ({ hostname: h, ram: ns.getServerMaxRam(h) }))
          .sort((a, b) => a.ram - b.ram)[0];
        if (!smallest || smallest.ram >= DEFAULTS.maxPurchasedServerRAM) break;

        const newRAM = smallest.ram * 2;
        const cost = ns.cloud.getServerUpgradeCost(smallest.hostname, newRAM);
        if (!(cost > 0) || cost >= remaining / 2) break;
        if (!ns.cloud.upgradeServer(smallest.hostname, newRAM)) break;

        remaining -= cost;
        log(ns, `UPGRADED: ${smallest.hostname} ${formatRAM(smallest.ram)} -> ${formatRAM(newRAM)}`);
      }
    }

    await ns.sleep(cycleMs);
  }
}
