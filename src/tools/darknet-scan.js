import { consumePortData, PORTS } from "/src/lib/port-registry.js";
import { tlog } from "/src/lib/utils.js";
import {
  getStasisCandidates,
  loadDarknetMap,
  loadHeartbleedLogs,
  loadPasswords,
  mergeDarknetMap,
  mergeHeartbleedLogs,
  pickCrawlHosts,
  planCrackTargets,
  saveDarknetMap,
  saveHeartbleedLogs,
  LOGS_FILE,
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
//   run /src/tools/darknet-scan.js crack    heartbleed every reachable uncracked server
//
// Passwords themselves stay a human job — hints are puzzles. Crack one, then:
//   run /src/tools/stasis.js link <host> <password>

const WORKER = "/src/tools/darknet-probe-worker.js";
const CRACK_WORKER = "/src/tools/darknet-crack-worker.js";
const SHARED_FILES = ["/src/lib/port-registry.js", "/src/lib/constants.js"];
const WORKER_FILES = [WORKER, ...SHARED_FILES];
const CRACK_FILES = [CRACK_WORKER, ...SHARED_FILES];
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

/**
 * Ship the crack worker to `from` and heartbleed its neighbour `target`.
 * @param {NS} ns
 * @param {string} from      cracked server to run from ("home" needs no session)
 * @param {string} target    uncracked neighbour to scrape
 * @param {string} password  stored password for `from`
 * @returns {Promise<CrackReport | null>}
 */
async function crackRemote(ns, from, target, password) {
  if (from !== "home") {
    const session = ns.dnet.connectToSession(from, password);
    if (!session.success) return null;
    if (!ns.scp(CRACK_FILES, from, "home")) return null;
  }
  if (ns.exec(CRACK_WORKER, from, 1, target) === 0) return null;

  const deadline = Date.now() + REPORT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const report = /** @type {CrackReport | null} */ (consumePortData(ns, PORTS.DNET_CRACK));
    if (report && report.host === target) return report;
    await ns.sleep(200);
  }
  return null;
}

/**
 * Stage A of the cracking pipeline (docs/API-COVERAGE-AUDIT.md §5.2): capture logs from
 * every uncracked server we can reach, and store them.
 *
 * This deliberately stops at intel. heartbleed() is called with `peek: true`, so nothing
 * is consumed, and authenticate() is never called — the server model list is
 * "intentionally undocumented" per the API docs, so there is no evidence yet that a
 * password is derivable from hint + format + length. Building the corpus is how that
 * question gets answered; guessing before it does would just burn time against servers
 * that mutate away.
 *
 * @param {NS} ns
 */
async function crackRound(ns) {
  const store = loadPasswords(ns);
  const map = loadDarknetMap(ns);
  const charisma = ns.getPlayer().skills.charisma;

  const targets = planCrackTargets({ map, solved: Object.keys(store), charisma });
  if (targets.length === 0) {
    ns.tprint("Nothing to scrape: every mapped server is cracked, offline, or above your charisma.");
    ns.tprint("Run a scan to find more, or train charisma to reach the deeper ones.");
    return;
  }

  ns.clearPort(PORTS.DNET_CRACK); // drop stale reports from dead runs
  tlog(ns, `darknet-scan: heartbleeding ${targets.length} server(s) (charisma ${charisma})`);

  /** @type {CrackReport[]} */
  const reports = [];
  let failed = 0;
  for (const t of targets) {
    const report = await crackRemote(ns, t.from, t.target, store[t.from]);
    if (report && report.logs.length > 0) reports.push(report);
    else failed++;
  }

  const merged = mergeHeartbleedLogs(loadHeartbleedLogs(ns), reports);
  saveHeartbleedLogs(ns, merged);

  const lines = Object.values(merged).reduce((n, e) => n + e.logs.length, 0);
  tlog(
    ns,
    `darknet-scan: captured from ${reports.length}/${targets.length} servers ` +
      `(${failed} unreachable), corpus now ${lines} line(s) across ` +
      `${Object.keys(merged).length} host(s) → ${LOGS_FILE}`
  );

  for (const report of reports) {
    ns.tprint(`\n  ${report.host}`);
    for (const line of report.logs) ns.tprint(`      ${line}`);
  }
  if (reports.length > 0) {
    ns.tprint(`\nRead ${LOGS_FILE} for the full corpus. Cracked one? Then:`);
    ns.tprint(`  run /src/tools/stasis.js link <host> <password>`);
  }
}

/** @param {NS} ns */
export async function main(ns) {
  try {
    ns.dnet.getStasisLinkLimit();
  } catch {
    ns.tprint("Darknet API unavailable — get darknet access (DarkscapeNavigator.exe) first.");
    return;
  }

  const mode = String(ns.args[0] ?? "").toLowerCase();
  if (mode === "intel") {
    printUncrackedIntel(ns);
    return;
  }
  if (mode === "crack") {
    await crackRound(ns);
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
