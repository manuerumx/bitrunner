import { DEFAULTS, WORKER_SCRIPTS } from "/src/lib/constants.js";
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
          ns.scp(WORKER_SCRIPTS, hostname, "home");
          log(ns, `BOUGHT: ${hostname} (${formatRAM(targetRAM)}) for ${formatMoney(ns.cloud.getServerCost(targetRAM))}`);
        }
      }
    } else {
      const servers = owned
        .map((h) => ({ hostname: h, ram: ns.getServerMaxRam(h) }))
        .sort((a, b) => a.ram - b.ram);

      const smallest = servers[0];
      if (smallest && smallest.ram < DEFAULTS.maxPurchasedServerRAM) {
        const newRAM = smallest.ram * 2;
        const cost = ns.cloud.getServerUpgradeCost(smallest.hostname, newRAM);

        if (cost < money / 2 && cost > 0) {
          if (ns.cloud.upgradeServer(smallest.hostname, newRAM)) {
            log(ns, `UPGRADED: ${smallest.hostname} ${formatRAM(smallest.ram)} -> ${formatRAM(newRAM)}`);
          }
        }
      }
    }

    await ns.sleep(cycleMs);
  }
}
