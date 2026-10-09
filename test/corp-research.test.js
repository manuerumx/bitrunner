import { test } from "node:test";
import assert from "node:assert/strict";
import { main } from "/src/tools/corp-research.js";
import { SPENDING_HOLD_FILE } from "/src/lib/corp.js";
import { DEFAULTS } from "/src/lib/constants.js";
import { callsTo, makeCorpNs, makeDivision } from "./corp-mock.mjs";

// (101b - 1b reserve) × 0.05 = 5b: Smart Storage and Smart Factories fit, FocusWires doesn't.
const UPGRADE_COSTS = { "Smart Storage": 1e9, "Smart Factories": 2e9, FocusWires: 1e12 };

test("it levels the cheapest upgrades within its budget", async () => {
  const { ns, state } = makeCorpNs({ funds: 101e9, upgradeCosts: UPGRADE_COSTS });
  await main(ns);
  assert.deepEqual(callsTo(state, "levelUpgrade"), [["Smart Storage"], ["Smart Factories"]]);
});

test("it researches in order while points last", async () => {
  const { ns, state } = makeCorpNs({
    unlocks: ["Office API"],
    divisions: [makeDivision({ researchPoints: 30000 })],
    researchCosts: { "Hi-Tech R&D Laboratory": 5000, "Market-TA.I": 20000 },
  });
  await main(ns);
  assert.deepEqual(callsTo(state, "research"), [["Agri", "Hi-Tech R&D Laboratory"]]);
});

test("it researches nothing without the Office API", async () => {
  const { ns, state } = makeCorpNs({
    divisions: [makeDivision({ researchPoints: 1e9 })],
    researchCosts: { "Hi-Tech R&D Laboratory": 5000 },
  });
  await main(ns);
  assert.deepEqual(callsTo(state, "research"), []);
});

test("dry changes nothing", async () => {
  const { ns, state } = makeCorpNs({
    args: ["dry"],
    funds: 101e9,
    upgradeCosts: UPGRADE_COSTS,
    unlocks: ["Office API"],
    divisions: [makeDivision({ researchPoints: 30000 })],
    researchCosts: { "Hi-Tech R&D Laboratory": 5000 },
  });
  await main(ns);
  assert.deepEqual(state.calls, []);
});


// corp-invest.js holds spending while it reads a funding offer; free work carries on.
const HELD = { [SPENDING_HOLD_FILE]: JSON.stringify({ round: 1, since: Date.now() }) };

test("it levels no upgrades while spending is held, but still researches", async () => {
  const { ns, state } = makeCorpNs({
    funds: 101e9,
    upgradeCosts: UPGRADE_COSTS,
    unlocks: ["Office API"],
    divisions: [makeDivision({ researchPoints: 30000 })],
    researchCosts: { "Hi-Tech R&D Laboratory": 5000 },
    files: HELD,
  });
  await main(ns);
  assert.deepEqual(callsTo(state, "levelUpgrade"), []);
  assert.deepEqual(callsTo(state, "research"), [["Agri", "Hi-Tech R&D Laboratory"]]);
});

test("a hold older than corpHoldMaxMs no longer stops spending", async () => {
  const lapsed = JSON.stringify({ round: 1, since: Date.now() - DEFAULTS.corpHoldMaxMs - 1000 });
  const { ns, state } = makeCorpNs({ funds: 101e9, upgradeCosts: UPGRADE_COSTS, files: { [SPENDING_HOLD_FILE]: lapsed } });
  await main(ns);
  assert.deepEqual(callsTo(state, "levelUpgrade"), [["Smart Storage"], ["Smart Factories"]]);
});
