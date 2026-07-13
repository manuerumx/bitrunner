import { pushPortData, PORTS } from "/src/lib/port-registry.js";

// Runs ON a darknet server (probe() only sees the current server's neighbors) — pushed
// there and exec'd by tools/darknet-scan.js. Reports every neighbor's cracking intel
// back on the probe port. Queue semantics (pushPortData), so parallel probers can't
// clobber each other's reports. The own hostname is passed as an arg to stay at
// 1.6 (base) + 0.2 (probe) + 0.1 (getServerDetails) = 1.9 GB.
//   run /src/tools/darknet-probe-worker.js <host>
/** @param {NS} ns */
export async function main(ns) {
  const self = String(ns.args[0] ?? "?");

  /** @type {ProbeReport} */
  const report = { from: self, neighbors: {} };
  for (const host of ns.dnet.probe()) {
    const d = ns.dnet.getServerDetails(host);
    report.neighbors[host] = {
      depth: d.depth,
      difficulty: d.difficulty,
      hint: d.passwordHint,
      data: d.data,
      passwordFormat: d.passwordFormat,
      passwordLength: d.passwordLength,
      requiredCharisma: d.requiredCharismaSkill,
      isStationary: d.isStationary,
      isOnline: d.isOnline,
    };
  }
  pushPortData(ns, PORTS.DNET_PROBE, report);
}
