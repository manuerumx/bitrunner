import { test } from "node:test";
import assert from "node:assert/strict";
import { main } from "/src/tools/corp-warehouse.js";
import { DEFAULTS } from "/src/lib/constants.js";
import { callsTo, makeCorpNs, makeDivision, makeOffice, makeWarehouse } from "./corp-mock.mjs";

function twoCities(warehouses, over = {}) {
  return makeCorpNs({
    unlocks: ["Warehouse API", "Smart Supply"],
    funds: 1e12,
    divisions: [makeDivision({ offices: { "Sector-12": makeOffice(), Aevum: makeOffice() }, warehouses })],
    ...over,
  });
}

test("it does nothing without the Warehouse API", async () => {
  const { ns, state } = makeCorpNs({ unlocks: ["Smart Supply"] });
  await main(ns);
  assert.deepEqual(state.calls, []);
});

test("it buys a missing warehouse and turns Smart Supply on everywhere", async () => {
  const { ns, state } = twoCities({ "Sector-12": makeWarehouse() });
  await main(ns);
  assert.deepEqual(callsTo(state, "purchaseWarehouse"), [["Agri", "Aevum"]]);
  assert.deepEqual(callsTo(state, "setSmartSupply"), [
    ["Agri", "Sector-12", true],
    ["Agri", "Aevum", true],
  ]);
});

test("it leaves Smart Supply alone until the unlock is bought", async () => {
  const { ns, state } = twoCities({ "Sector-12": makeWarehouse() }, { unlocks: ["Warehouse API"] });
  await main(ns);
  assert.deepEqual(callsTo(state, "setSmartSupply"), []);
});

test("it grows a warehouse once it is 80% full", async () => {
  const { ns, state } = twoCities({
    "Sector-12": makeWarehouse({ sizeUsed: 85, smartSupplyEnabled: true }),
    Aevum: makeWarehouse({ sizeUsed: 50, smartSupplyEnabled: true }),
  });
  await main(ns);
  assert.deepEqual(callsTo(state, "upgradeWarehouse"), [["Agri", "Sector-12", 1]]);
});

test("it waits for money above the reserve to buy a warehouse", async () => {
  const { ns, state } = twoCities({ "Sector-12": makeWarehouse({ smartSupplyEnabled: true }) }, { funds: 5e9 });
  await main(ns);
  assert.deepEqual(callsTo(state, "purchaseWarehouse"), []);
});

test("dry changes nothing", async () => {
  const { ns, state } = twoCities({ "Sector-12": makeWarehouse() }, { args: ["dry"] });
  await main(ns);
  assert.deepEqual(state.calls, []);
});


// corp-boost.js fills a warehouse to 1 - corpWarehouseHeadroom with boost materials and stops.
// If growth waited for more than that, warehouses would only grow when output piles up unsold.
test("warehouses grow before the boost share alone fills them", () => {
  assert.ok(DEFAULTS.corpWarehouseUpgradeAt < 1 - DEFAULTS.corpWarehouseHeadroom);
});
