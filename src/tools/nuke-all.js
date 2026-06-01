import { scanNetwork } from "/src/lib/scanner.js";
import { PROGRAMS } from "/src/lib/constants.js";
import { tlog, formatRAM, formatMoney } from "/src/lib/utils.js";

/** @param {NS} ns */
export async function main(ns) {
  const programs = PROGRAMS.filter((p) => ns.fileExists(p.name, "home"));
  const hostnames = scanNetwork(ns);
  let rooted = 0;
  let alreadyRooted = 0;

  for (const hostname of hostnames) {
    if (ns.hasRootAccess(hostname)) {
      alreadyRooted++;
      continue;
    }

    const server = ns.getServer(hostname);
    if (server.requiredHackingSkill > ns.getHackingLevel()) continue;

    for (const prog of programs) {
      try { ns[prog.fn](hostname); } catch {}
    }

    const updated = ns.getServer(hostname);
    if (updated.openPortCount >= updated.numOpenPortsRequired) {
      try {
        ns.nuke(hostname);
        rooted++;
        tlog(ns, `ROOTED: ${hostname} (${formatRAM(updated.maxRam)}, ${formatMoney(updated.moneyMax)} max)`);
      } catch {}
    }
  }

  tlog(ns, `Done: ${rooted} newly rooted, ${alreadyRooted} already had root, ${hostnames.length - rooted - alreadyRooted} not yet rootable`);
}
