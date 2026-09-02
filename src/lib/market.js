// Stock market logic that does not need the TIX API to run, so it can be unit-tested.
//
// See docs/API-COVERAGE-AUDIT.md §5.4. Two gaps live here: the trader could never buy its
// own market access, and its entire buy/sell body sat inside `if (use4S)`, so without 4S
// data it looped forever and traded nothing.

import { planPurchases } from "/src/lib/purchasing.js";

// Dependency order. The TIX API is unusable without the WSE account, and the 4S TIX
// integration is unusable without both 4S data and the API — so this is a ladder, not a
// shopping list: an unaffordable rung stops the climb instead of being skipped.
// Prices are read through accessors rather than by key lookup so the ladder stays checked
// against the real StockMarketConstants shape instead of a loose string index.
const UNLOCK_LADDER = [
  { name: "wse", label: "WSE account", price: (/** @type {MarketCosts} */ c) => c.WseAccountCost },
  { name: "tixApi", label: "TIX API", price: (/** @type {MarketCosts} */ c) => c.TixApiCost },
  { name: "fourS", label: "4S Market Data", price: (/** @type {MarketCosts} */ c) => c.MarketData4SCost },
  {
    name: "fourSTixApi",
    label: "4S Market Data TIX API",
    price: (/** @type {MarketCosts} */ c) => c.MarketDataTixApi4SCost,
  },
];

/**
 * @typedef {{WseAccountCost: number, TixApiCost: number,
 *   MarketData4SCost: number, MarketDataTixApi4SCost: number}} MarketCosts
 */

/**
 * Which market unlocks to buy, cheapest dependency first.
 *
 * @param {{has: Record<string, boolean>, costs: MarketCosts,
 *   money: number, reserveFraction?: number}} input
 *   `costs` is ns.stock.getConstants() — 0 GB, and it carries all four prices.
 * @returns {{buy: Array<{name: string, cost: number, label: string}>, spend: number}}
 */
export function planMarketUnlocks({ has, costs, money, reserveFraction = 0 }) {
  const items = UNLOCK_LADDER.filter((rung) => !has[rung.name]).map((rung) => ({
    name: rung.name,
    label: rung.label,
    cost: rung.price(costs),
  }));

  return planPurchases({ money, reserveFraction, items, stopOnUnaffordable: true });
}

/**
 * Is this position big enough to be worth a trade at all?
 *
 * Direction is the caller's decision — with 4S that is `forecast < 0.5`, which is the
 * per-tick probability of an uptick and therefore authoritative: holding below 0.5 is
 * negative expected value regardless of how far underwater the position already is.
 *
 * This was `shouldRealize(profit, minProfit)`, which held anything down by more than two
 * commissions. Paired with the sell's `forecast < 0.5` gate it refused to exit precisely
 * the stocks the game had just marked as still falling, and the old `longShares === 0`
 * buy gate then blocked topping that symbol back up — a one-way ratchet that left a live
 * portfolio at 0.6% of market capacity with every held position locked.
 *
 * All that survives of the old rule is its sound half: don't pay the fee twice to trade a
 * position the fee would dominate.
 *
 * @param {number} gain       ns.stock.getSaleGain() — net proceeds, not profit
 * @param {number} commission one commission; the round trip costs two
 */
export function worthTrading(gain, commission) {
  return gain > commission * 2;
}

/**
 * Largest share count whose real purchase cost fits inside `budget`.
 *
 * ns.stock.getAskPrice() prices in neither the spread nor the price impact a large order
 * has on itself; ns.stock.getPurchaseCost() prices in both. stock-trader.js sized orders
 * from the first and checked them against the second, so any order big enough to move the
 * price came out over budget and was dropped in silence — no purchase, no log line.
 *
 * That stayed invisible while the only buys opened positions from zero, because maxShares
 * bound long before the budget did. Topping positions up makes orders budget-bound, which
 * would turn a silent skip into the normal outcome of every buy.
 *
 * Shrinking by the overshoot ratio converges in one step for a linear impact model and is
 * capped anyway, so a pathological cost curve gives up rather than spinning.
 *
 * @param {{shares: number, budget: number, costOf: (shares: number) => number,
 *   attempts?: number}} input `costOf` is injected so this is testable without the game.
 * @returns {number} shares to buy, or 0 if nothing fits
 */
export function fitSharesToBudget({ shares, budget, costOf, attempts = 4 }) {
  let candidate = Math.floor(shares);
  if (!(candidate > 0) || !(budget > 0)) return 0;

  for (let i = 0; i < attempts; i++) {
    const cost = costOf(candidate);
    if (!(cost > 0)) return 0;
    if (cost <= budget) return candidate;

    // Trim slightly past the overshoot so a linear impact curve lands under the budget
    // instead of exactly on the boundary that just failed.
    const next = Math.floor(candidate * (budget / cost) * 0.99);
    if (next <= 0 || next >= candidate) return 0;
    candidate = next;
  }

  return 0;
}

/**
 * How much the trader may spend this cycle.
 *
 * The budget is recomputed every 6 s, so a flat percentage of cash compounds: spending 25%
 * per cycle leaves 0.75^N, which took a modelled $9.12b balance to $514m in a minute and
 * $29m in two. The trader would win every contest for cash against hacknet/server/aug
 * buyers purely by polling more often.
 *
 * Nothing used to stop that because the old `longShares === 0` buy gate meant most cycles
 * bought nothing at all — an accidental brake, removed along with the freeze it caused.
 * The reserve is the deliberate replacement, and it is what makes the "cash meant to stay
 * liquid for servers/augs" intent already stated in stock-trader.js true.
 *
 * @param {{money: number, reserve: number, percent: number}} input
 * @returns {number} spendable this cycle, never negative
 */
export function stockBudget({ money, reserve, percent }) {
  return Math.max(0, money - reserve) * percent;
}

/**
 * Symbols ordered by how strong their signal is, in either direction.
 *
 * Buys walk this order and stop once the budget is gone, so it decides where the money
 * lands. A raw descending sort on forecast ranks by bullishness rather than by strength,
 * which puts every short candidate — lowest forecast by definition — at the tail, past the
 * point the budget ever reaches. Distance from 0.5 treats a 0.20 short as the equal of a
 * 0.80 long, which is what they are.
 *
 * @param {string[]} symbols
 * @param {(sym: string) => number} forecastOf
 * @returns {string[]} a new array; the input is not mutated
 */
export function rankByConviction(symbols, forecastOf) {
  return [...symbols].sort((a, b) => Math.abs(forecastOf(b) - 0.5) - Math.abs(forecastOf(a) - 0.5));
}

/**
 * Append a price sample to a bounded history.
 *
 * The trader runs every 6 s across ~30 symbols and is never restarted on its own, so the
 * window has to be capped or the history grows without limit for the whole run.
 *
 * @param {number[] | undefined} samples
 * @param {number} price
 * @param {number} windowSize
 */
export function pushSample(samples, price, windowSize) {
  const next = [...(samples ?? []), price];
  return next.length > windowSize ? next.slice(next.length - windowSize) : next;
}

/**
 * Direction of travel for a symbol, from observed prices alone.
 *
 * This is the fallback for runs without 4S data, where no forecast exists. It is
 * deliberately conservative: without a forecast every position pays commission twice, so
 * a signal only fires on movement large enough to clear that, and never on a window too
 * short to mean anything — which is exactly the state the trader is in for its first
 * cycles after a restart.
 *
 * @param {number[]} samples  oldest → newest
 * @param {{minSamples?: number, buyThreshold?: number, sellThreshold?: number}} opts
 * @returns {"buy" | "sell" | null}
 */
export function momentumSignal(samples, { minSamples = 10, buyThreshold = 0.05, sellThreshold = 0.05 } = {}) {
  if (!samples || samples.length < minSamples) return null;

  const first = samples[0];
  const last = samples[samples.length - 1];
  if (!(first > 0)) return null;

  const change = (last - first) / first;
  if (change >= buyThreshold) return "buy";
  if (change <= -sellThreshold) return "sell";
  return null;
}
