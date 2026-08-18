import { test } from "node:test";
import assert from "node:assert/strict";
import { momentumSignal, planMarketUnlocks, pushSample, shouldRealize } from "/src/lib/market.js";

// ── shouldRealize ───────────────────────────────────────────────────────────
//
// Selling costs commission a second time, so dumping a position that is barely underwater
// guarantees the loss. The 4S path has always gated on this; the momentum path did not,
// which meant the fallback trader had a strictly worse loss policy than the primary one —
// three lines apart in the same file.

test("shouldRealize sells a profitable position", () => {
  assert.equal(shouldRealize(500_000, 200_000), true);
});

test("shouldRealize sells through a loss smaller than the commission round-trip", () => {
  assert.equal(shouldRealize(-100_000, 200_000), true);
});

test("shouldRealize holds a loss bigger than the commission round-trip", () => {
  assert.equal(shouldRealize(-300_000, 200_000), false);
});

test("shouldRealize holds at exactly the tolerance boundary", () => {
  assert.equal(shouldRealize(-200_000, 200_000), false);
});

// ── momentumSignal ──────────────────────────────────────────────────────────

// Without 4S there is no forecast, so direction has to come from observed price history.
// stock-trader.js keeps no history at all today — it reads prices fresh each cycle — so
// the first cycles after a restart have almost no samples. Refusing to trade on a short
// window is the behaviour that keeps a restart from opening blind positions.
test("momentumSignal gives no signal below the minimum sample count", () => {
  const samples = [1, 2, 3, 4, 5, 6, 7, 8, 9];
  assert.equal(momentumSignal(samples, { minSamples: 10 }), null);
});

test("momentumSignal gives no signal for an empty history", () => {
  assert.equal(momentumSignal([], { minSamples: 3 }), null);
});

test("momentumSignal buys a rise past the buy threshold", () => {
  const samples = [100, 102, 105, 108, 110];
  assert.equal(momentumSignal(samples, { minSamples: 3, buyThreshold: 0.05 }), "buy");
});

test("momentumSignal sells a fall past the sell threshold", () => {
  const samples = [110, 108, 105, 102, 100];
  assert.equal(momentumSignal(samples, { minSamples: 3, sellThreshold: 0.05 }), "sell");
});

test("momentumSignal gives no signal for a flat price", () => {
  const samples = [100, 100, 100, 100];
  assert.equal(momentumSignal(samples, { minSamples: 3, buyThreshold: 0.05 }), null);
});

// Noise below the threshold must not trade: without 4S every trade pays commission
// twice, so a 1% drift is a guaranteed loss.
test("momentumSignal gives no signal for movement inside the threshold", () => {
  const samples = [100, 100.5, 101];
  assert.equal(momentumSignal(samples, { minSamples: 3, buyThreshold: 0.05 }), null);
});

test("momentumSignal gives no signal when the opening price is zero", () => {
  assert.equal(momentumSignal([0, 0, 50], { minSamples: 3, buyThreshold: 0.05 }), null);
});

// ── pushSample ──────────────────────────────────────────────────────────────

test("pushSample appends to the history", () => {
  assert.deepEqual(pushSample([1, 2], 3, 5), [1, 2, 3]);
});

// The trader runs every 6s across ~30 symbols and never restarts on its own, so an
// unbounded history is a slow memory leak.
test("pushSample drops the oldest sample past the window size", () => {
  assert.deepEqual(pushSample([1, 2, 3], 4, 3), [2, 3, 4]);
});

test("pushSample starts a history from nothing", () => {
  assert.deepEqual(pushSample(undefined, 7, 3), [7]);
});

// ── planMarketUnlocks ───────────────────────────────────────────────────────

const COSTS = {
  WseAccountCost: 200e6,
  TixApiCost: 5e9,
  MarketData4SCost: 1e9,
  MarketDataTixApi4SCost: 25e9,
};

test("planMarketUnlocks buys the whole ladder in dependency order", () => {
  const plan = planMarketUnlocks({
    has: { wse: false, tixApi: false, fourS: false, fourSTixApi: false },
    costs: COSTS,
    money: 1e12,
  });
  assert.deepEqual(plan.buy.map((i) => i.name), ["wse", "tixApi", "fourS", "fourSTixApi"]);
});

test("planMarketUnlocks skips what is already owned", () => {
  const plan = planMarketUnlocks({
    has: { wse: true, tixApi: true, fourS: false, fourSTixApi: false },
    costs: COSTS,
    money: 1e12,
  });
  assert.deepEqual(plan.buy.map((i) => i.name), ["fourS", "fourSTixApi"]);
});

test("planMarketUnlocks buys nothing when everything is owned", () => {
  const plan = planMarketUnlocks({
    has: { wse: true, tixApi: true, fourS: true, fourSTixApi: true },
    costs: COSTS,
    money: 1e12,
  });
  assert.deepEqual(plan.buy, []);
});

// The unlocks are a dependency chain, so an unaffordable rung stops the climb rather
// than skipping to a cheaper one that cannot be used yet.
test("planMarketUnlocks stops at the first rung it cannot afford", () => {
  const plan = planMarketUnlocks({
    has: { wse: false, tixApi: false, fourS: false, fourSTixApi: false },
    costs: COSTS,
    money: 300e6,
  });
  assert.deepEqual(plan.buy.map((i) => i.name), ["wse"]);
});

// 4S TIX is the $25b item; without a reserve it would drain the wallet that
// server-buyer.js and augmentation-buyer.js are also spending from.
test("planMarketUnlocks honours the reserve fraction", () => {
  const plan = planMarketUnlocks({
    has: { wse: false, tixApi: false, fourS: false, fourSTixApi: false },
    costs: COSTS,
    money: 300e6,
    reserveFraction: 0.5,
  });
  assert.deepEqual(plan.buy, []);
});
