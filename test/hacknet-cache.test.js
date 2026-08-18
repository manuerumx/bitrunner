import { test } from "node:test";
import assert from "node:assert/strict";
import { pickCacheUpgrade } from "/src/managers/hacknet-manager.js";

function makeNs({ hashes, capacity, cacheCosts }) {
  return {
    hacknet: {
      numNodes: () => cacheCosts.length,
      numHashes: () => hashes,
      hashCapacity: () => capacity,
      getCacheUpgradeCost: (i) => cacheCosts[i],
    },
  };
}

// Cache raises hashCapacity(). Unlike level/RAM/cores it adds no production, so the
// payback ranking the other upgrades use doesn't apply — the trigger is evidence that
// hashes are actually being wasted, i.e. the bar sitting near full between spend cycles.
test("pickCacheUpgrade upgrades the cheapest node when the hash bar is near capacity", () => {
  const ns = makeNs({ hashes: 90, capacity: 100, cacheCosts: [500, 200, 900] });
  assert.deepEqual(pickCacheUpgrade(ns, 0.8), { node: 1, cost: 200 });
});

test("pickCacheUpgrade does nothing while there is headroom", () => {
  const ns = makeNs({ hashes: 10, capacity: 100, cacheCosts: [500] });
  assert.equal(pickCacheUpgrade(ns, 0.8), null);
});

// hashCapacity() is 0 on BitNodes whose hacknet produces money instead of hashes.
test("pickCacheUpgrade is a no-op without hacknet servers", () => {
  const ns = makeNs({ hashes: 0, capacity: 0, cacheCosts: [500] });
  assert.equal(pickCacheUpgrade(ns, 0.8), null);
});

// getCacheUpgradeCost returns Infinity for a node whose cache is already maxed.
test("pickCacheUpgrade skips nodes whose cache is maxed", () => {
  const ns = makeNs({ hashes: 95, capacity: 100, cacheCosts: [Infinity, 700] });
  assert.deepEqual(pickCacheUpgrade(ns, 0.8), { node: 1, cost: 700 });
});

test("pickCacheUpgrade returns null when every node is maxed", () => {
  const ns = makeNs({ hashes: 95, capacity: 100, cacheCosts: [Infinity, Infinity] });
  assert.equal(pickCacheUpgrade(ns, 0.8), null);
});

test("pickCacheUpgrade triggers exactly at the threshold", () => {
  const ns = makeNs({ hashes: 80, capacity: 100, cacheCosts: [300] });
  assert.deepEqual(pickCacheUpgrade(ns, 0.8), { node: 0, cost: 300 });
});

test("pickCacheUpgrade returns null with no nodes", () => {
  const ns = makeNs({ hashes: 95, capacity: 100, cacheCosts: [] });
  assert.equal(pickCacheUpgrade(ns, 0.8), null);
});
