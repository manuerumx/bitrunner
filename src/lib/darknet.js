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

// stasis-worker.js: 1.6 GB script base + 12 GB for ns.dnet.setStasisLink().
export const STASIS_WORKER_RAM = 13.6;

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
 * Parse the password store file's contents. Empty/corrupt file → empty store, so a
 * missing file is never fatal.
 * @param {string | null} raw
 * @returns {Record<string, string>}
 */
export function parsePasswordStore(raw) {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
  } catch {
    // fall through
  }
  return {};
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
 * Candidate details for every darknet server we know about: password-store entries,
 * currently linked servers, and any extras. A host the dnet API no longer recognizes
 * becomes an offline stub so status output can still show what happened to it.
 * @param {NS} ns
 * @param {string[]} extraHosts
 */
export function getStasisCandidates(ns, extraHosts = []) {
  const store = loadPasswords(ns);
  const linked = ns.dnet.getStasisLinkedServers();
  const hosts = [...new Set([...Object.keys(store), ...linked, ...extraHosts])];
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
