import { test } from "node:test";
import assert from "node:assert/strict";
import { pickPurchaseRam, pickUpgradeTarget } from "/src/managers/server-buyer.js";

// ns.cloud.getServerCost is superlinear in RAM; a simple doubling table is enough to
// exercise the tier selection.
function makeNs({ money, ramLimit = 1048576, servers = {}, cost = (ram) => ram * 1000 }) {
  return {
    getPlayer: () => ({ money }),
    getServerMaxRam: (h) => servers[h],
    cloud: {
      getRamLimit: () => ramLimit,
      getServerCost: cost,
      getServerUpgradeCost: (h, ram) => cost(ram) - cost(servers[h]),
    },
  };
}

// ── pickPurchaseRam ─────────────────────────────────────────────────────────

test("pickPurchaseRam doubles up while half the wallet still covers the next tier", () => {
  // 128 GB costs 128k; half of 500k is 250k, so 128 fits and 256 (256k) does not.
  const ns = makeNs({ money: 500_000 });
  assert.equal(pickPurchaseRam(ns, 500_000), 128);
});

// The old code capped at a hardcoded DEFAULTS.maxPurchasedServerRAM of 1 PB. This fork
// exposes the real per-server ceiling, which may differ or scale with progression.
test("pickPurchaseRam never exceeds the cloud RAM limit", () => {
  const ns = makeNs({ money: 1e18, ramLimit: 64 });
  assert.equal(pickPurchaseRam(ns, 1e18), 64);
});

test("pickPurchaseRam returns the base tier when nothing bigger is affordable", () => {
  const ns = makeNs({ money: 1 });
  assert.equal(pickPurchaseRam(ns, 1), 8);
});

// ── pickUpgradeTarget ───────────────────────────────────────────────────────

test("pickUpgradeTarget picks the smallest server", () => {
  const ns = makeNs({ money: 1e9, servers: { big: 512, small: 64, mid: 128 } });
  const target = pickUpgradeTarget(ns, ["big", "small", "mid"]);
  assert.equal(target.hostname, "small");
  assert.equal(target.newRam, 128);
});

test("pickUpgradeTarget returns null once every server is at the cloud RAM limit", () => {
  const ns = makeNs({ money: 1e9, ramLimit: 128, servers: { a: 128, b: 128 } });
  assert.equal(pickUpgradeTarget(ns, ["a", "b"]), null);
});

// Regression: the limit is read from the game, so a server already above a *lowered*
// limit must not be doubled further.
test("pickUpgradeTarget skips a server already at or above the limit", () => {
  const ns = makeNs({ money: 1e9, ramLimit: 256, servers: { maxed: 256, room: 64 } });
  const target = pickUpgradeTarget(ns, ["maxed", "room"]);
  assert.equal(target.hostname, "room");
});

test("pickUpgradeTarget returns null for an empty fleet", () => {
  const ns = makeNs({ money: 1e9 });
  assert.equal(pickUpgradeTarget(ns, []), null);
});
