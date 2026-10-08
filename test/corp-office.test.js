import { test } from "node:test";
import assert from "node:assert/strict";
import { main } from "/src/tools/corp-office.js";
import { callsTo, makeCorpNs, makeDivision, makeOffice } from "./corp-mock.mjs";

function corpWith(office, over = {}) {
  return makeCorpNs({
    unlocks: ["Office API"],
    divisions: [makeDivision({ offices: { "Sector-12": office } })],
    ...over,
  });
}

const jobsOf = (state) => state.divisions.Agri.offices["Sector-12"].employeeJobs;

test("it does nothing without the Office API", async () => {
  const { ns, state } = makeCorpNs({ unlocks: [] });
  await main(ns);
  assert.deepEqual(state.calls, []);
});

test("it grows an office, fills it and assigns every job", async () => {
  const { ns, state } = corpWith(makeOffice(), { funds: 1e12 });
  await main(ns);
  assert.deepEqual(callsTo(state, "upgradeOfficeSize"), [["Agri", "Sector-12", 3]]);
  assert.equal(callsTo(state, "hireEmployee").length, 6);
  assert.deepEqual(jobsOf(state), {
    Operations: 2, Engineer: 1, Business: 1, Management: 1, "Research & Development": 1, Intern: 0, Unassigned: 0,
  });
});

// (2b - 1b reserve) × 0.25 = 0.25b, short of the 3b growth step. Hiring is free.
test("it hires and assigns without growing when growth costs too much", async () => {
  const { ns, state } = corpWith(makeOffice(), { funds: 2e9 });
  await main(ns);
  assert.deepEqual(callsTo(state, "upgradeOfficeSize"), []);
  assert.deepEqual(jobsOf(state), {
    Operations: 1, Engineer: 1, Business: 1, Management: 0, "Research & Development": 0, Intern: 0, Unassigned: 0,
  });
});

// Employees hired by hand in the UI start Unassigned and produce nothing.
test("it assigns employees hired by hand", async () => {
  const office = makeOffice({ numEmployees: 3, employeeJobs: { Unassigned: 3 } });
  const { ns, state } = corpWith(office, { funds: 2e9 });
  await main(ns);
  assert.deepEqual(callsTo(state, "hireEmployee"), []);
  assert.equal(jobsOf(state).Unassigned, 0);
  assert.equal(jobsOf(state).Operations, 1);
});

test("it buys tea and throws a party when energy and morale slip", async () => {
  const office = makeOffice({ numEmployees: 3, avgEnergy: 50, avgMorale: 50, employeeJobs: { Operations: 1, Engineer: 1, Business: 1 } });
  const { ns, state } = corpWith(office, { funds: 2e9 });
  await main(ns);
  assert.deepEqual(callsTo(state, "buyTea"), [["Agri", "Sector-12"]]);
  assert.deepEqual(callsTo(state, "throwParty"), [["Agri", "Sector-12", 500e3]]);
});

test("it leaves a content office alone", async () => {
  const office = makeOffice({ size: 9, numEmployees: 9, employeeJobs: { Operations: 2, Engineer: 2, Business: 1, Management: 2, "Research & Development": 2 } });
  const { ns, state } = corpWith(office, { funds: 1e12 });
  await main(ns);
  assert.deepEqual(state.calls, []);
});

test("dry changes nothing", async () => {
  const { ns, state } = corpWith(makeOffice(), { args: ["dry"], funds: 1e12 });
  await main(ns);
  assert.deepEqual(state.calls, []);
  assert.ok(state.output.some((line) => line.includes("office +3")));
});

