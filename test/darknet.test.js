import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildCandidate,
  mergeDarknetMap,
  parseDarknetMap,
  parsePasswordStore,
  pickCrawlHosts,
  planStasisLinks,
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
