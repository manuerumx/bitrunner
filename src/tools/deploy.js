import { scanNetwork } from "/src/lib/scanner.js";
import { WORKER_SCRIPTS } from "/src/lib/constants.js";
import { tlog } from "/src/lib/utils.js";

/** @param {NS} ns */
export async function main(ns) {
  const hostnames = scanNetwork(ns);
  let deployed = 0;

  for (const hostname of hostnames) {
    if (!ns.hasRootAccess(hostname)) continue;
    if (ns.getServerMaxRam(hostname) === 0) continue;
    ns.scp(WORKER_SCRIPTS, hostname, "home");
    deployed++;
  }

  tlog(ns, `Deployed worker scripts to ${deployed} servers`);
}
