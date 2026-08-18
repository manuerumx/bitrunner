import { test } from "node:test";
import assert from "node:assert/strict";
import { needsReassignment, planSleeveSpending } from "/src/lib/sleeves.js";

// ── needsReassignment ───────────────────────────────────────────────────────
//
// sleeve-manager.js re-issues every setTo* call on each 30 s cycle regardless of what the
// sleeve is already doing. Some of those calls restart the task, throwing away partial
// progress (crimes and faction work accumulate cycles). ns.sleeve.getTask() reports the
// live task; matching against it makes the assignment idempotent.

test("needsReassignment is false when the sleeve already commits the desired crime", () => {
  const current = { type: "CRIME", crimeType: "Homicide" };
  assert.equal(needsReassignment(current, { type: "crime", crime: "Homicide" }), false);
});

test("needsReassignment is true when the sleeve commits a different crime", () => {
  const current = { type: "CRIME", crimeType: "Mug" };
  assert.equal(needsReassignment(current, { type: "crime", crime: "Homicide" }), true);
});

test("needsReassignment is true when the task type differs entirely", () => {
  const current = { type: "RECOVERY" };
  assert.equal(needsReassignment(current, { type: "crime", crime: "Mug" }), true);
});

test("needsReassignment is false when the sleeve already works for the desired faction", () => {
  const current = { type: "FACTION", factionName: "BitRunners", factionWorkType: "hacking" };
  const desired = { type: "faction", faction: "BitRunners", workType: "hacking" };
  assert.equal(needsReassignment(current, desired), false);
});

test("needsReassignment is true when the sleeve works for a different faction", () => {
  const current = { type: "FACTION", factionName: "Netburners", factionWorkType: "hacking" };
  const desired = { type: "faction", faction: "BitRunners", workType: "hacking" };
  assert.equal(needsReassignment(current, desired), true);
});

test("needsReassignment is false when the sleeve is already recovering", () => {
  assert.equal(needsReassignment({ type: "RECOVERY" }, { type: "recovery" }), false);
});

test("needsReassignment is false when the sleeve is already synchronizing", () => {
  assert.equal(needsReassignment({ type: "SYNCHRO" }, { type: "sync" }), false);
});

test("needsReassignment is false when the sleeve already trains the desired stat", () => {
  const current = { type: "CLASS", classType: "str" };
  assert.equal(needsReassignment(current, { type: "gym", stat: "str" }), false);
});

// getTask() returns null for an idle sleeve, and after a reset every sleeve is idle.
test("needsReassignment is true when the sleeve has no task at all", () => {
  assert.equal(needsReassignment(null, { type: "crime", crime: "Mug" }), true);
});

// ── planSleeveSpending ──────────────────────────────────────────────────────
//
// A new sleeve compounds — it earns from the moment it exists — so it outranks memory on
// an existing one. Memory is the other permanent buy: it survives resets, unlike shock
// and sync which reset with the run.

test("planSleeveSpending buys a new sleeve before upgrading memory", () => {
  const plan = planSleeveSpending({
    money: 1000,
    sleeveCost: 400,
    memoryCosts: [{ sleeveNum: 0, cost: 300 }],
  });
  assert.deepEqual(plan.buy.map((i) => i.name), ["sleeve", "memory-0"]);
});

test("planSleeveSpending upgrades memory when no sleeve is for sale", () => {
  const plan = planSleeveSpending({
    money: 1000,
    sleeveCost: null,
    memoryCosts: [{ sleeveNum: 2, cost: 300 }],
  });
  assert.deepEqual(plan.buy.map((i) => i.name), ["memory-2"]);
});

test("planSleeveSpending honours the reserve fraction", () => {
  const plan = planSleeveSpending({
    money: 1000,
    reserveFraction: 0.9,
    sleeveCost: 400,
    memoryCosts: [],
  });
  assert.deepEqual(plan.buy, []);
});

// Memory is cheapest-first so a partial budget spreads across sleeves rather than
// stalling on the priciest one.
test("planSleeveSpending upgrades the cheapest memory first", () => {
  const plan = planSleeveSpending({
    money: 500,
    sleeveCost: null,
    memoryCosts: [
      { sleeveNum: 0, cost: 400 },
      { sleeveNum: 1, cost: 100 },
    ],
  });
  assert.deepEqual(plan.buy.map((i) => i.name), ["memory-1", "memory-0"]);
});

test("planSleeveSpending buys nothing when broke", () => {
  const plan = planSleeveSpending({ money: 0, sleeveCost: 400, memoryCosts: [] });
  assert.deepEqual(plan.buy, []);
});
