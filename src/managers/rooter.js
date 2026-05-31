import { scanNetwork } from "/src/lib/scanner.js";
import { PROGRAMS, WORKER_SCRIPTS } from "/src/lib/constants.js";
import { log, formatMoney } from "/src/lib/utils.js";

function getAvailablePrograms(ns) {
  return PROGRAMS.filter((p) => ns.fileExists(p.name, "home"));
}

function openPorts(ns, hostname, programs) {
  let opened = 0;
  for (const prog of programs) {
    try {
      ns[prog.fn](hostname);
      opened++;
    } catch {
      // program may already have opened this port
    }
  }
  return opened;
}

function deployWorkers(ns, hostname) {
  ns.scp(WORKER_SCRIPTS, hostname, "home");
}

/** @param {NS} ns */
export async function main(ns) {
  ns.disableLog("ALL");
  const cycleMs = 30000;

  while (true) {
    const programs = getAvailablePrograms(ns);
    const hostnames = scanNetwork(ns);

    for (const hostname of hostnames) {
      if (ns.hasRootAccess(hostname)) {
        deployWorkers(ns, hostname);
        continue;
      }

      const server = ns.getServer(hostname);
      if (server.requiredHackingSkill > ns.getHackingLevel()) continue;

      openPorts(ns, hostname, programs);

      const updatedServer = ns.getServer(hostname);
      if (updatedServer.openPortCount >= updatedServer.numOpenPortsRequired) {
        try {
          ns.nuke(hostname);
          log(ns, `ROOTED: ${hostname} (${updatedServer.maxRam} GB RAM, ${formatMoney(updatedServer.moneyMax)} max)`);
          deployWorkers(ns, hostname);
        } catch {
          // nuke failed, skip
        }
      }
    }

    await ns.sleep(cycleMs);
  }
}
