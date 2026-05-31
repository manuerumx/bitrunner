import { scanNetwork } from "/src/lib/scanner.js";
import { tlog } from "/src/lib/utils.js";

/** @param {NS} ns */
export async function main(ns) {
  const hostnames = ["home", ...scanNetwork(ns)];
  let found = 0;

  ns.tprint("\n=== Coding Contracts ===\n");

  for (const hostname of hostnames) {
    const contracts = ns.ls(hostname, ".cct");
    for (const contract of contracts) {
      const type = ns.codingcontract.getContractType(contract, hostname);
      const tries = ns.codingcontract.getNumTriesRemaining(contract, hostname);
      ns.tprint(`  ${hostname}: ${contract}`);
      ns.tprint(`    Type: ${type} | Tries: ${tries}`);
      found++;
    }
  }

  tlog(ns, `Found ${found} coding contract(s)`);
}
