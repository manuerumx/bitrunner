import { scanNetwork, getServerDetails, getPath } from "/src/lib/scanner.js";
import { tlog } from "/src/lib/utils.js";

const PRIORITY_SERVERS = [
  "CSEC",
  "avmnite-02h",
  "I.I.I.I",
  "run4theh111z",
  "w0r1d_d43m0n",
];

function hasSingularity(ns) {
  try {
    ns.singularity.getCurrentWork();
    return true;
  } catch {
    return false;
  }
}

/** @param {NS} ns */
export async function main(ns) {
  if (!hasSingularity(ns)) {
    ns.tprint("ERROR: Singularity API required (Source-File 4)");
    return;
  }

  const hostnames = scanNetwork(ns);
  const targets = [];

  for (const hostname of hostnames) {
    const srv = getServerDetails(ns, hostname);
    if (!srv.hasRoot) continue;
    if (srv.backdoor) continue;
    if (srv.requiredHackLevel > ns.getHackingLevel()) continue;
    if (srv.isPurchased) continue;

    const priority = PRIORITY_SERVERS.includes(hostname) ? 0 : 1;
    targets.push({ ...srv, priority });
  }

  targets.sort((a, b) => a.priority - b.priority || a.requiredHackLevel - b.requiredHackLevel);

  tlog(ns, `\n=== Auto-Backdoor (${targets.length} targets) ===\n`);

  for (const target of targets) {
    const path = getPath(ns, target.hostname);

    ns.singularity.connect("home");
    for (const hop of path.slice(1)) {
      ns.singularity.connect(hop);
    }

    tlog(ns, `Backdooring ${target.hostname}...`);
    await ns.singularity.installBackdoor();
    tlog(ns, `  Done: ${target.hostname}`);
  }

  ns.singularity.connect("home");
  tlog(ns, `\nBackdoor complete. ${targets.length} servers backdoored.`);
}
