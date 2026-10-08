import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BOOST_MATERIALS,
  orderJobAssignments,
  planBoostPurchases,
  planJobs,
  planSetup,
  selectMaterialsToSell,
  wellbeingActions,
} from "/src/lib/corp.js";

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

// ── planSetup ───────────────────────────────────────────────────────────────

const ALL_CITIES = ["Aevum", "Chongqing", "Sector-12", "New Tokyo", "Ishima", "Volhaven"];
const UNLOCK_COSTS = { "Smart Supply": 25e9, "Warehouse API": 50e9, "Office API": 50e9 };

function setup(over = {}) {
  return planSetup({
    unlocks: [],
    cities: ["Sector-12"],
    allCities: ALL_CITIES,
    unlockCosts: UNLOCK_COSTS,
    cityCost: 4e9,
    funds: 1e12,
    reserve: 1e9,
    ...over,
  });
}

const names = (plan) => plan.buy.map((step) => step.name);

test("planSetup buys Smart Supply, then the missing cities, then the API unlocks", () => {
  const plan = setup();
  assert.deepEqual(names(plan), [
    "Smart Supply", "Aevum", "Chongqing", "New Tokyo", "Ishima", "Volhaven", "Warehouse API", "Office API",
  ]);
  assert.equal(plan.waiting, null);
});

// A cheap later step must not spend money an earlier, more important one is waiting for.
test("planSetup stops at the first step it can't afford", () => {
  const plan = setup({ funds: 1e9 + 25e9 + 8e9 + 1 });
  assert.deepEqual(names(plan), ["Smart Supply", "Aevum", "Chongqing"]);
  assert.deepEqual(plan.waiting, { kind: "city", name: "New Tokyo", cost: 4e9 });
});

test("planSetup never spends the reserve", () => {
  const plan = setup({ funds: 25e9 + 1e9 - 1 });
  assert.deepEqual(plan.buy, []);
  assert.equal(plan.waiting?.name, "Smart Supply");
});

test("planSetup has nothing to do once everything is owned", () => {
  const plan = setup({ unlocks: ["Smart Supply", "Warehouse API", "Office API"], cities: ALL_CITIES });
  assert.deepEqual(plan, { buy: [], waiting: null });
});


// ── planJobs / orderJobAssignments / wellbeingActions ───────────────────────

const WEIGHTS = { Operations: 2, Engineer: 2, Business: 1, Management: 2, "Research & Development": 2 };

test("planJobs gives one of each job first, in key order", () => {
  assert.deepEqual(planJobs(3, WEIGHTS), {
    Operations: 1, Engineer: 1, Business: 1, Management: 0, "Research & Development": 0,
  });
});

test("planJobs splits a larger office by weight", () => {
  assert.deepEqual(planJobs(9, WEIGHTS), {
    Operations: 2, Engineer: 2, Business: 1, Management: 2, "Research & Development": 2,
  });
});

test("planJobs leaves an empty office empty", () => {
  assert.deepEqual(planJobs(0, WEIGHTS), {
    Operations: 0, Engineer: 0, Business: 0, Management: 0, "Research & Development": 0,
  });
});

test("planJobs never staffs a job with weight 0", () => {
  assert.deepEqual(planJobs(2, { Operations: 1, Engineer: 0 }), { Operations: 2 });
});

test("orderJobAssignments fills jobs from Unassigned", () => {
  const current = { Operations: 0, Engineer: 0, Business: 0, Unassigned: 3 };
  const target = { Operations: 1, Engineer: 1, Business: 1 };
  assert.deepEqual(orderJobAssignments(current, target), [
    { job: "Operations", count: 1 },
    { job: "Engineer", count: 1 },
    { job: "Business", count: 1 },
  ]);
});

// Raising a job draws from Unassigned, so the cuts have to run first.
test("orderJobAssignments makes every cut before any raise", () => {
  const current = { Operations: 0, Engineer: 3, Unassigned: 0 };
  const target = { Operations: 2, Engineer: 1 };
  assert.deepEqual(orderJobAssignments(current, target), [
    { job: "Engineer", count: 1 },
    { job: "Operations", count: 2 },
  ]);
});

test("orderJobAssignments cuts jobs the plan doesn't use, such as Intern", () => {
  const current = { Operations: 0, Intern: 2, Unassigned: 0 };
  assert.deepEqual(orderJobAssignments(current, { Operations: 2 }), [
    { job: "Intern", count: 0 },
    { job: "Operations", count: 2 },
  ]);
});

test("orderJobAssignments has nothing to do when the office matches", () => {
  assert.deepEqual(orderJobAssignments({ Operations: 2, Unassigned: 0 }, { Operations: 2 }), []);
});

test("wellbeingActions asks for tea and a party below the floor", () => {
  const office = { avgEnergy: 90, maxEnergy: 100, avgMorale: 99, maxMorale: 100 };
  assert.deepEqual(wellbeingActions(office, 0.95), { tea: true, party: false });
});

