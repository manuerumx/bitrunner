import { test } from "node:test";
import assert from "node:assert/strict";
import { rankBackdoorCandidates } from "/src/tools/backdoor-next.js";

// getServerDetails() shapes — only the fields rankBackdoorCandidates reads.
function srv(hostname, over = {}) {
  return {
    hostname,
    hasRoot: true,
    backdoor: false,
    isPurchased: false,
    requiredHackLevel: 100,
    ...over,
  };
}

test("excludes unrooted, already-backdoored, purchased, and over-level servers", () => {
  const servers = [
    srv("ok", { requiredHackLevel: 50 }),
    srv("unrooted", { hasRoot: false, requiredHackLevel: 10 }),
    srv("done", { backdoor: true, requiredHackLevel: 10 }),
    srv("mine", { isPurchased: true, requiredHackLevel: 10 }),
    srv("too-high", { requiredHackLevel: 5000 }),
  ];
  const ranked = rankBackdoorCandidates(servers, 1407);
  assert.deepEqual(
    ranked.map((s) => s.hostname),
    ["ok"]
  );
});

test("faction servers rank ahead of regular ones, regardless of level", () => {
  const servers = [
    srv("easy-regular", { requiredHackLevel: 1 }),
    srv("CSEC", { requiredHackLevel: 54 }),
    srv("run4theh111z", { requiredHackLevel: 505 }),
  ];
  const ranked = rankBackdoorCandidates(servers, 1407);
  // Both faction servers first (sorted by required level among themselves), then the regular one.
  assert.deepEqual(
    ranked.map((s) => s.hostname),
    ["CSEC", "run4theh111z", "easy-regular"]
  );
});

test("regular servers are ordered by ascending required hacking level", () => {
  const servers = [srv("hard", { requiredHackLevel: 900 }), srv("medium", { requiredHackLevel: 400 }), srv("soft", { requiredHackLevel: 80 })];
  const ranked = rankBackdoorCandidates(servers, 1407);
  assert.deepEqual(
    ranked.map((s) => s.hostname),
    ["soft", "medium", "hard"]
  );
});

test("returns empty when nothing is eligible", () => {
  const servers = [srv("done", { backdoor: true }), srv("too-high", { requiredHackLevel: 9999 })];
  assert.deepEqual(rankBackdoorCandidates(servers, 1407), []);
});
