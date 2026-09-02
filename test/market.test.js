import { test } from "node:test";
import assert from "node:assert/strict";
import {
  fitSharesToBudget,
  momentumSignal,
  planMarketUnlocks,
  pushSample,
  rankByConviction,
  stockBudget,
  worthTrading,
} from "/src/lib/market.js";

// ── worthTrading ────────────────────────────────────────────────────────────
//
// This used to be shouldRealize(profit, minProfit), which held any position underwater by
// more than two commissions. That is backwards at scale: the 4S sell also requires
// forecast < 0.5, so the rule refused to exit exactly the stocks the game had just said
// would keep falling, and the `longShares === 0` buy gate then blocked topping the symbol
// back up. A live portfolio sat at 0.6% of market capacity with 15 of 15 positions locked.
//
// A bearish forecast is authoritative — it is the per-tick probability of an uptick, so
// holding below 0.5 is negative expected value. Direction is decided by the caller; all
// this rule does now is refuse to churn a position so small the fee is the whole trade.
// The argument is getSaleGain(), the net proceeds, not the profit.

test("worthTrading trades a position whose proceeds clear the round-trip fee", () => {
  assert.equal(worthTrading(500_000, 100_000), true);
});

test("worthTrading refuses a dust position the fee would dominate", () => {
  assert.equal(worthTrading(9_500, 100_000), false);
});

test("worthTrading trades a large position that is deeply underwater", () => {
  // The case that was frozen in the live game: a $9.32b WDS holding down $268m. Proceeds
  // dwarf the fee, so the loss is realised and the capital recycled.
  assert.equal(worthTrading(9_320_000_000, 100_000), true);
});

test("worthTrading holds at exactly the round-trip boundary", () => {
  assert.equal(worthTrading(200_000, 100_000), false);
});

// ── fitSharesToBudget ───────────────────────────────────────────────────────
//
// getPurchaseCost() prices in the spread AND the price impact of a large order;
// getAskPrice() prices in neither. stock-trader.js sized orders from askPrice and then
// checked them against getPurchaseCost, so a budget-bound order always came out over
// budget and was skipped in silence — no buy, no log line.
//
// It never bit while the only buys were opening positions from zero, because maxShares
// bound first. Topping positions up makes orders budget-bound, so every buy would fail.
// costOf is injected so the shrink loop is testable without the game.

test("fitSharesToBudget keeps an order that already fits", () => {
  const costOf = (shares) => shares * 100;
  assert.equal(fitSharesToBudget({ shares: 50, budget: 10_000, costOf }), 50);
});

test("fitSharesToBudget shrinks an order past the price impact of its own size", () => {
  // 10% impact: the order costs more per share than askPrice implied.
  const costOf = (shares) => shares * 110;
  const fitted = fitSharesToBudget({ shares: 100, budget: 10_000, costOf });
  assert.ok(fitted > 0, "should buy what fits rather than skipping the trade");
  assert.ok(costOf(fitted) <= 10_000, `cost ${costOf(fitted)} must fit the budget`);
});

test("fitSharesToBudget returns zero when even one share is unaffordable", () => {
  const costOf = (shares) => shares * 5_000 + 100_000;
  assert.equal(fitSharesToBudget({ shares: 10, budget: 1_000, costOf }), 0);
});

test("fitSharesToBudget returns zero for a non-positive order", () => {
  const costOf = (shares) => shares * 100;
  assert.equal(fitSharesToBudget({ shares: 0, budget: 10_000, costOf }), 0);
});

// ── stockBudget ─────────────────────────────────────────────────────────────
//
// The budget is recomputed every 6 s cycle, so a flat "spend 25% of cash" compounds:
// 0.75^N. Once positions could actually be topped up, a $9.12b balance modelled down to
// $514m in one minute and $29m in two — the trader would outbid every other manager simply
// by running more often. The old `longShares === 0` gate had been an accidental brake on
// this; nothing was behind it. The reserve is what makes the "keep cash liquid for
// servers/augs" intent already written into stock-trader.js actually hold.

test("stockBudget spends a share of the cash above the reserve", () => {
  assert.equal(stockBudget({ money: 9_000_000_000, reserve: 1_000_000_000, percent: 0.25 }), 2_000_000_000);
});

test("stockBudget stops buying once cash is down to the reserve", () => {
  assert.equal(stockBudget({ money: 1_000_000_000, reserve: 1_000_000_000, percent: 0.25 }), 0);
});

test("stockBudget never returns a negative budget below the reserve", () => {
  assert.equal(stockBudget({ money: 250_000_000, reserve: 1_000_000_000, percent: 0.25 }), 0);
});

test("stockBudget without a reserve spends a share of everything", () => {
  assert.equal(stockBudget({ money: 8_000_000_000, reserve: 0, percent: 0.25 }), 2_000_000_000);
});

// ── rankByConviction ────────────────────────────────────────────────────────
//
// Buys walk this order and stop when the budget runs out, so order decides where the money
// goes. Sorting by raw forecast puts every short candidate — which by definition has the
// LOWEST forecast — at the tail, where the budget never reaches. Distance from 0.5 is the
// actual strength of a signal in either direction.

test("rankByConviction puts the strongest signal first", () => {
  const forecasts = { A: 0.56, B: 0.72, C: 0.51 };
  assert.deepEqual(rankByConviction(["A", "B", "C"], (s) => forecasts[s]), ["B", "A", "C"]);
});

test("rankByConviction ranks a strong short alongside a strong long", () => {
  // 0.20 is as strong a short as 0.80 is a long; a raw descending sort would bury it last.
  const forecasts = { LONG: 0.62, SHORT: 0.2, WEAK: 0.53 };
  assert.deepEqual(rankByConviction(["LONG", "SHORT", "WEAK"], (s) => forecasts[s]), ["SHORT", "LONG", "WEAK"]);
});

test("rankByConviction leaves the caller's array untouched", () => {
  const symbols = ["A", "B"];
  rankByConviction(symbols, (s) => (s === "A" ? 0.5 : 0.9));
  assert.deepEqual(symbols, ["A", "B"]);
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
