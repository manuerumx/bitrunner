import { test } from "node:test";
import assert from "node:assert/strict";
import { BOOST_MATERIALS, planBoostPurchases, selectMaterialsToSell } from "/src/lib/corp.js";

// Material shape as returned by ns.corporation.getMaterial() — only the fields read here.
function mat(name, over = {}) {
  return { name, stored: 100, productionAmount: 10, ...over };
}

// ── selectMaterialsToSell ───────────────────────────────────────────────────

// Hardware / Robots / AI Cores / Real Estate multiply a division's production while
// they are HELD. Selling them liquidates the multiplier. corp-manager.js sold all four
// on the same "stored > 0 && producing" rule it used for actual output goods.
test("selectMaterialsToSell never sells boost materials", () => {
  const materials = BOOST_MATERIALS.map((name) => mat(name));
  assert.deepEqual(selectMaterialsToSell(materials), []);
});

test("selectMaterialsToSell sells produced output materials", () => {
  const materials = [mat("Food"), mat("Plants")];
  assert.deepEqual(selectMaterialsToSell(materials), ["Food", "Plants"]);
});

test("selectMaterialsToSell holds boost materials while selling output alongside them", () => {
  const materials = [mat("Food"), mat("Hardware"), mat("Plants"), mat("Real Estate")];
  assert.deepEqual(selectMaterialsToSell(materials), ["Food", "Plants"]);
});

// A material the division does not produce is bought stock, not output — selling it
// would dump inventory the division just paid for.
test("selectMaterialsToSell ignores materials the division does not produce", () => {
  assert.deepEqual(selectMaterialsToSell([mat("Food", { productionAmount: 0 })]), []);
});

test("selectMaterialsToSell ignores materials with nothing in stock", () => {
  assert.deepEqual(selectMaterialsToSell([mat("Food", { stored: 0 })]), []);
});

// ── planBoostPurchases ──────────────────────────────────────────────────────

// Boost materials are bought toward a per-industry target and then held. The warehouse
// is the hard constraint: overfilling it stalls production entirely.
test("planBoostPurchases buys the shortfall against the target", () => {
  const plan = planBoostPurchases({
    targets: { Hardware: 500 },
    stored: { Hardware: 200 },
    freeSpace: 1000,
  });
  assert.deepEqual(plan, [{ name: "Hardware", amount: 300 }]);
});

test("planBoostPurchases buys nothing once the target is met", () => {
  const plan = planBoostPurchases({
    targets: { Hardware: 500 },
    stored: { Hardware: 500 },
    freeSpace: 1000,
  });
  assert.deepEqual(plan, []);
});

test("planBoostPurchases treats a missing stock entry as zero", () => {
  const plan = planBoostPurchases({ targets: { Robots: 50 }, stored: {}, freeSpace: 1000 });
  assert.deepEqual(plan, [{ name: "Robots", amount: 50 }]);
});

// Warehouse space is shared across every boost material, so the budget has to be
// consumed as the plan is built, not checked per-material against the full total.
test("planBoostPurchases caps total purchases at the free warehouse space", () => {
  const plan = planBoostPurchases({
    targets: { Hardware: 500, Robots: 500 },
    stored: {},
    freeSpace: 700,
  });
  assert.deepEqual(plan, [
    { name: "Hardware", amount: 500 },
    { name: "Robots", amount: 200 },
  ]);
});

test("planBoostPurchases buys nothing when the warehouse is full", () => {
  const plan = planBoostPurchases({ targets: { Hardware: 500 }, stored: {}, freeSpace: 0 });
  assert.deepEqual(plan, []);
});
