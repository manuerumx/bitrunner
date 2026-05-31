import { getPath } from "/src/lib/scanner.js";
import { tlog } from "/src/lib/utils.js";

/** @param {NS} ns */
export async function main(ns) {
  const target = ns.args[0];

  if (!target) {
    ns.tprint("Usage: run src/tools/connect.js <hostname>");
    ns.tprint("Prints the connect chain + backdoor command to copy-paste into terminal.");
    return;
  }

  const path = getPath(ns, target);

  if (path.length === 0) {
    ns.tprint(`ERROR: Server '${target}' not found in network.`);
    return;
  }

  // Build a single command chain: connect server1; connect server2; ... ; backdoor
  const connectChain = path.slice(1).map((h) => `connect ${h}`).join("; ");
  const fullCommand = `home; ${connectChain}; backdoor`;

  ns.tprint(`\n=== Path to ${target} (${path.length - 1} hops) ===`);
  ns.tprint("");
  for (let i = 1; i < path.length; i++) {
    ns.tprint(`  ${i}. connect ${path[i]}`);
  }
  ns.tprint("");
  ns.tprint("Copy-paste this into terminal to connect and backdoor:");
  ns.tprint(`  ${fullCommand}`);
  ns.tprint("");
}
