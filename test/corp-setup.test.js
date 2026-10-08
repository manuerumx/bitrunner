import { test } from "node:test";
import assert from "node:assert/strict";
import { main } from "/src/tools/corp-setup.js";
import { callsTo, makeCorpNs, makeDivision } from "./corp-mock.mjs";

const EVERY_UNLOCK = ["Smart Supply", "Warehouse API", "Office API"];

// Seed money 150b: division 40b, Smart Supply 25b, five cities 20b and the Warehouse API 50b
// fit above the 1b reserve; the Office API (50b more) has to wait.
test("from nothing it creates the corp with seed money and buys in order until money runs out", async () => {
  const { ns, state } = makeCorpNs({ hasCorp: false, divisions: [] });
  await main(ns);
  assert.deepEqual(state.calls.map((call) => call[0]), [
    "createCorporation", "expandIndustry", "purchaseUnlock",
    "expandCity", "expandCity", "expandCity", "expandCity", "expandCity", "purchaseUnlock",
  ]);
  assert.deepEqual(callsTo(state, "createCorporation"), [["Bitrunner", false]]);
  assert.deepEqual(callsTo(state, "expandIndustry"), [["Agriculture", "Agri"]]);
  assert.deepEqual(callsTo(state, "purchaseUnlock"), [["Smart Supply"], ["Warehouse API"]]);
});

test("it does nothing where seed money isn't offered", async () => {
  const { ns, state } = makeCorpNs({ hasCorp: false, canCreate: "UseSeedMoneyOutsideBN3", divisions: [] });
  await main(ns);
  assert.deepEqual(state.calls, []);
});

// A division made by hand in the UI, under another name, must not be duplicated.
test("it uses an existing division of the industry whatever its name", async () => {
  const { ns, state } = makeCorpNs({ divisions: [makeDivision({ name: "Farm" })], unlocks: EVERY_UNLOCK, funds: 1e12 });
  await main(ns);
  assert.deepEqual(callsTo(state, "expandIndustry"), []);
  assert.equal(callsTo(state, "expandCity").length, 5);
  assert.ok(callsTo(state, "expandCity").every(([div]) => div === "Farm"));
});

test("it never spends the reserve", async () => {
  const { ns, state } = makeCorpNs({ funds: 25e9 + 1e9 - 1 });
  await main(ns);
  assert.deepEqual(state.calls, []);
});

test("a second run has nothing left to buy", async () => {
  const { ns, state } = makeCorpNs({ hasCorp: false, divisions: [], funds: 1e12 });
  await main(ns);
  const first = state.calls.length;
  await main(ns);
  assert.equal(state.calls.length, first);
});

test("dry reports the plan and buys nothing", async () => {
  const { ns, state } = makeCorpNs({ args: ["dry"], funds: 1e12 });
  await main(ns);
  assert.deepEqual(state.calls, []);
  assert.ok(state.output.some((line) => line.includes("would buy the Smart Supply unlock")));
});

