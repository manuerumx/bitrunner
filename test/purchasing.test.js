import { test } from "node:test";
import assert from "node:assert/strict";
import { planPurchases, spendableMoney } from "/src/lib/purchasing.js";

// ── spendableMoney ──────────────────────────────────────────────────────────

// Every buyer in the suite competes for the same wallet as server-buyer.js and
// augmentation-buyer.js, so each one spends against a fraction and leaves the rest.
test("spendableMoney holds back the reserve fraction", () => {
  assert.equal(spendableMoney(1000, 0.25), 750);
});

test("spendableMoney with no reserve spends everything", () => {
  assert.equal(spendableMoney(1000, 0), 1000);
});

test("spendableMoney never returns a negative budget", () => {
  assert.equal(spendableMoney(-500, 0.25), 0);
});

test("spendableMoney with a full reserve spends nothing", () => {
  assert.equal(spendableMoney(1000, 1), 0);
});

// ── planPurchases ───────────────────────────────────────────────────────────

test("planPurchases buys affordable items in order and reports the spend", () => {
  const plan = planPurchases({
    money: 1000,
    items: [
      { name: "a", cost: 400 },
      { name: "b", cost: 300 },
    ],
  });
  assert.deepEqual(plan.buy.map((i) => i.name), ["a", "b"]);
  assert.equal(plan.spend, 700);
});

// The budget has to shrink as the plan is built. Checking each item against the full
// wallet is how a buyer commits to more than it can pay for — the bug the stock trader
// already fixed for its per-cycle budget (stock-trader.js:88-91).
test("planPurchases decrements the budget as it commits to each item", () => {
  const plan = planPurchases({
    money: 1000,
    items: [
      { name: "a", cost: 600 },
      { name: "b", cost: 600 },
    ],
  });
  assert.deepEqual(plan.buy.map((i) => i.name), ["a"]);
  assert.equal(plan.spend, 600);
});

test("planPurchases spends only what the reserve leaves", () => {
  const plan = planPurchases({
    money: 1000,
    reserveFraction: 0.5,
    items: [{ name: "a", cost: 600 }],
  });
  assert.deepEqual(plan.buy, []);
  assert.equal(plan.spend, 0);
});

// Default (cheapest-first shopping): one item being out of reach says nothing about
// the next. Port openers are bought this way — a partial set still opens ports.
test("planPurchases skips an unaffordable item and keeps buying cheaper ones", () => {
  const plan = planPurchases({
    money: 500,
    items: [
      { name: "expensive", cost: 900 },
      { name: "cheap", cost: 100 },
    ],
  });
  assert.deepEqual(plan.buy.map((i) => i.name), ["cheap"]);
});

// Ladder mode: the market unlocks are a dependency chain — the TIX API is worthless
// without the WSE account, so skipping ahead buys something unusable.
test("planPurchases in ladder mode stops at the first unaffordable item", () => {
  const plan = planPurchases({
    money: 500,
    stopOnUnaffordable: true,
    items: [
      { name: "wse", cost: 900 },
      { name: "tix", cost: 100 },
    ],
  });
  assert.deepEqual(plan.buy, []);
});

test("planPurchases in ladder mode buys the prefix it can afford", () => {
  const plan = planPurchases({
    money: 500,
    stopOnUnaffordable: true,
    items: [
      { name: "wse", cost: 100 },
      { name: "tix", cost: 900 },
      { name: "4s", cost: 50 },
    ],
  });
  assert.deepEqual(plan.buy.map((i) => i.name), ["wse"]);
});

test("planPurchases buys a free item", () => {
  const plan = planPurchases({ money: 0, items: [{ name: "free", cost: 0 }] });
  assert.deepEqual(plan.buy.map((i) => i.name), ["free"]);
});

test("planPurchases with no items buys nothing", () => {
  assert.deepEqual(planPurchases({ money: 1000, items: [] }), { buy: [], spend: 0 });
});

// ns cost getters return -1 for "unavailable" (e.g. getDarkwebProgramCost before TOR).
// Treating that as a bargain would spend the budget on nothing.
test("planPurchases ignores items with an unavailable (negative) cost", () => {
  const plan = planPurchases({ money: 1000, items: [{ name: "locked", cost: -1 }] });
  assert.deepEqual(plan.buy, []);
});
