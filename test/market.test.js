import { test } from "node:test";
import assert from "node:assert/strict";
import {
  activeCashRequest,
  entrySide,
  estimateForecast,
  estimateVolatility,
  exitSide,
  expectedReturn,
  fitSharesToBudget,
  momentumSignal,
  parseStockHistory,
  portfolioStats,
  positionSlice,
  planMarketUnlocks,
  pickRotation,
  planLiquidation,
  positionRoom,
  pushSample,
  rankByConviction,
  rankByExpectedReturn,
  shareHeadroom,
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

// ── positionSlice ───────────────────────────────────────────────────────────
//
// The bug this exists to prevent: the 4S buy loop sized every order against the whole
// remaining budget, so the first symbol on the ranked list spent all of it and the loop
// broke on the next iteration. One symbol funded per cycle — and because 4S forecasts
// drift slowly, the same symbol every cycle. A live portfolio ended up 100% in FLCM, the
// single strongest forecast on the board, while 15 other bullish symbols never got a
// dollar. stock-trader.js:110-114 had already stated the opposite intent ("the full 25%
// isn't sized against EACH strong-forecast symbol"); nothing implemented it.
//
// The momentum path had the rule right the whole time, so this is its shape, shared.

test("positionSlice caps one symbol at its share of the cycle budget", () => {
  assert.equal(positionSlice({ remaining: 1_000_000, cycleBudget: 1_000_000, fraction: 0.2 }), 200_000);
});

test("positionSlice leaves budget for the rest of the ranked list", () => {
  // Five symbols at 20% each, which is the whole point: rank #1 no longer starves rank #2.
  let remaining = 1_000_000;
  const spent = [];
  for (let i = 0; i < 5; i++) {
    const slice = positionSlice({ remaining, cycleBudget: 1_000_000, fraction: 0.2 });
    spent.push(slice);
    remaining -= slice;
  }
  assert.deepEqual(spent, [200_000, 200_000, 200_000, 200_000, 200_000]);
  assert.equal(remaining, 0);
});

test("positionSlice never exceeds what is actually left", () => {
  // Late in the cycle the cap is no longer the binding constraint; the cash is.
  assert.equal(positionSlice({ remaining: 50_000, cycleBudget: 1_000_000, fraction: 0.2 }), 50_000);
});

test("positionSlice with a full fraction hands over the whole remainder", () => {
  assert.equal(positionSlice({ remaining: 800_000, cycleBudget: 1_000_000, fraction: 1 }), 800_000);
});

test("positionSlice never returns a negative slice", () => {
  assert.equal(positionSlice({ remaining: -5, cycleBudget: 1_000_000, fraction: 0.2 }), 0);
});

// ── portfolioStats ──────────────────────────────────────────────────────────
//
// stock-report.js measured the portfolio against total market capacity and concluded
// "the trader is under-investing" from a 0.6% fill. But a $33.77b net worth in a $5.36t
// market cannot exceed 0.63% fill by definition — the trader was at 95% of its ceiling and
// the report read that as a failure. That false verdict is what motivated removing the
// buy gate in 8657540, which produced the single-symbol concentration above.
//
// Capital is the binding constraint, not market capacity, so `deployed` measures against
// money the player can actually invest. `concentration` is the number that was missing:
// it is 100% in the run that prompted this, and nothing on the old report showed it.

test("portfolioStats measures deployment against investable capital, not the market", () => {
  // The live figures: $30.69b held, $3.08b cash, $1b reserve.
  const stats = portfolioStats({
    positions: [{ sym: "FLCM", value: 30.69e9 }],
    cash: 3.08e9,
    reserve: 1e9,
  });
  assert.equal(stats.held, 30.69e9);
  assert.equal(stats.investable, 30.69e9 + 2.08e9);
  assert.ok(Math.abs(stats.deployed - 0.937) < 0.001, `deployed was ${stats.deployed}`);
});

test("portfolioStats reports concentration in the largest position", () => {
  const stats = portfolioStats({
    positions: [{ sym: "FLCM", value: 30.69e9 }],
    cash: 3.08e9,
    reserve: 1e9,
  });
  assert.equal(stats.concentration, 1);
  assert.equal(stats.topSymbol, "FLCM");
});

test("portfolioStats sees a spread portfolio as unconcentrated", () => {
  const stats = portfolioStats({
    positions: [
      { sym: "A", value: 25 },
      { sym: "B", value: 25 },
      { sym: "C", value: 25 },
      { sym: "D", value: 25 },
    ],
    cash: 0,
    reserve: 0,
  });
  assert.equal(stats.concentration, 0.25);
  assert.equal(stats.deployed, 1);
});

test("portfolioStats treats an empty portfolio as fully undeployed", () => {
  const stats = portfolioStats({ positions: [], cash: 5e9, reserve: 1e9 });
  assert.equal(stats.held, 0);
  assert.equal(stats.deployed, 0);
  assert.equal(stats.concentration, 0);
  assert.equal(stats.topSymbol, null);
});

test("portfolioStats ignores cash below the reserve as uninvestable", () => {
  // Cash under the reserve is not capital the trader may spend, so counting it would
  // report the trader as under-deployed for money it is forbidden to touch.
  const stats = portfolioStats({ positions: [{ sym: "A", value: 100 }], cash: 500, reserve: 900 });
  assert.equal(stats.investable, 100);
  assert.equal(stats.deployed, 1);
});

// ── long/short helpers (BitNode-8 trader) ───────────────────────────────────
//
// In BN8 the market is the only income, so the trader is fully invested on both sides and
// has to choose between a 0.62 long on a sleepy stock and a 0.40 short on a volatile one.
// Forecast alone can't rank those; expected move per tick (volatility × edge) can.

test("expectedReturn is positive for a bullish forecast and negative for a bearish one", () => {
  assert.ok(expectedReturn(0.6, 0.02) > 0);
  assert.ok(expectedReturn(0.4, 0.02) < 0);
  assert.equal(expectedReturn(0.5, 0.02), 0);
});

test("expectedReturn scales with volatility, so a volatile weak edge can beat a calm strong one", () => {
  // 0.58 at 4% volatility moves more per tick than 0.65 at 1%.
  assert.ok(Math.abs(expectedReturn(0.58, 0.04)) > Math.abs(expectedReturn(0.65, 0.01)));
});

test("entrySide goes long above the band, short below it, and stays out inside it", () => {
  assert.equal(entrySide(0.6, 0.05), "L");
  assert.equal(entrySide(0.4, 0.05), "S");
  assert.equal(entrySide(0.53, 0.05), null);
  assert.equal(entrySide(0.47, 0.05), null);
});

test("exitSide closes a long once the forecast turns bearish", () => {
  assert.equal(exitSide({ forecast: 0.48, longShares: 100, shortShares: 0 }), "L");
  assert.equal(exitSide({ forecast: 0.52, longShares: 100, shortShares: 0 }), null);
});

test("exitSide closes a short once the forecast turns bullish", () => {
  assert.equal(exitSide({ forecast: 0.52, longShares: 0, shortShares: 100 }), "S");
  assert.equal(exitSide({ forecast: 0.48, longShares: 0, shortShares: 100 }), null);
});

test("exitSide does nothing for a symbol with no position", () => {
  assert.equal(exitSide({ forecast: 0.1, longShares: 0, shortShares: 0 }), null);
  assert.equal(exitSide({ forecast: 0.9, longShares: 0, shortShares: 0 }), null);
});

test("shareHeadroom counts both sides against one cap", () => {
  // The game rejects a buy when shares + long + short exceeds maxShares.
  assert.equal(shareHeadroom({ maxShares: 1000, longShares: 300, shortShares: 0 }), 700);
  assert.equal(shareHeadroom({ maxShares: 1000, longShares: 0, shortShares: 1000 }), 0);
});

test("rankByExpectedReturn puts the biggest move first, long or short", () => {
  const ranked = rankByExpectedReturn([
    { sym: "CALM", forecast: 0.7, volatility: 0.005 },
    { sym: "BEAR", forecast: 0.35, volatility: 0.03 },
    { sym: "BULL", forecast: 0.6, volatility: 0.02 },
  ]);
  assert.deepEqual(ranked.map((c) => c.sym), ["BEAR", "BULL", "CALM"]);
});

test("rankByExpectedReturn does not mutate its input", () => {
  const input = [
    { sym: "A", forecast: 0.55, volatility: 0.01 },
    { sym: "B", forecast: 0.8, volatility: 0.01 },
  ];
  rankByExpectedReturn(input);
  assert.deepEqual(input.map((c) => c.sym), ["A", "B"]);
});

test("pickRotation sells the weakest holding when a candidate is clearly better", () => {
  const held = [
    { sym: "OK", er: 0.004 },
    { sym: "WEAK", er: 0.001 },
  ];
  assert.equal(pickRotation({ held, candidateEr: 0.005, factor: 2 })?.sym, "WEAK");
});

test("pickRotation keeps the portfolio when the candidate is not worth two commissions of churn", () => {
  const held = [{ sym: "WEAK", er: 0.003 }];
  assert.equal(pickRotation({ held, candidateEr: 0.005, factor: 2 }), null);
});

test("pickRotation compares magnitudes, so a short's negative return is not mistaken for weakness", () => {
  const held = [{ sym: "SHORT", er: -0.004 }];
  assert.equal(pickRotation({ held, candidateEr: 0.005, factor: 2 }), null);
  assert.equal(pickRotation({ held, candidateEr: -0.009, factor: 2 })?.sym, "SHORT");
});

test("pickRotation with nothing held has nothing to sell", () => {
  assert.equal(pickRotation({ held: [], candidateEr: 0.01, factor: 2 }), null);
});

// ── forecast estimation without 4S ──────────────────────────────────────────
//
// BN8 starts with the TIX API but not 4S, so there is no getForecast(). The forecast is
// the per-tick probability of an uptick, which makes the observed fraction of up-ticks
// over a window an unbiased estimate of it.

test("estimateForecast is the fraction of up-moves over the window", () => {
  // 3 ups, 1 down
  assert.equal(estimateForecast([10, 11, 12, 11, 12], 4), 0.75);
});

test("estimateForecast only looks at the last `window` moves", () => {
  // Early ups fall outside the window; the last 2 moves are both down.
  assert.equal(estimateForecast([1, 2, 3, 4, 3, 2], 2), 0);
});

test("estimateForecast ignores flat ticks rather than counting them as down", () => {
  assert.equal(estimateForecast([10, 10, 11, 11, 12], 4), 1);
});

test("estimateForecast returns null without enough history", () => {
  assert.equal(estimateForecast([10], 4), null);
  assert.equal(estimateForecast(undefined, 4), null);
  assert.equal(estimateForecast([10, 10, 10], 4), null);
});

test("estimateVolatility is the mean absolute relative move", () => {
  // +10%, -10%
  const v = estimateVolatility([100, 110, 99], 2);
  assert.ok(Math.abs(v - 0.1) < 1e-9);
});

test("estimateVolatility returns 0 without at least one move", () => {
  assert.equal(estimateVolatility([100], 5), 0);
});

test("exitSide closes a long early when the recent window flips hard", () => {
  // The long window still says bullish (it lags a cycle flip), but the recent window
  // has turned well past the flip margin.
  assert.equal(exitSide({ forecast: 0.56, recent: 0.3, flipMargin: 0.1, longShares: 10, shortShares: 0 }), "L");
  assert.equal(exitSide({ forecast: 0.56, recent: 0.45, flipMargin: 0.1, longShares: 10, shortShares: 0 }), null);
});

test("exitSide closes a short early when the recent window flips hard", () => {
  assert.equal(exitSide({ forecast: 0.44, recent: 0.7, flipMargin: 0.1, longShares: 0, shortShares: 10 }), "S");
  assert.equal(exitSide({ forecast: 0.44, recent: 0.55, flipMargin: 0.1, longShares: 0, shortShares: 10 }), null);
});

// ── positionRoom ────────────────────────────────────────────────────────────
//
// Uncapped, the BN8 trader put 100% of a $240m bankroll into a single short — the top of
// the ranking — so one wrong estimate was the whole portfolio. The cap is a share of net
// worth, not of cash: cash is ~0 once fully invested, which would freeze every top-up.

test("positionRoom lets a new position take up to its share of net worth", () => {
  assert.equal(positionRoom({ netWorth: 1000, fraction: 0.25, held: 0, cash: 1000 }), 250);
});

test("positionRoom only tops up what is left under the cap", () => {
  assert.equal(positionRoom({ netWorth: 1000, fraction: 0.25, held: 200, cash: 1000 }), 50);
});

test("positionRoom is zero for a position already at or over the cap", () => {
  assert.equal(positionRoom({ netWorth: 1000, fraction: 0.25, held: 300, cash: 1000 }), 0);
});

test("positionRoom never exceeds the cash on hand", () => {
  assert.equal(positionRoom({ netWorth: 1000, fraction: 0.25, held: 0, cash: 40 }), 40);
});

// ── parseStockHistory ───────────────────────────────────────────────────────
//
// Without 4S the BN8 trader needs ~31 ticks of prices per symbol before it trades, so every
// restart left the bankroll idle for 3 minutes ($198m in the run that prompted this). The
// history is saved each tick and restored on start — but only while it is fresh: the ticks
// missed while stopped collapse into one move, and a stale window can straddle a flip.

const MIN = 60_000;
const saved = (savedAt, history) => JSON.stringify({ savedAt, history });

test("parseStockHistory restores a fresh save", () => {
  const raw = saved(1000, { ECP: [1, 2, 3], FSIG: [5, 4] });
  assert.deepEqual(parseStockHistory(raw, { now: 1000 + MIN, maxAgeMs: 2 * MIN, windowSize: 10 }), {
    ECP: [1, 2, 3],
    FSIG: [5, 4],
  });
});

test("parseStockHistory discards a save older than maxAgeMs", () => {
  const raw = saved(1000, { ECP: [1, 2, 3] });
  assert.deepEqual(parseStockHistory(raw, { now: 1000 + 3 * MIN, maxAgeMs: 2 * MIN, windowSize: 10 }), {});
});

test("parseStockHistory trims each symbol to the window", () => {
  const raw = saved(0, { ECP: [1, 2, 3, 4, 5] });
  assert.deepEqual(parseStockHistory(raw, { now: 0, maxAgeMs: MIN, windowSize: 3 }), { ECP: [3, 4, 5] });
});

test("parseStockHistory drops symbols whose samples are not all positive numbers", () => {
  const raw = saved(0, { ECP: [1, "x", 3], FSIG: [1, -2], OK: [2, 3] });
  assert.deepEqual(parseStockHistory(raw, { now: 0, maxAgeMs: MIN, windowSize: 10 }), { OK: [2, 3] });
});

test("parseStockHistory returns empty for a missing or corrupt file", () => {
  const opts = { now: 0, maxAgeMs: MIN, windowSize: 10 };
  assert.deepEqual(parseStockHistory("", opts), {});
  assert.deepEqual(parseStockHistory("{not json", opts), {});
  assert.deepEqual(parseStockHistory(JSON.stringify({ history: { ECP: [1, 2] } }), opts), {});
  assert.deepEqual(parseStockHistory(JSON.stringify([1, 2]), opts), {});
});

test("parseStockHistory rejects a save from the future", () => {
  // A clock that went backwards (or a hand-edited file) must not count as fresh forever.
  const raw = saved(10 * MIN, { ECP: [1, 2] });
  assert.deepEqual(parseStockHistory(raw, { now: 0, maxAgeMs: MIN, windowSize: 10 }), {});
});

// ── cash requests (grafting ↔ BN8 trader) ───────────────────────────────────
//
// The BN8 trader stays fully invested, so the grafting queue would never see enough cash.
// The queue posts a request; the trader holds that much back and sells to cover it. The
// request is a heartbeat: a grafting script that died must not freeze capital forever.

test("activeCashRequest honours a fresh request", () => {
  assert.equal(activeCashRequest({ requester: "graft", amount: 5e9, updatedAt: 1000 }, { now: 11_000, maxAgeMs: 30_000 }), 5e9);
});

test("activeCashRequest ignores a stale request", () => {
  assert.equal(activeCashRequest({ requester: "graft", amount: 5e9, updatedAt: 1000 }, { now: 60_000, maxAgeMs: 30_000 }), 0);
});

test("activeCashRequest ignores a missing or malformed request", () => {
  const opts = { now: 0, maxAgeMs: 30_000 };
  assert.equal(activeCashRequest(null, opts), 0);
  assert.equal(activeCashRequest({ amount: "lots", updatedAt: 0 }, opts), 0);
  assert.equal(activeCashRequest({ amount: -5, updatedAt: 0 }, opts), 0);
});

test("planLiquidation sells the weakest holdings first", () => {
  const plan = planLiquidation({
    held: [
      { sym: "STRONG", er: 0.004, value: 100 },
      { sym: "WEAK", er: 0.001, value: 100 },
    ],
    need: 100,
  });
  assert.deepEqual(plan, [{ sym: "WEAK", fraction: 1 }]);
});

test("planLiquidation sells only part of the last holding it needs", () => {
  const plan = planLiquidation({
    held: [
      { sym: "A", er: 0.001, value: 100 },
      { sym: "B", er: 0.002, value: 200 },
    ],
    need: 150,
  });
  assert.deepEqual(plan, [
    { sym: "A", fraction: 1 },
    { sym: "B", fraction: 0.25 },
  ]);
});

test("planLiquidation treats a short's negative return by magnitude", () => {
  const plan = planLiquidation({
    held: [
      { sym: "SHORT", er: -0.005, value: 100 },
      { sym: "LONG", er: 0.001, value: 100 },
    ],
    need: 50,
  });
  assert.deepEqual(plan, [{ sym: "LONG", fraction: 0.5 }]);
});

test("planLiquidation sells everything when the need exceeds the portfolio", () => {
  const plan = planLiquidation({ held: [{ sym: "A", er: 0.001, value: 100 }], need: 500 });
  assert.deepEqual(plan, [{ sym: "A", fraction: 1 }]);
});

test("planLiquidation sells nothing when nothing is needed", () => {
  assert.deepEqual(planLiquidation({ held: [{ sym: "A", er: 0.001, value: 100 }], need: 0 }), []);
});
