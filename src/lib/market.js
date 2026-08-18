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
 * Should a position be closed at this profit, or held?
 *
 * Selling pays commission a second time, so closing a position that is only slightly
 * underwater locks in a loss the round-trip fee alone would have caused. `minProfit` is
 * conventionally two commissions.
 *
 * Both trading paths share this rule. They previously didn't: the 4S path gated on it and
 * the momentum fallback didn't, so the blind trader had the *worse* loss policy of the two.
 *
 * @param {number} profit    realised profit if sold now (negative = underwater)
 * @param {number} minProfit loss tolerance, normally 2 × commission
 */
export function shouldRealize(profit, minProfit) {
  return profit > -minProfit;
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
