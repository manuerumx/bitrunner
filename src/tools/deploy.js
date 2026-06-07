import { scanNetwork } from "/src/lib/scanner.js";
import { deployWorkers } from "/src/lib/deployer.js";
import { tlog } from "/src/lib/utils.js";

/** @param {NS} ns */
export async function main(ns) {
  const hostnames = scanNetwork(ns);
  let deployed = 0;

  for (const hostname of hostnames) {
    if (!ns.hasRootAccess(hostname)) continue;
    if (ns.getServerMaxRam(hostname) === 0) continue;
    deployWorkers(ns, hostname);
    deployed++;
  }

  tlog(ns, `Deployed worker scripts to ${deployed} servers`);
}
