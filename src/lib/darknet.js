// Darknet (ns.dnet) plumbing: the password store and the stasis-link planner.
//
// Darknet servers mutate on a cycle — they move, restart, or go offline (often
// permanently). A stasis link pins one in place and enables remote exec on it, but
// links are globally capped (ns.dnet.getStasisLinkLimit()). The planner decides which
// known servers deserve the free slots.

// The password store doubles as our registry of known darknet servers: a server is
// actionable exactly when we know its password (sessions are per-PID, so every tool
// re-authenticates from the store).
export const PASSWORD_FILE = "/data/darknet-passwords.txt";

// Everything darknet-scan.js has learned about the net: per-host cracking intel
// (model, password hint/format/length, required charisma) plus last-seen topology. Stale
// entries stay — a host nobody probed this round has merely mutated out of view.
export const MAP_FILE = "/data/darknet-map.txt";

// stasis-worker.js: 1.6 GB script base + 12 GB for ns.dnet.setStasisLink().
export const STASIS_WORKER_RAM = 13.6;

// darknet-probe-worker.js: 1.6 GB base + probe (0.2) + getServerDetails (0.1).
export const PROBE_WORKER_RAM = 1.9;

// darknet-crack-worker.js: 1.6 GB base + heartbleed (0.6). The target hostname arrives as
// an argument, so the worker never pays for getServerDetails — the same trick the probe
// worker uses for its own hostname. Ports are free.
export const CRACK_WORKER_RAM = 2.2;

// Log lines scraped out of darknet servers with heartbleed(), keyed by host. This is
// Stage A of the cracking pipeline (docs/API-COVERAGE-AUDIT.md §5.2): the server model
// list is "intentionally undocumented" per the API docs, so before anything can guess a
// password we need a corpus of what these logs actually say.
export const LOGS_FILE = "/data/darknet-logs.txt";

// Order matters: the first failing check names the reason, so reasons stay stable for
// tests and for the tool's status output.
/** @type {Array<[string, (c: any, linked: Set<string>, ram: number) => boolean]>} */
const SKIP_CHECKS = [
  ["linked", (c, linked) => linked.has(c.hostname)],
  ["offline", (c) => !c.isOnline],
  ["stationary", (c) => c.isStationary],
  ["no-password", (c) => !c.hasPassword],
  ["no-exec-route", (c) => !c.canExec],
  // blocked-ram: the worker doesn't fit now, but would after dnet.memoryReallocation().
  ["blocked-ram", (c, _l, ram) => c.freeRam < ram && c.freeRam + c.blockedRam >= ram],
  ["no-ram", (c, _l, ram) => c.freeRam < ram],
];

/**
 * Pick which servers get the remaining stasis-link slots. Pure so it's unit-testable.
 * Existing links are sticky: they occupy slots and are never re-added or swapped out.
 * Deepest servers first — they're the hardest to re-find if the net mutates them away —
 * then difficulty, then hostname for determinism.
 *
 * @param {Array<{hostname: string, isOnline: boolean, isStationary: boolean,
 *   hasPassword: boolean, canExec: boolean, freeRam: number, blockedRam: number,
 *   depth: number, difficulty: number}>} candidates
 * @param {number} limit  Global stasis-link cap (ns.dnet.getStasisLinkLimit()).
 * @param {string[]} linkedHosts  Currently linked servers (ns.dnet.getStasisLinkedServers()).
 * @param {number} ramNeeded  RAM the worker needs on the target.
 */
export function planStasisLinks(candidates, limit, linkedHosts, ramNeeded = STASIS_WORKER_RAM) {
  const linked = new Set(linkedHosts);
  const slotsFree = Math.max(0, limit - linkedHosts.length);

  const skipped = [];
  const eligible = [];
  for (const c of candidates) {
    const failed = SKIP_CHECKS.find(([, check]) => check(c, linked, ramNeeded));
    if (failed) skipped.push({ hostname: c.hostname, reason: failed[0] });
    else eligible.push(c);
  }

  eligible.sort(
    (a, b) =>
      b.depth - a.depth || b.difficulty - a.difficulty || a.hostname.localeCompare(b.hostname)
  );
  const add = eligible.slice(0, slotsFree);
  for (const c of eligible.slice(slotsFree)) {
    skipped.push({ hostname: c.hostname, reason: "no-slot" });
  }

  return { slotsFree, add, skipped };
}

/**
 * Map one darknet server's raw details onto the planner's candidate shape. Exec on a
 * darknet server needs a session PLUS a route: direct connection, backdoor, or an
 * existing stasis link. `server` may be null — darknet servers can vanish between the
 * dnet lookup and ns.getServer (treated as no RAM, no backdoor).
 *
 * @param {string} hostname
 * @param {{isOnline: boolean, isStationary: boolean, isConnectedToCurrentServer: boolean,
 *   blockedRam: number, depth: number, difficulty: number}} details  ns.dnet.getServerDetails()
 * @param {{maxRam: number, ramUsed: number, backdoorInstalled?: boolean} | null} server  ns.getServer()
 * @param {{hasPassword: boolean, isLinked: boolean}} opts
 */
export function buildCandidate(hostname, details, server, { hasPassword, isLinked }) {
  return {
    hostname,
    isOnline: details.isOnline,
    isStationary: details.isStationary,
    hasPassword,
    canExec: details.isConnectedToCurrentServer || Boolean(server?.backdoorInstalled) || isLinked,
    freeRam: server ? server.maxRam - server.ramUsed : 0,
    blockedRam: details.blockedRam,
    depth: details.depth,
    difficulty: details.difficulty,
  };
}

/**
 * Tolerant parse for our JSON data files: empty/corrupt content → empty object, so a
 * missing file is never fatal.
 * @param {string | null} raw
 */
function parseJsonObject(raw) {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
  } catch {
    // fall through
  }
  return {};
}

/**
 * Parse the password store file's contents.
 * @param {string | null} raw
 * @returns {Record<string, string>}
 */
export function parsePasswordStore(raw) {
  return parseJsonObject(raw);
}

/**
 * Parse the darknet map file's contents.
 * @param {string | null} raw
 * @returns {Record<string, any>}
 */
export function parseDarknetMap(raw) {
  return parseJsonObject(raw);
}

/**
 * Fold probe-worker reports into the map. The prober's own entry gets its fresh
 * neighbor list; each neighbor's intel is upserted. Hosts absent from every report are
 * left alone — the net mutating them out of view is not evidence they're gone.
 *
 * @param {Record<string, any>} existing
 * @param {Array<{from: string, neighbors: Record<string, any>}>} reports
 * @returns {{map: Record<string, any>, newHosts: string[]}}
 */
export function mergeDarknetMap(existing, reports) {
  const map = { ...existing };
  const newHosts = [];
  for (const r of reports) {
    map[r.from] = { ...map[r.from], neighbors: Object.keys(r.neighbors) };
    for (const [host, details] of Object.entries(r.neighbors)) {
      if (!(host in map)) newHosts.push(host);
      map[host] = { ...map[host], ...details, seenFrom: r.from };
    }
  }
  return { map, newHosts };
}

/**
 * Which uncracked servers are worth a heartbleed log capture, and where to run it from.
 *
 * heartbleed() and authenticate() only reach servers *directly connected* to the server
 * the script runs on, so every target needs a vantage point: the already-cracked host
 * whose probe report saw it (`seenFrom`, set by mergeDarknetMap).
 *
 * Two hard filters come straight from the API docs: logs cannot be scraped from a server
 * whose required charisma exceeds the player's, and an offline server is unreachable.
 * Easiest-first ordering means a run that gets cut short still spends its time on the
 * targets most likely to return something.
 *
 * @param {{map: Record<string, any>, solved: readonly string[], charisma: number}} input
 * @returns {Array<{from: string, target: string, requiredCharisma: number}>}
 */
export function planCrackTargets({ map, solved, charisma }) {
  const known = new Set(solved);

  return Object.entries(map)
    .filter(([host, e]) => !known.has(host) && e.isOnline !== false && e.seenFrom)
    .filter(([, e]) => (e.requiredCharisma ?? 0) <= charisma)
    .map(([host, e]) => ({
      from: e.seenFrom,
      target: host,
      requiredCharisma: e.requiredCharisma ?? 0,
    }))
    .sort(
      (a, b) => a.requiredCharisma - b.requiredCharisma || a.target.localeCompare(b.target)
    );
}

/**
 * Fold heartbleed captures into the log store, without duplicating lines.
 *
 * Servers add their own messages on a timer (`logTrafficInterval`), so repeat captures
 * overlap. Hosts absent from this round keep whatever was learned before.
 *
 * @param {Record<string, {logs: string[]}>} existing
 * @param {Array<{host: string, logs: string[]}>} reports
 */
export function mergeHeartbleedLogs(existing, reports) {
  const store = { ...existing };

  for (const { host, logs } of reports) {
    if (!logs || logs.length === 0) continue;
    const seen = store[host]?.logs ?? [];
    const fresh = logs.filter((line) => !seen.includes(line));
    if (fresh.length === 0 && host in store) continue;
    store[host] = { ...store[host], logs: [...seen, ...fresh] };
  }

  return store;
}

/**
 * Which known servers can run the probe worker right now: same exec rules as the
 * stasis worker, just a much smaller RAM bill.
 * @param {ReturnType<typeof buildCandidate>[]} candidates
 * @param {number} ramNeeded
 */
export function pickCrawlHosts(candidates, ramNeeded = PROBE_WORKER_RAM) {
  return candidates.filter(
    (c) => c.isOnline && c.hasPassword && c.canExec && c.freeRam >= ramNeeded
  );
}

/** @param {NS} ns */
export function loadPasswords(ns) {
  return parsePasswordStore(ns.read(PASSWORD_FILE));
}

/** @param {NS} ns */
export function savePassword(ns, host, password) {
  const store = loadPasswords(ns);
  store[host] = password;
  ns.write(PASSWORD_FILE, JSON.stringify(store, null, 2), "w");
}

/**
 * Decide which password a link/unlink should use, and whether it is worth storing.
 *
 * Kept pure — and kept here rather than inline in stasis.js — because the empty string is
 * a *real* password: ZeroLogon-model servers authenticate on "". A truthiness check
 * (`password || store[host]`) silently collapses that case into "no password known",
 * which made every ZeroLogon host unstorable. Since pickCrawlHosts() gates on the store,
 * that one check was enough to pin the whole crawler to home.
 *
 * `shouldSave` only reports that the caller's password differs from what is stored; the
 * caller still gates the write on the session actually succeeding.
 *
 * @param {string | null | undefined} passwordArg  Password supplied on the command line.
 * @param {Record<string, string>} store  Password store (loadPasswords()).
 * @param {string} host
 * @returns {{password: string, shouldSave: boolean} | null}  null when no password is known.
 */
export function resolveLinkPassword(passwordArg, store, host) {
  if (typeof passwordArg === "string") {
    return { password: passwordArg, shouldSave: store[host] !== passwordArg };
  }
  if (host in store) return { password: store[host], shouldSave: false };
  return null;
}

/** @param {NS} ns */
export function loadDarknetMap(ns) {
  return parseDarknetMap(ns.read(MAP_FILE));
}

/** @param {NS} ns */
export function saveDarknetMap(ns, map) {
  ns.write(MAP_FILE, JSON.stringify(map, null, 2), "w");
}

/** @param {NS} ns */
export function loadHeartbleedLogs(ns) {
  return parseJsonObject(ns.read(LOGS_FILE));
}

/** @param {NS} ns */
export function saveHeartbleedLogs(ns, logs) {
  ns.write(LOGS_FILE, JSON.stringify(logs, null, 2), "w");
}

/**
 * Candidate details for every darknet server we know about: password-store entries,
 * currently linked servers, everything darknet-scan.js has mapped, and any extras. A
 * host the dnet API no longer recognizes becomes an offline stub so status output can
 * still show what happened to it.
 * @param {NS} ns
 * @param {string[]} extraHosts
 */
export function getStasisCandidates(ns, extraHosts = []) {
  const store = loadPasswords(ns);
  const linked = ns.dnet.getStasisLinkedServers();
  const mapped = Object.keys(loadDarknetMap(ns));
  const hosts = [...new Set([...Object.keys(store), ...linked, ...mapped, ...extraHosts])];
  return hosts.map((host) => {
    let details;
    try {
      details = ns.dnet.getServerDetails(host);
    } catch {
      details = {
        isOnline: false,
        isStationary: false,
        isConnectedToCurrentServer: false,
        blockedRam: 0,
        depth: -1,
        difficulty: 0,
      };
    }
    let server = null;
    try {
      server = ns.getServer(host);
    } catch {
      // vanished between lookups — buildCandidate treats null as zero-RAM
    }
    return buildCandidate(host, details, server, {
      hasPassword: host in store,
      isLinked: linked.includes(host),
    });
  });
}
