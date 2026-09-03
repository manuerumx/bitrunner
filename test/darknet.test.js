import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildCandidate,
  mergeDarknetMap,
  mergeHeartbleedLogs,
  planCrackTargets,
  parseDarknetMap,
  parsePasswordStore,
  pickCrawlHosts,
  planStasisLinks,
  resolveLinkPassword,
  PROBE_WORKER_RAM,
  STASIS_WORKER_RAM,
} from "/src/lib/darknet.js";

// ── parsePasswordStore ──────────────────────────────────────────────────────

test("parsePasswordStore parses a JSON object of host → password", () => {
  const raw = JSON.stringify({ "dn-alpha": "hunter2", "dn-beta": "s3cret" });
  assert.deepEqual(parsePasswordStore(raw), { "dn-alpha": "hunter2", "dn-beta": "s3cret" });
});

test("parsePasswordStore returns empty store for empty, invalid, or non-object input", () => {
  assert.deepEqual(parsePasswordStore(""), {});
  assert.deepEqual(parsePasswordStore("not json {"), {});
  assert.deepEqual(parsePasswordStore("[1,2,3]"), {});
  assert.deepEqual(parsePasswordStore("42"), {});
  assert.deepEqual(parsePasswordStore(null), {});
});

// ── planStasisLinks ─────────────────────────────────────────────────────────

// Candidate shape built by getStasisCandidates() — only the fields the planner reads.
function cand(hostname, over = {}) {
  return {
    hostname,
    isOnline: true,
    isStationary: false,
    hasPassword: true,
    canExec: true,
    freeRam: 32,
    blockedRam: 0,
    depth: 3,
    difficulty: 10,
    ...over,
  };
}

test("fills free slots with the deepest servers first", () => {
  const plan = planStasisLinks(
    [cand("shallow", { depth: 1 }), cand("deep", { depth: 5 }), cand("mid", { depth: 3 })],
    2,
    []
  );
  assert.equal(plan.slotsFree, 2);
  assert.deepEqual(
    plan.add.map((c) => c.hostname),
    ["deep", "mid"]
  );
});

test("breaks depth ties by difficulty, then hostname", () => {
  const plan = planStasisLinks(
    [
      cand("b-easy", { difficulty: 5 }),
      cand("a-hard", { difficulty: 20 }),
      cand("a-easy", { difficulty: 5 }),
    ],
    3,
    []
  );
  assert.deepEqual(
    plan.add.map((c) => c.hostname),
    ["a-hard", "a-easy", "b-easy"]
  );
});

test("existing links count against the limit", () => {
  const plan = planStasisLinks([cand("x"), cand("y", { depth: 9 })], 3, ["linked-1", "linked-2"]);
  assert.equal(plan.slotsFree, 1);
  assert.deepEqual(
    plan.add.map((c) => c.hostname),
    ["y"]
  );
  assert.deepEqual(plan.skipped, [{ hostname: "x", reason: "no-slot" }]);
});

test("no slots free: nothing added, eligible candidates skipped as no-slot", () => {
  const plan = planStasisLinks([cand("x")], 2, ["a", "b"]);
  assert.equal(plan.slotsFree, 0);
  assert.deepEqual(plan.add, []);
  assert.deepEqual(plan.skipped, [{ hostname: "x", reason: "no-slot" }]);
});

test("limit already exceeded never yields negative slots", () => {
  const plan = planStasisLinks([], 1, ["a", "b"]);
  assert.equal(plan.slotsFree, 0);
});

test("already-linked candidates are never re-added", () => {
  const plan = planStasisLinks([cand("dn-alpha"), cand("dn-beta")], 3, ["dn-alpha"]);
  assert.deepEqual(
    plan.add.map((c) => c.hostname),
    ["dn-beta"]
  );
  assert.deepEqual(plan.skipped, [{ hostname: "dn-alpha", reason: "linked" }]);
});

test("ineligible candidates are skipped with a machine-readable reason", () => {
  const plan = planStasisLinks(
    [
      cand("off", { isOnline: false }),
      cand("story", { isStationary: true }),
      cand("locked", { hasPassword: false }),
      cand("far", { canExec: false }),
      cand("ok"),
    ],
    5,
    []
  );
  assert.deepEqual(
    plan.add.map((c) => c.hostname),
    ["ok"]
  );
  assert.deepEqual(plan.skipped, [
    { hostname: "off", reason: "offline" },
    { hostname: "story", reason: "stationary" },
    { hostname: "locked", reason: "no-password" },
    { hostname: "far", reason: "no-exec-route" },
  ]);
});

test("skips servers without room for the worker, noting when freeing blocked RAM would fit it", () => {
  const plan = planStasisLinks(
    [
      cand("tight", { freeRam: STASIS_WORKER_RAM - 0.1, blockedRam: 0 }),
      cand("blocked", { freeRam: 4, blockedRam: 64 }),
      cand("fits", { freeRam: STASIS_WORKER_RAM }),
    ],
    3,
    []
  );
  assert.deepEqual(
    plan.add.map((c) => c.hostname),
    ["fits"]
  );
  assert.deepEqual(plan.skipped, [
    { hostname: "tight", reason: "no-ram" },
    { hostname: "blocked", reason: "blocked-ram" },
  ]);
});

test("worker RAM is the 1.6 GB script base plus 12 GB for setStasisLink", () => {
  assert.equal(STASIS_WORKER_RAM, 13.6);
});

// ── buildCandidate ──────────────────────────────────────────────────────────

// ns.dnet.getServerDetails() shape — only the fields buildCandidate reads.
function dnetDetails(over = {}) {
  return {
    isOnline: true,
    isStationary: false,
    isConnectedToCurrentServer: false,
    blockedRam: 8,
    depth: 4,
    difficulty: 12,
    ...over,
  };
}

// ns.getServer() shape — only the fields buildCandidate reads.
function gameServer(over = {}) {
  return { maxRam: 64, ramUsed: 16, backdoorInstalled: false, ...over };
}

test("buildCandidate maps dnet details and game server onto the planner shape", () => {
  const c = buildCandidate("dn-alpha", dnetDetails(), gameServer(), {
    hasPassword: true,
    isLinked: false,
  });
  assert.deepEqual(c, {
    hostname: "dn-alpha",
    isOnline: true,
    isStationary: false,
    hasPassword: true,
    canExec: false,
    freeRam: 48,
    blockedRam: 8,
    depth: 4,
    difficulty: 12,
  });
});

test("buildCandidate grants an exec route via direct connection, backdoor, or existing link", () => {
  const opts = { hasPassword: true, isLinked: false };
  const direct = buildCandidate("h", dnetDetails({ isConnectedToCurrentServer: true }), gameServer(), opts);
  assert.equal(direct.canExec, true);
  const backdoored = buildCandidate("h", dnetDetails(), gameServer({ backdoorInstalled: true }), opts);
  assert.equal(backdoored.canExec, true);
  const linked = buildCandidate("h", dnetDetails(), gameServer(), { hasPassword: true, isLinked: true });
  assert.equal(linked.canExec, true);
});

test("buildCandidate treats a missing game server as a zero-RAM candidate", () => {
  const c = buildCandidate("gone", dnetDetails(), null, { hasPassword: false, isLinked: false });
  assert.equal(c.freeRam, 0);
  assert.equal(c.canExec, false);
  assert.equal(c.hasPassword, false);
});

// ── parseDarknetMap ─────────────────────────────────────────────────────────

test("parseDarknetMap parses a JSON object and tolerates garbage like the password store", () => {
  const map = { "dn-alpha": { depth: 2, hint: "favorite pet" } };
  assert.deepEqual(parseDarknetMap(JSON.stringify(map)), map);
  assert.deepEqual(parseDarknetMap(""), {});
  assert.deepEqual(parseDarknetMap("nope"), {});
  assert.deepEqual(parseDarknetMap("[]"), {});
});

// ── mergeDarknetMap ─────────────────────────────────────────────────────────

// Probe-worker report shape: which server it ran on, and what it saw next door.
function report(from, neighbors) {
  return { from, neighbors };
}

const alphaDetails = {
  modelId: "ZeroLogon",
  depth: 1,
  difficulty: 7,
  hint: "the founder's cat",
  data: "",
  passwordFormat: "alphabetic",
  passwordLength: 8,
  requiredCharisma: 50,
  isStationary: false,
  isOnline: true,
};

// modelId is the field that says which vulnerability class a server is in — the one
// clue the game refuses to document, so it has to survive the trip from the probe
// worker into the map or the intel readout has nothing actionable to print.
test("mergeDarknetMap carries modelId through into the map", () => {
  const { map } = mergeDarknetMap({}, [report("darkweb", { "dn-alpha": alphaDetails })]);
  assert.equal(map["dn-alpha"].modelId, "ZeroLogon");
});

test("mergeDarknetMap adds newly discovered hosts and reports them as new", () => {
  const { map, newHosts } = mergeDarknetMap({}, [report("darkweb", { "dn-alpha": alphaDetails })]);
  assert.deepEqual(newHosts, ["dn-alpha"]);
  assert.equal(map["dn-alpha"].hint, "the founder's cat");
  assert.equal(map["dn-alpha"].seenFrom, "darkweb");
  // The prober itself gets its neighbor list recorded.
  assert.deepEqual(map["darkweb"].neighbors, ["dn-alpha"]);
});

test("mergeDarknetMap updates known hosts in place and keeps unseen hosts", () => {
  const existing = {
    "dn-alpha": { ...alphaDetails, depth: 1, seenFrom: "darkweb" },
    "dn-elsewhere": { depth: 9, hint: "old intel" },
  };
  const { map, newHosts } = mergeDarknetMap(existing, [
    report("darkweb", { "dn-alpha": { ...alphaDetails, depth: 3 } }),
  ]);
  assert.deepEqual(newHosts, []);
  assert.equal(map["dn-alpha"].depth, 3);
  // A host nobody probed this round is stale, not gone — the net just mutated around it.
  assert.equal(map["dn-elsewhere"].hint, "old intel");
});

test("mergeDarknetMap merges multiple reports and counts a twice-seen new host once", () => {
  const { map, newHosts } = mergeDarknetMap({}, [
    report("dn-a", { "dn-shared": { ...alphaDetails, depth: 2 } }),
    report("dn-b", { "dn-shared": { ...alphaDetails, depth: 2 }, "dn-only-b": alphaDetails }),
  ]);
  assert.deepEqual(newHosts, ["dn-shared", "dn-only-b"]);
  assert.deepEqual(map["dn-a"].neighbors, ["dn-shared"]);
  assert.deepEqual(map["dn-b"].neighbors, ["dn-shared", "dn-only-b"]);
});

// ── pickCrawlHosts ──────────────────────────────────────────────────────────

test("pickCrawlHosts takes only online, exec-able servers with a password and probe-worker room", () => {
  const picked = pickCrawlHosts(
    [
      cand("ok"),
      cand("offline", { isOnline: false }),
      cand("no-pw", { hasPassword: false }),
      cand("no-route", { canExec: false }),
      cand("cramped", { freeRam: PROBE_WORKER_RAM - 0.1 }),
    ],
    PROBE_WORKER_RAM
  );
  assert.deepEqual(
    picked.map((c) => c.hostname),
    ["ok"]
  );
});

test("probe worker RAM is the 1.6 GB base plus probe (0.2) and getServerDetails (0.1)", () => {
  assert.equal(PROBE_WORKER_RAM, 1.9);
});

// ── planCrackTargets ────────────────────────────────────────────────────────
//
// Stage A of the cracking pipeline (docs/API-COVERAGE-AUDIT.md §5.2): decide which
// uncracked servers are worth a heartbleed log capture, and which already-cracked
// neighbour to run the worker from. heartbleed() and authenticate() only reach servers
// directly connected to the server the script runs on, so every target needs a vantage
// point — the host whose probe report saw it.

// Map entry shape written by mergeDarknetMap() from a ProbeReport.
function entry(over = {}) {
  return { seenFrom: "dn-alpha", requiredCharisma: 10, isOnline: true, depth: 2, difficulty: 5, ...over };
}

test("planCrackTargets pairs an uncracked server with the host that saw it", () => {
  const targets = planCrackTargets({
    map: { "dn-beta": entry() },
    solved: [],
    charisma: 100,
  });
  assert.deepEqual(targets, [{ from: "dn-alpha", target: "dn-beta", requiredCharisma: 10 }]);
});

test("planCrackTargets skips servers whose password is already known", () => {
  const targets = planCrackTargets({
    map: { "dn-beta": entry() },
    solved: ["dn-beta"],
    charisma: 100,
  });
  assert.deepEqual(targets, []);
});

test("planCrackTargets skips offline servers", () => {
  const targets = planCrackTargets({
    map: { "dn-beta": entry({ isOnline: false }) },
    solved: [],
    charisma: 100,
  });
  assert.deepEqual(targets, []);
});

// "You cannot scrape logs from servers whose required charisma is higher than your
// charisma level" — NetscriptDefinitions.d.ts, Darknet.heartbleed.
test("planCrackTargets skips servers above the player's charisma", () => {
  const targets = planCrackTargets({
    map: { "dn-beta": entry({ requiredCharisma: 500 }) },
    solved: [],
    charisma: 100,
  });
  assert.deepEqual(targets, []);
});

// A host nobody has probed from has no vantage point, so no script can reach it.
test("planCrackTargets skips servers with no known vantage point", () => {
  const targets = planCrackTargets({
    map: { "dn-beta": entry({ seenFrom: undefined }) },
    solved: [],
    charisma: 100,
  });
  assert.deepEqual(targets, []);
});

test("planCrackTargets orders the easiest targets first", () => {
  const targets = planCrackTargets({
    map: {
      hard: entry({ requiredCharisma: 90 }),
      easy: entry({ requiredCharisma: 10 }),
      middling: entry({ requiredCharisma: 50 }),
    },
    solved: [],
    charisma: 100,
  });
  assert.deepEqual(
    targets.map((t) => t.target),
    ["easy", "middling", "hard"]
  );
});

// ── mergeHeartbleedLogs ─────────────────────────────────────────────────────
//
// Servers emit log lines on their own schedule (logTrafficInterval), so repeat captures
// return overlapping content. The store accumulates without duplicating.

test("mergeHeartbleedLogs records logs for a newly captured host", () => {
  const merged = mergeHeartbleedLogs({}, [{ host: "dn-beta", logs: ["auth failed for root"] }]);
  assert.deepEqual(merged, { "dn-beta": { logs: ["auth failed for root"] } });
});

test("mergeHeartbleedLogs appends only lines it has not already stored", () => {
  const existing = { "dn-beta": { logs: ["line one"] } };
  const merged = mergeHeartbleedLogs(existing, [
    { host: "dn-beta", logs: ["line one", "line two"] },
  ]);
  assert.deepEqual(merged["dn-beta"].logs, ["line one", "line two"]);
});

test("mergeHeartbleedLogs leaves hosts absent from this round untouched", () => {
  const existing = { "dn-alpha": { logs: ["kept"] } };
  const merged = mergeHeartbleedLogs(existing, [{ host: "dn-beta", logs: ["new"] }]);
  assert.deepEqual(merged["dn-alpha"].logs, ["kept"]);
});

test("mergeHeartbleedLogs ignores a capture that returned nothing", () => {
  const merged = mergeHeartbleedLogs({}, [{ host: "dn-beta", logs: [] }]);
  assert.deepEqual(merged, {});
});

// ── resolveLinkPassword ─────────────────────────────────────────────────────
//
// stasis.js link/unlink has to answer two questions before it can act: which password to
// use, and whether that password is worth writing to the store. Both used to be inline
// truthiness checks in main(), which made the empty string — the password of every
// ZeroLogon server — indistinguishable from "no password known". A ZeroLogon host was
// therefore unstorable, and since pickCrawlHosts() gates on the store, that single check
// kept the whole crawler pinned to home.

test("resolveLinkPassword uses an explicitly passed password", () => {
  const r = resolveLinkPassword("hunter2", {}, "dn-alpha");
  assert.deepEqual(r, { password: "hunter2", shouldSave: true });
});

test("resolveLinkPassword falls back to the stored password", () => {
  const r = resolveLinkPassword(null, { "dn-alpha": "hunter2" }, "dn-alpha");
  assert.deepEqual(r, { password: "hunter2", shouldSave: false });
});

test("resolveLinkPassword returns null when no password is known", () => {
  assert.equal(resolveLinkPassword(null, {}, "dn-alpha"), null);
});

test("resolveLinkPassword accepts an empty password as a real ZeroLogon credential", () => {
  const r = resolveLinkPassword("", {}, "darkweb");
  assert.deepEqual(r, { password: "", shouldSave: true });
});

test("resolveLinkPassword reads an empty stored password back out of the store", () => {
  const r = resolveLinkPassword(null, { darkweb: "" }, "darkweb");
  assert.deepEqual(r, { password: "", shouldSave: false });
});

test("resolveLinkPassword does not re-save a password the store already holds", () => {
  const r = resolveLinkPassword("hunter2", { "dn-alpha": "hunter2" }, "dn-alpha");
  assert.deepEqual(r, { password: "hunter2", shouldSave: false });
});

test("resolveLinkPassword prefers the passed password over a different stored one", () => {
  const r = resolveLinkPassword("new-pw", { "dn-alpha": "old-pw" }, "dn-alpha");
  assert.deepEqual(r, { password: "new-pw", shouldSave: true });
});
