import { scanNetwork } from "/src/lib/scanner.js";
import { DEFAULTS, PROGRAMS, WORKER_SCRIPTS } from "/src/lib/constants.js";
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
  const cycleMs = DEFAULTS.rooterCycleMs;
  const deployed = new Set(); // hosts we've already scp'd workers to

  while (true) {
    const programs = getAvailablePrograms(ns);
    const hostnames = scanNetwork(ns);

    for (const hostname of hostnames) {
      if (ns.hasRootAccess(hostname)) {
        // Only copy workers once per host — re-scp'ing every host every cycle is wasteful.
        if (!deployed.has(hostname)) {
          deployWorkers(ns, hostname);
          deployed.add(hostname);
        }
        continue;
      }

      // Rooting only needs the port programs — NOT a sufficient hacking level
      // (that only gates ns.hack). Root now to claim the RAM for grow/weaken workers.
      const portsRequired = ns.getServerNumPortsRequired(hostname);
      if (programs.length < portsRequired) continue;

      openPorts(ns, hostname, programs);

      try {
        ns.nuke(hostname);
        log(ns, `ROOTED: ${hostname} (${ns.getServerMaxRam(hostname)} GB RAM, ${formatMoney(ns.getServerMaxMoney(hostname))} max)`);
        deployWorkers(ns, hostname);
        deployed.add(hostname);
      } catch {
        // nuke failed (ports not all open yet), retry next cycle
      }
    }

    await ns.sleep(cycleMs);
  }
}
