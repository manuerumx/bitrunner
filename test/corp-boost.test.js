import { test } from "node:test";
import assert from "node:assert/strict";
import { main } from "/src/tools/corp-boost.js";
import { BOOST_SIZES, boostFactors, optimalBoostAmounts } from "/src/lib/corp.js";
import { AGRICULTURE, callsTo, makeCorpNs, makeDivision, makeWarehouse } from "./corp-mock.mjs";

function boostCorp(over = {}) {
  return makeCorpNs({
    unlocks: ["Warehouse API"],
    funds: 1e12,
    divisions: [makeDivision({ warehouses: { "Sector-12": makeWarehouse({ size: 1000 }) } })],
    ...over,
  });
}

test("it does nothing without the Warehouse API", async () => {
  const { ns, state } = makeCorpNs({ unlocks: [] });
  await main(ns);
  assert.deepEqual(state.calls, []);
});

// 1000 space less 40% headroom leaves 600 for boost materials.
test("it buys the optimal boost mix for the industry", async () => {
  const { ns, state } = boostCorp();
  await main(ns);
  const expected = optimalBoostAmounts(boostFactors(AGRICULTURE), BOOST_SIZES, 600);
  const bought = Object.fromEntries(callsTo(state, "bulkPurchase").map(([, , name, amount]) => [name, amount]));
  for (const [name, amount] of Object.entries(expected)) assert.equal(bought[name] ?? 0, amount, name);
});

test("a second run buys no more boost materials", async () => {
  const { ns, state } = boostCorp();
  await main(ns);
  const first = callsTo(state, "bulkPurchase").length;
  await main(ns);
  assert.equal(callsTo(state, "bulkPurchase").length, first);
});

test("it puts the industry's output on sale once", async () => {
  const { ns, state } = boostCorp();
  await main(ns);
  await main(ns);
  assert.deepEqual(callsTo(state, "sellMaterial"), [
    ["Agri", "Sector-12", "Plants", "MAX", "MP"],
    ["Agri", "Sector-12", "Food", "MAX", "MP"],
  ]);
});

test("it turns on Market-TA.II once researched", async () => {
  const { ns, state } = boostCorp({
    unlocks: ["Warehouse API", "Office API"],
    divisions: [makeDivision({ research: ["Market-TA.II"] })],
  });
  await main(ns);
  assert.deepEqual(callsTo(state, "setMaterialMarketTA2"), [
    ["Agri", "Sector-12", "Plants", true],
    ["Agri", "Sector-12", "Food", true],
  ]);
});

// Checking research is an Office API call; the mock throws if it's made without the unlock.
test("it skips Market-TA.II without the Office API", async () => {
  const { ns, state } = boostCorp({ divisions: [makeDivision({ research: ["Market-TA.II"] })] });
  await main(ns);
  assert.deepEqual(callsTo(state, "setMaterialMarketTA2"), []);
});

test("it skips a city with no warehouse", async () => {
  const { ns, state } = boostCorp({ divisions: [makeDivision({ warehouses: {} })] });
  await main(ns);
  assert.deepEqual(state.calls, []);
});

test("dry changes nothing", async () => {
  const { ns, state } = boostCorp({ args: ["dry"] });
  await main(ns);
  assert.deepEqual(state.calls, []);
});

