import { test } from "node:test";
import assert from "node:assert/strict";
import { rankXPTargets } from "/src/lib/target-selector.js";

// Mock just the ns calls rankXPTargets touches. `servers` maps hostname -> {base, weakenTime, req?, root?}.
function makeNs(servers, playerHacking = 2000) {
  return {
    getHackingLevel: () => playerHacking,
    hasRootAccess: (h) => servers[h].root ?? true,
    getServerRequiredHackingLevel: (h) => servers[h].req ?? 1,
    getServerBaseSecurityLevel: (h) => servers[h].base,
    getWeakenTime: (h) => servers[h].weakenTime,
  };
}

test("rankXPTargets ranks by EXP/sec, not raw difficulty", () => {
  // fast: exp = 3 + 0.3*10 = 6, /100ms = 0.060 (wins despite low difficulty)
  // bigexp: exp = 3 + 0.3*100 = 33, /1000ms = 0.033 (more EXP/op but slower)
  const ns = makeNs({
    fast: { base: 10, weakenTime: 100 },
    bigexp: { base: 100, weakenTime: 1000 },
  });
  const ranked = rankXPTargets(ns, ["bigexp", "fast"]);
  assert.equal(ranked[0].hostname, "fast");
  assert.equal(ranked[1].hostname, "bigexp");
  assert.ok(Math.abs(ranked[0].score - 0.06) < 1e-9);
  assert.ok(Math.abs(ranked[0].expPerOp - 6) < 1e-9);
});

test("rankXPTargets excludes home, unrooted, and over-level servers", () => {
  const ns = makeNs(
    {
      home: { base: 99, weakenTime: 10 }, // excluded: home
      locked: { base: 200, weakenTime: 10, req: 9999 }, // excluded: req > playerHacking
      unrooted: { base: 50, weakenTime: 10, root: false }, // excluded: no root
      good: { base: 30, weakenTime: 500 }, // the only eligible one
    },
    1407
  );
  const ranked = rankXPTargets(ns, ["home", "locked", "unrooted", "good"]);
  assert.equal(ranked.length, 1);
  assert.equal(ranked[0].hostname, "good");
});

test("rankXPTargets skips servers with non-positive weakenTime", () => {
  const ns = makeNs({
    dead: { base: 50, weakenTime: 0 },
    alive: { base: 20, weakenTime: 200 },
  });
  const ranked = rankXPTargets(ns, ["dead", "alive"]);
  assert.equal(ranked.length, 1);
  assert.equal(ranked[0].hostname, "alive");
});
