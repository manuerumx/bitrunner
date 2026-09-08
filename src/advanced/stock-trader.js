import { DEFAULTS } from "/src/lib/constants.js";
import {
  FORECAST_BUY_THRESHOLD,
  FORECAST_SELL_THRESHOLD,
  POSITION_BUDGET_FRACTION,
  fitSharesToBudget,
  momentumSignal,
  positionSlice,
  pushSample,
  rankByConviction,
  stockBudget,
  worthOpening,
  worthTrading,
} from "/src/lib/market.js";
import { log, formatMoney } from "/src/lib/utils.js";

// ns.stock.getConstants() is 0 GB and reports the real commission, so it no longer has to
// be hardcoded. Read once at startup — it is a game constant, not a live figure.
let COMMISSION = 100000;

// Fallback trading, used only when 4S market data isn't owned. Without a forecast the
// only signal is observed price history, so the bar is deliberately higher: a position
// pays commission twice, and there is no forecast to say when to get out.
const MOMENTUM_WINDOW = 20; // samples kept per symbol (~2 min at the 6 s cycle)
const MOMENTUM_MIN_SAMPLES = 12;
const MOMENTUM_BUY_THRESHOLD = 0.04;
const MOMENTUM_SELL_THRESHOLD = 0.02;

function hasTIX(ns) {
  try {
    ns.stock.getSymbols();
    return true;
  } catch {
    return false;
  }
}

function hasShortAccess(ns) {
  try {
    const [, , shortShares] = ns.stock.getPosition("ECP");
    return true;
  } catch {
    return false;
  }
}

function getPortfolio(ns) {
  const symbols = ns.stock.getSymbols();
  let totalValue = 0;
  let totalProfit = 0;
  const positions = [];

  for (const sym of symbols) {
    const [longShares, longAvg, shortShares, shortAvg] = ns.stock.getPosition(sym);

    if (longShares > 0) {
      const price = ns.stock.getBidPrice(sym);
      const value = longShares * price;
      const cost = longShares * longAvg;
      totalValue += value;
      totalProfit += value - cost - COMMISSION;
      positions.push({ sym, shares: longShares, avg: longAvg, type: "long", value });
    }

    if (shortShares > 0) {
      const price = ns.stock.getAskPrice(sym);
      const marketValue = shortShares * price;
      const profit = shortShares * (shortAvg - price);
      totalValue += marketValue;
      totalProfit += profit - COMMISSION;
      positions.push({ sym, shares: shortShares, avg: shortAvg, type: "short", value: marketValue });
    }
  }

  return { positions, totalValue, totalProfit };
}

/** @param {NS} ns */
export async function main(ns) {
  ns.disableLog("ALL");

  if (!hasTIX(ns)) {
    ns.print("ERROR: TIX API access required. Purchase from World Stock Exchange.");
    return;
  }

  // getForecast() is gated on the 4S Market Data TIX *API*, not on 4S Market Data — those are
  // two separate purchases and the API is by far the dearer one, so owning the data alone is an
  // ordinary mid-game state. has4SData() therefore reads true while getForecast() still throws
  // "You don't have 4S Market Data TIX API Access!", and the whole `if (use4S)` body below is
  // built on getForecast. Gate on the rung the API actually checks.
  const use4S = ns.stock.has4SDataTixApi();
  let useShorts = hasShortAccess(ns);

  const constants = ns.stock.getConstants();
  COMMISSION = constants.StockMarketCommission;

  if (!use4S) {
    // Name the rung that's actually missing. "No 4S Market Data" is misleading to a player who
    // just bought exactly that and is wondering why nothing changed.
    ns.tprint(ns.stock.has4SData()
      ? "WARN: 4S Market Data is owned, but the 4S TIX API is not — forecasts show in the UI and stay unreadable from scripts."
      : "WARN: No 4S Market Data.");
    ns.tprint("      Trading on price momentum only. Buy the missing access with:");
    ns.tprint("      run /src/tools/market-access.js");
  }

  // Per-symbol price history for the non-4S path. Bounded by pushSample so it can't grow
  // for the whole run.
  /** @type {Record<string, number[]>} */
  const history = {};

  log(ns, `Stock Trader started (4S: ${use4S}, Shorts: ${useShorts}, commission ${formatMoney(COMMISSION)})`);

  while (true) {
    const symbols = ns.stock.getSymbols();
    const money = ns.getPlayer().money;
    // Per-cycle spend cap, decremented as positions open so the buy pass can't spend more
    // than 25% of the surplus in one cycle and drain cash meant to stay liquid for
    // servers/augs. positionSlice() then bounds what any ONE symbol takes out of it — the
    // decrement alone never did, because nothing stopped the first taker from emptying it.
    // stockBudget() holds the reserve back: this runs every 6 s, so an unfloored percentage
    // compounds and takes everything regardless of what the other managers are saving for.
    const cycleBudget = stockBudget({
      money,
      reserve: DEFAULTS.stockReservedCash,
      percent: DEFAULTS.stockBudgetPercent,
    });
    let remaining = cycleBudget;

    if (use4S) {
      // Sell everything that has turned before buying anything. That frees cash and share
      // headroom for the same cycle, and because the buy pass re-reads the position, a
      // symbol closed here can be re-opened immediately instead of a cycle later —
      // previously both passes shared one stale getPosition() read from the top of the loop.
      /** @type {Map<string, number>} */
      const forecasts = new Map();

      for (const sym of symbols) {
        const forecast = ns.stock.getForecast(sym);
        forecasts.set(sym, forecast);
        const [longShares, longAvg, shortShares, shortAvg] = ns.stock.getPosition(sym);

        if (longShares > 0 && forecast < FORECAST_SELL_THRESHOLD) {
          const gain = ns.stock.getSaleGain(sym, longShares, "L");
          if (worthTrading(gain, COMMISSION) && ns.stock.sellStock(sym, longShares) > 0) {
            const profit = gain - longShares * longAvg;
            log(ns, `SELL LONG ${sym}: ${longShares} shares, profit ${formatMoney(profit)}`);
          }
        }

        if (useShorts && shortShares > 0 && forecast > FORECAST_SELL_THRESHOLD) {
          const gain = ns.stock.getSaleGain(sym, shortShares, "S");
          if (worthTrading(gain, COMMISSION) && ns.stock.sellShort(sym, shortShares) > 0) {
            const profit = gain - shortShares * shortAvg;
            log(ns, `SELL SHORT ${sym}: ${shortShares} shares, profit ${formatMoney(profit)}`);
          }
        }
      }

      // Strongest signal first, long or short. Order matters because the budget runs out
      // partway down the list: spending in getSymbols() order would let a merely-adequate
      // symbol outbid the best one purely by position in a fixed list, and a plain forecast
      // sort would bury every short, since a short candidate has the lowest forecast by
      // definition. Ranking decides who gets funded first; positionSlice decides how far
      // down the list the money reaches.
      const ranked = rankByConviction(symbols, (sym) => forecasts.get(sym) ?? 0.5);

      for (const sym of ranked) {
        // positionSlice() is bounded by `remaining`, which only ever shrinks, so once the
        // best slice on offer is too small to open a position worth the fee it is too
        // small for every symbol further down the ranking — break rather than continue.
        // This replaces a bare `remaining <= COMMISSION * 2` check, which only refused
        // orders that were literally unaffordable, not the merely uneconomic ones.
        // One slice per symbol: a symbol is either bullish enough to buy or bearish enough
        // to short, never both, so the two branches below cannot double-spend it.
        const slice = positionSlice({ remaining, cycleBudget, fraction: POSITION_BUDGET_FRACTION });
        if (!worthOpening(slice, COMMISSION, DEFAULTS.stockMinCommissionRatio)) break;

        const forecast = forecasts.get(sym) ?? 0;
        const maxShares = ns.stock.getMaxShares(sym);
        const [longShares, , shortShares] = ns.stock.getPosition(sym);

        // `longShares < maxShares` rather than `=== 0`: a position used to be sized once,
        // against whatever cash was on hand the cycle it opened, and never added to again.
        // A symbol bought while poor stayed that size for the rest of the run no matter how
        // far net worth grew — the portfolio sat at 0.6% of what the market would allow.
        if (forecast > FORECAST_BUY_THRESHOLD && longShares < maxShares) {
          const wanted = Math.min(
            maxShares - longShares,
            Math.floor((slice - COMMISSION) / ns.stock.getAskPrice(sym)),
          );
          const shares = fitSharesToBudget({
            shares: wanted,
            budget: slice,
            costOf: (n) => ns.stock.getPurchaseCost(sym, n, "L"),
          });
          const cost = shares > 0 ? ns.stock.getPurchaseCost(sym, shares, "L") : 0;
          // The slice check above bounds the best case; share granularity can leave the real
          // order far under it — FLCM at $202k/share fits only 2 shares in a $610k slice, so
          // the flat fee lands on $404k of stock rather than the $510k the slice allowed.
          // Gate the order actually being placed, not the budget it was sized against.
          if (shares > 0 && worthOpening(cost, COMMISSION, DEFAULTS.stockMinCommissionRatio)) {
            const price = ns.stock.buyStock(sym, shares);
            if (price > 0) {
              remaining -= cost;
              const verb = longShares > 0 ? "ADD LONG" : "BUY LONG";
              log(ns, `${verb} ${sym}: ${shares} shares @ ${formatMoney(price)} (forecast: ${(forecast * 100).toFixed(1)}%)`);
            }
          }
        }

        // Assumes maxShares caps each side independently. If the game instead caps
        // long + short combined, a symbol held on both sides would overshoot and buyShort
        // would reject the order — harmless (the buy just fails) and unreachable without
        // BitNode-8 / SF-8.2, but it is the assumption to revisit if shorts ever misbehave.
        if (useShorts && forecast < 1 - FORECAST_BUY_THRESHOLD && shortShares < maxShares) {
          const wanted = Math.min(
            maxShares - shortShares,
            Math.floor((slice - COMMISSION) / ns.stock.getBidPrice(sym)),
          );
          const shares = fitSharesToBudget({
            shares: wanted,
            budget: slice,
            costOf: (n) => ns.stock.getPurchaseCost(sym, n, "S"),
          });
          const cost = shares > 0 ? ns.stock.getPurchaseCost(sym, shares, "S") : 0;
          // Same entry gate as the long branch: a short pays the fee on the way in too.
          if (shares > 0 && worthOpening(cost, COMMISSION, DEFAULTS.stockMinCommissionRatio)) {
            try {
              const price = ns.stock.buyShort(sym, shares);
              if (price > 0) {
                remaining -= cost;
                const verb = shortShares > 0 ? "ADD SHORT" : "BUY SHORT";
                log(ns, `${verb} ${sym}: ${shares} shares @ ${formatMoney(price)} (forecast: ${(forecast * 100).toFixed(1)}%)`);
              }
            } catch {
              // Shorting needs BitNode-8 or SF-8 lvl 2. hasShortAccess() can't detect this
              // (getPosition works with plain TIX), so disable shorts on the first rejection.
              useShorts = false;
              log(ns, "Short selling unavailable (needs BitNode-8 / SF-8.2) — disabling shorts");
            }
          }
        }
      }
    } else {
      // No 4S data: trade observed momentum instead. Every buy/sell in this manager used
      // to sit inside the `if (use4S)` above, so without 4S the loop ran forever and
      // never traded — it read prices, decided nothing, and slept.
      for (const sym of symbols) {
        const [longShares, longAvg] = ns.stock.getPosition(sym);
        const maxShares = ns.stock.getMaxShares(sym);
        const price = ns.stock.getPrice(sym);
        history[sym] = pushSample(history[sym], price, MOMENTUM_WINDOW);
        const signal = momentumSignal(history[sym], {
          minSamples: MOMENTUM_MIN_SAMPLES,
          buyThreshold: MOMENTUM_BUY_THRESHOLD,
          sellThreshold: MOMENTUM_SELL_THRESHOLD,
        });

        if (signal === "sell" && longShares > 0) {
          const gain = ns.stock.getSaleGain(sym, longShares, "L");
          // Same dust filter the 4S path uses: a falling window is the signal to leave, so
          // the only reason left to stay is a position too small to be worth the fee.
          if (worthTrading(gain, COMMISSION) && ns.stock.sellStock(sym, longShares) > 0) {
            const profit = gain - longShares * longAvg;
            log(ns, `SELL LONG ${sym}: ${longShares} shares, profit ${formatMoney(profit)} (momentum)`);
          }
        }

        // Blind positions grow too, but only a slice per cycle — the same cap the 4S path
        // uses, and doubly warranted here: without a forecast there is nothing to justify
        // concentrating the budget at all.
        if (signal === "buy" && longShares < maxShares) {
          const slice = positionSlice({ remaining, cycleBudget, fraction: POSITION_BUDGET_FRACTION });
          const wanted = Math.min(
            maxShares - longShares,
            Math.floor((slice - COMMISSION) / ns.stock.getAskPrice(sym)),
          );
          const shares = fitSharesToBudget({
            shares: wanted,
            budget: slice,
            costOf: (n) => ns.stock.getPurchaseCost(sym, n, "L"),
          });
          const cost = shares > 0 ? ns.stock.getPurchaseCost(sym, shares, "L") : 0;
          // Gated like the 4S path, and with more reason: momentum has no forecast to say
          // when to exit, so a fee-heavy entry has nothing arguing it back into profit.
          // Checked per symbol rather than breaking the loop — this loop also runs the
          // sells, and breaking early would strand a falling position unsold.
          if (shares > 0 && worthOpening(cost, COMMISSION, DEFAULTS.stockMinCommissionRatio)) {
            if (ns.stock.buyStock(sym, shares) > 0) {
              remaining -= cost;
              log(ns, `${longShares > 0 ? "ADD" : "BUY"} LONG ${sym}: ${shares} shares (momentum)`);
            }
          }
        }
      }
    }

    const portfolio = getPortfolio(ns);
    if (portfolio.positions.length > 0) {
      log(ns, `Portfolio: ${formatMoney(portfolio.totalValue)} value, ${formatMoney(portfolio.totalProfit)} profit, ${portfolio.positions.length} positions`);
    }

    await ns.sleep(6000);
  }
}
