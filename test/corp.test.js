import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BOOST_SIZES,
  boostFactors,
  optimalBoostAmounts,
  orderJobAssignments,
  planBoostPurchases,
  planJobs,
  planSetup,
  wellbeingActions,
} from "/src/lib/corp.js";

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

// ── boostFactors / optimalBoostAmounts ──────────────────────────────────────

const AGRI_FACTORS = { Hardware: 0.2, Robots: 0.3, "AI Cores": 0.3, "Real Estate": 0.72 };

test("boostFactors maps an industry's factors to material names, 0 when missing", () => {
  assert.deepEqual(boostFactors({ hardwareFactor: 0.2, realEstateFactor: 0.72 }), {
    Hardware: 0.2, Robots: 0, "AI Cores": 0, "Real Estate": 0.72,
  });
});

test("optimalBoostAmounts buys nothing without space", () => {
  assert.deepEqual(optimalBoostAmounts(AGRI_FACTORS, BOOST_SIZES, 0), {
    Hardware: 0, Robots: 0, "AI Cores": 0, "Real Estate": 0,
  });
});

// In a small warehouse only the material with the best factor per unit of space is worth it.
test("optimalBoostAmounts spends a small space on Real Estate alone for Agriculture", () => {
  assert.deepEqual(optimalBoostAmounts(AGRI_FACTORS, BOOST_SIZES, 100), {
    Hardware: 0, Robots: 0, "AI Cores": 0, "Real Estate": 20000,
  });
});

test("optimalBoostAmounts never buys a material the industry doesn't use", () => {
  assert.deepEqual(optimalBoostAmounts({ Hardware: 0.5 }, BOOST_SIZES, 6), {
    Hardware: 100, Robots: 0, "AI Cores": 0, "Real Estate": 0,
  });
});

// At the optimum every material bought adds the same production per unit of space:
// d/dx [c·ln(1 + 0.002x)] / s = 0.002c / ((1 + 0.002x)·s).
test("optimalBoostAmounts fills the space with equal marginal value per unit of space", () => {
  const space = 10000;
  const amounts = optimalBoostAmounts(AGRI_FACTORS, BOOST_SIZES, space);
  const used = Object.entries(amounts).reduce((t, [name, x]) => t + x * BOOST_SIZES[name], 0);
  assert.ok(used <= space && used > space - 1, `used ${used} of ${space}`);

  const marginal = Object.keys(amounts).map(
    (name) => (0.002 * AGRI_FACTORS[name]) / ((1 + 0.002 * amounts[name]) * BOOST_SIZES[name]),
  );
  for (const m of marginal) assert.ok(Math.abs(m / marginal[0] - 1) < 0.01, `marginals ${marginal}`);
});

// ── planBoostPurchases ──────────────────────────────────────────────────────

const SIZES = { Hardware: 0.25, Robots: 0.5 };
const PRICES = { Hardware: 1000, Robots: 1000 };

function boost(over = {}) {
  return planBoostPurchases({
    targets: { Hardware: 500 },
    stored: {},
    sizes: SIZES,
    prices: PRICES,
    freeSpace: 1e6,
    budget: 1e12,
    ...over,
  });
}

test("planBoostPurchases buys the shortfall against the target", () => {
  assert.deepEqual(boost({ stored: { Hardware: 200 } }), [{ name: "Hardware", amount: 300 }]);
});

test("planBoostPurchases buys nothing once the target is met", () => {
  assert.deepEqual(boost({ stored: { Hardware: 500 } }), []);
});

test("planBoostPurchases treats a missing stock entry as zero", () => {
  assert.deepEqual(boost({ targets: { Robots: 50 } }), [{ name: "Robots", amount: 50 }]);
});

// Shortfall space is 400·0.25 + 400·0.5 = 300; half of it is free, so both halve.
test("planBoostPurchases scales every purchase down together when space is short", () => {
  assert.deepEqual(boost({ targets: { Hardware: 400, Robots: 400 }, freeSpace: 150 }), [
    { name: "Hardware", amount: 200 },
    { name: "Robots", amount: 200 },
  ]);
});

test("planBoostPurchases scales every purchase down together when money is short", () => {
  assert.deepEqual(boost({ targets: { Hardware: 400, Robots: 400 }, budget: 200e3 }), [
    { name: "Hardware", amount: 100 },
    { name: "Robots", amount: 100 },
  ]);
});

test("planBoostPurchases buys nothing in a full warehouse or with no money", () => {
  assert.deepEqual(boost({ freeSpace: 0 }), []);
  assert.deepEqual(boost({ freeSpace: -5 }), []);
  assert.deepEqual(boost({ budget: -1e9 }), []);
});
