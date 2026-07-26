import { scanNetwork } from "/src/lib/scanner.js";
import { DEFAULTS, PROGRAMS } from "/src/lib/constants.js";
import { deployWorkers, ensureWorkers } from "/src/lib/deployer.js";
import { log, formatMoney } from "/src/lib/utils.js";

function getAvailablePrograms(ns) {
  return PROGRAMS.filter((p) => ns.fileExists(p.name, "home"));
}

function openPorts(ns, hostname, programs) {
  // Literal ns.<fn> references so the static RAM analyzer charges for each
  // port opener; a dynamic map lookup on ns would run but under-allocate and
  // kill the daemon the first time it roots a host needing all five ports.
  const crackers = {
    brutessh: ns.brutessh,
    ftpcrack: ns.ftpcrack,
    relaysmtp: ns.relaysmtp,
    httpworm: ns.httpworm,
    sqlinject: ns.sqlinject,
  };
  let opened = 0;
  for (const prog of programs) {
    try {
      crackers[prog.fn](hostname);
      opened++;
    } catch {
      // program may already have opened this port
    }
  }
  return opened;
}

/** @param {NS} ns */
export async function main(ns) {
  ns.disableLog("ALL");
  const cycleMs = DEFAULTS.rooterCycleMs;

  while (true) {
    const programs = getAvailablePrograms(ns);
    const hostnames = scanNetwork(ns);

    for (const hostname of hostnames) {
      if (ns.hasRootAccess(hostname)) {
        // Self-healing deploy: copy the workers whenever they're MISSING (gated on file
        // presence, not an in-memory Set). This re-covers hosts rooted by another tool, a
        // prior incomplete deploy, or files that were cleared — cases the old once-per-run
        // Set silently missed (and it couldn't survive a restart either).
        ensureWorkers(ns, hostname);
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
      } catch {
        // nuke failed (ports not all open yet), retry next cycle
      }
    }

    await ns.sleep(cycleMs);
  }
}
