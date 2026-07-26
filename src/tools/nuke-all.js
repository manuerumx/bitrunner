import { scanNetwork } from "/src/lib/scanner.js";
import { PROGRAMS } from "/src/lib/constants.js";
import { deployWorkers } from "/src/lib/deployer.js";
import { tlog, formatRAM, formatMoney } from "/src/lib/utils.js";

/** @param {NS} ns */
export async function main(ns) {
  // Literal ns.<fn> references so the static RAM analyzer charges for each
  // port opener; a dynamic map lookup on ns would run but under-allocate by
  // 0.25GB and get the script killed at the first call past the budget.
  const crackers = {
    brutessh: ns.brutessh,
    ftpcrack: ns.ftpcrack,
    relaysmtp: ns.relaysmtp,
    httpworm: ns.httpworm,
    sqlinject: ns.sqlinject,
  };
  const programs = PROGRAMS.filter((p) => ns.fileExists(p.name, "home"));
  const hostnames = scanNetwork(ns);
  let rooted = 0;
  let alreadyRooted = 0;

  for (const hostname of hostnames) {
    if (ns.hasRootAccess(hostname)) {
      alreadyRooted++;
      continue;
    }

    // Rooting only needs the port programs, NOT a sufficient hacking level (that only gates
    // ns.hack). Skipping high-level servers here left rootable grow/weaken RAM unclaimed.
    for (const prog of programs) {
      try { crackers[prog.fn](hostname); } catch {}
    }

    const updated = ns.getServer(hostname);
    if (updated.openPortCount >= updated.numOpenPortsRequired) {
      try {
        ns.nuke(hostname);
        // Deploy the workers immediately. Without this, a host rooted only by nuke-all has
        // root + RAM but no scripts, so the coordinator's ns.exec silently returns 0 and the
        // RAM is never used — a direct cause of "workers only on home + purchased".
        deployWorkers(ns, hostname);
        rooted++;
        tlog(ns, `ROOTED: ${hostname} (${formatRAM(updated.maxRam)}, ${formatMoney(updated.moneyMax)} max)`);
      } catch {}
    }
  }

  tlog(ns, `Done: ${rooted} newly rooted, ${alreadyRooted} already had root, ${hostnames.length - rooted - alreadyRooted} not yet rootable`);
}
