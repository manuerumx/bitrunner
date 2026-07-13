import { consumePortData, PORTS } from "/src/lib/port-registry.js";
import { tlog } from "/src/lib/utils.js";
import {
  getStasisCandidates,
  loadDarknetMap,
  loadPasswords,
  mergeDarknetMap,
  pickCrawlHosts,
  saveDarknetMap,
  MAP_FILE,
  PROBE_WORKER_RAM,
} from "/src/lib/darknet.js";

// Crawl the darknet and hoard cracking intel. probe() only sees the CURRENT server's
// neighbors, so the net can only be mapped from within: this tool probes from home,
// then ships a 1.9 GB probe worker to every known server we can exec on (stored
// password + direct connection/backdoor/stasis link) and merges what they all saw into
// /data/darknet-map.txt. Mapped servers feed straight into stasis.js status/auto.
//
//   run /src/tools/darknet-scan.js          crawl once, save the map, print discoveries
//   run /src/tools/darknet-scan.js intel    print cracking intel for every uncracked server
//
// Passwords themselves stay a human job — hints are puzzles. Crack one, then:
//   run /src/tools/stasis.js link <host> <password>

const WORKER = "/src/tools/darknet-probe-worker.js";
const WORKER_FILES = [WORKER, "/src/lib/port-registry.js", "/src/lib/constants.js"];
const REPORT_TIMEOUT_MS = 15000;

/**
 * Neighbor intel in the ProbeReport shape, for the given host list.
 * @param {NS} ns
 * @param {string} from
 * @param {string[]} hosts
 * @returns {ProbeReport}
 */
function buildLocalReport(ns, from, hosts) {
  /** @type {ProbeReport} */
  const report = { from, neighbors: {} };
  for (const host of hosts) {
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
  return report;
}

/**
 * Ship the probe worker to a server and wait for its report on the probe port.
 * @param {NS} ns
 * @param {string} host
 * @param {string} password
 * @returns {Promise<ProbeReport | null>}
 */
async function probeRemote(ns, host, password) {
  const session = ns.dnet.connectToSession(host, password);
  if (!session.success) {
    tlog(ns, `✗ ${host}: session failed — ${session.message} (code ${session.code})`);
    return null;
  }
  if (!ns.scp(WORKER_FILES, host, "home") || ns.exec(WORKER, host, 1, host) === 0) {
    tlog(ns, `✗ ${host}: couldn't run the probe worker (RAM or exec route)`);
    return null;
  }
  const deadline = Date.now() + REPORT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const report = /** @type {ProbeReport | null} */ (consumePortData(ns, PORTS.DNET_PROBE));
    if (report && report.from === host) return report;
    await ns.sleep(200);
  }
  tlog(ns, `✗ ${host}: no probe report after ${REPORT_TIMEOUT_MS / 1000}s`);
  return null;
}

/** Cracking intel lines for one mapped host. @param {NS} ns */
function printIntel(ns, host, entry) {
  const state = entry.isOnline === false ? " [OFFLINE]" : entry.isStationary ? " [stationary]" : "";
  ns.tprint(`  ${host}${state} — depth ${entry.depth ?? "?"}, difficulty ${entry.difficulty ?? "?"}`);
  ns.tprint(
    `      password: ${entry.passwordFormat ?? "?"} × ${entry.passwordLength ?? "?"}, ` +
      `heartbleed charisma ≥ ${entry.requiredCharisma ?? "?"}`
  );
  if (entry.hint) ns.tprint(`      hint: ${entry.hint}`);
  if (entry.data) ns.tprint(`      data: ${entry.data}`);
}

/** @param {NS} ns */
function printUncrackedIntel(ns) {
  const map = loadDarknetMap(ns);
  const store = loadPasswords(ns);
  const uncracked = Object.entries(map)
    .filter(([host]) => !(host in store))
    .sort(([, a], [, b]) => (a.depth ?? 99) - (b.depth ?? 99));
  if (uncracked.length === 0) {
    ns.tprint("Every mapped server is cracked. Run a scan to find more.");
    return;
  }
  ns.tprint(`\n=== Uncracked darknet servers: ${uncracked.length} (shallow first) ===`);
  for (const [host, entry] of uncracked) printIntel(ns, host, entry);
  ns.tprint(`\nCrack one, then: run /src/tools/stasis.js link <host> <password>`);
}

/** @param {NS} ns */
export async function main(ns) {
  try {
    ns.dnet.getStasisLinkLimit();
  } catch {
    ns.tprint("Darknet API unavailable — get darknet access (DarkscapeNavigator.exe) first.");
    return;
  }

  if (String(ns.args[0] ?? "").toLowerCase() === "intel") {
    printUncrackedIntel(ns);
    return;
  }

  const store = loadPasswords(ns);
  const map = loadDarknetMap(ns);
  ns.clearPort(PORTS.DNET_PROBE); // drop stale reports from dead runs

  // Home's own neighborhood (usually just darkweb) needs no worker.
  const reports = [buildLocalReport(ns, "home", ns.dnet.probe())];

  const crawlHosts = pickCrawlHosts(getStasisCandidates(ns));
  for (const c of crawlHosts) {
    const report = await probeRemote(ns, c.hostname, store[c.hostname]);
    if (report) reports.push(report);
  }

  const merged = mergeDarknetMap(map, reports);
  delete merged.map["home"]; // home is the crawl origin, not a darknet server
  saveDarknetMap(ns, merged.map);

  const mappedCount = Object.keys(merged.map).length;
  tlog(
    ns,
    `darknet-scan: probed home + ${reports.length - 1}/${crawlHosts.length} servers, ` +
      `map now ${mappedCount} hosts (${merged.newHosts.length} new) → ${MAP_FILE}`
  );
  if (merged.newHosts.length > 0) {
    ns.tprint(`\n=== Newly discovered ===`);
    for (const host of merged.newHosts) printIntel(ns, host, merged.map[host]);
    ns.tprint(`\nCrack one, then: run /src/tools/stasis.js link <host> <password>`);
  }
}
