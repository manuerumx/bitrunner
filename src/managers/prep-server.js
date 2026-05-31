import { scanNetwork } from "/src/lib/scanner.js";
import { WORKER_RAM, DEFAULTS } from "/src/lib/constants.js";
import { isServerPrepped } from "/src/lib/batch-calculator.js";
import { log, formatMoney, formatPercent } from "/src/lib/utils.js";

function getAvailableRAM(ns, hostname) {
  const max = ns.getServerMaxRam(hostname);
  const used = ns.getServerUsedRam(hostname);
  if (hostname === "home") {
    return Math.max(0, max - used - DEFAULTS.reservedHomeRAM);
  }
  return Math.max(0, max - used);
}

function getAllWorkerServers(ns) {
  const servers = [];
  const hostnames = ["home", ...scanNetwork(ns)];
  for (const hostname of hostnames) {
    if (!ns.hasRootAccess(hostname)) continue;
    const freeRAM = getAvailableRAM(ns, hostname);
    if (freeRAM < WORKER_RAM.WEAKEN) continue;
    servers.push({ hostname, freeRAM });
  }
  servers.sort((a, b) => b.freeRAM - a.freeRAM);
  return servers;
}

/** @param {NS} ns */
export async function main(ns) {
  ns.disableLog("ALL");
  const target = ns.args[0];

  if (!target) {
    ns.tprint("Usage: run managers/prep-server.js <target>");
    return;
  }

  ns.tprint(`Prepping ${target}...`);

  while (!isServerPrepped(ns, target)) {
    const currentSecurity = ns.getServerSecurityLevel(target);
    const minSecurity = ns.getServerMinSecurityLevel(target);
    const currentMoney = ns.getServerMoneyAvailable(target);
    const maxMoney = ns.getServerMaxMoney(target);
    const securityAboveMin = currentSecurity - minSecurity;

    const workerServers = getAllWorkerServers(ns);
    let dispatched = 0;

    for (const server of workerServers) {
      if (server.freeRAM < WORKER_RAM.WEAKEN) continue;

      if (securityAboveMin > 0.05) {
        const threads = Math.floor(server.freeRAM / WORKER_RAM.WEAKEN);
        if (threads > 0) {
          const pid = ns.exec("/src/weaken.js", server.hostname, threads, target);
          if (pid > 0) {
            dispatched += threads;
            server.freeRAM -= threads * WORKER_RAM.WEAKEN;
          }
        }
      } else if (currentMoney < maxMoney * 0.99) {
        const growThreads = Math.floor((server.freeRAM * 0.8) / WORKER_RAM.GROW);
        const weakenThreads = Math.floor((server.freeRAM * 0.2) / WORKER_RAM.WEAKEN);
        if (growThreads > 0) {
          const pid = ns.exec("/src/grow.js", server.hostname, growThreads, target);
          if (pid > 0) dispatched += growThreads;
        }
        if (weakenThreads > 0) {
          const pid = ns.exec("/src/weaken.js", server.hostname, weakenThreads, target);
          if (pid > 0) dispatched += weakenThreads;
        }
      }
    }

    log(
      ns,
      `Prep ${target}: Sec ${currentSecurity.toFixed(1)}/${minSecurity.toFixed(1)} | ` +
        `Money ${formatPercent(maxMoney > 0 ? currentMoney / maxMoney : 0)} | ` +
        `${dispatched} threads`
    );

    const weakenTime = ns.getWeakenTime(target);
    await ns.sleep(weakenTime + 500);
  }

  ns.tprint(`${target} is fully prepped!`);
}
