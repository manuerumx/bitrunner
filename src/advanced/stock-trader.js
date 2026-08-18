import { DEFAULTS } from "/src/lib/constants.js";
import { momentumSignal, pushSample, shouldRealize } from "/src/lib/market.js";
import { log, formatMoney } from "/src/lib/utils.js";

// ns.stock.getConstants() is 0 GB and reports the real commission, so it no longer has to
// be hardcoded. Read once at startup — it is a game constant, not a live figure.
let COMMISSION = 100000;
let MIN_PROFIT = COMMISSION * 2;
const FORECAST_BUY_THRESHOLD = 0.55;
const FORECAST_SELL_THRESHOLD = 0.5;

// Fallback trading, used only when 4S market data isn't owned. Without a forecast the
// only signal is observed price history, so the bar is deliberately higher: a position
// pays commission twice, and there is no forecast to say when to get out.
const MOMENTUM_WINDOW = 20; // samples kept per symbol (~2 min at the 6 s cycle)
const MOMENTUM_MIN_SAMPLES = 12;
const MOMENTUM_BUY_THRESHOLD = 0.04;
const MOMENTUM_SELL_THRESHOLD = 0.02;
// Cap on how much of the per-cycle budget one non-4S position may take. Blind trading
// should be spread thin.
const MOMENTUM_POSITION_FRACTION = 0.2;

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

  // has4SData() is definitive and costs 0.05 GB; the old probe inferred it from whether
  // getForecast("ECP") threw. tools/market-access.js buys this when the budget allows.
  const use4S = ns.stock.has4SData();
  let useShorts = hasShortAccess(ns);

  const constants = ns.stock.getConstants();
  COMMISSION = constants.StockMarketCommission;
  MIN_PROFIT = COMMISSION * 2;

  if (!use4S) {
    ns.tprint("WARN: No 4S Market Data — trading on price momentum only. Buy 4S with:");
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
    // Per-cycle spend cap. Decrement it as we open positions so the full 25% isn't sized
    // against EACH strong-forecast symbol — otherwise the first few symbols could each try to
    // spend the whole budget and drain cash meant to stay liquid for servers/augs.
    let remaining = money * DEFAULTS.stockBudgetPercent;

    for (const sym of symbols) {
      const [longShares, longAvg, shortShares, shortAvg] = ns.stock.getPosition(sym);
      const maxShares = ns.stock.getMaxShares(sym);

      if (use4S) {
        const forecast = ns.stock.getForecast(sym);
        const volatility = ns.stock.getVolatility(sym);

        if (longShares > 0 && forecast < FORECAST_SELL_THRESHOLD) {
          const gain = ns.stock.getSaleGain(sym, longShares, "L");
          const profit = gain - longShares * longAvg;
          if (shouldRealize(profit, MIN_PROFIT)) {
            const salePrice = ns.stock.sellStock(sym, longShares);
            if (salePrice > 0) {
              log(ns, `SELL LONG ${sym}: ${longShares} shares, profit ${formatMoney(profit)}`);
            }
          }
        }

        if (useShorts && shortShares > 0 && forecast > FORECAST_SELL_THRESHOLD) {
          const gain = ns.stock.getSaleGain(sym, shortShares, "S");
          const profit = gain - shortShares * shortAvg;
          if (shouldRealize(profit, MIN_PROFIT)) {
            const salePrice = ns.stock.sellShort(sym, shortShares);
            if (salePrice > 0) {
              log(ns, `SELL SHORT ${sym}: ${shortShares} shares, profit ${formatMoney(profit)}`);
            }
          }
        }

        if (forecast > FORECAST_BUY_THRESHOLD && longShares === 0) {
          const affordable = Math.floor((remaining - COMMISSION) / ns.stock.getAskPrice(sym));
          const shares = Math.min(affordable, maxShares);
          if (shares > 0) {
            const cost = ns.stock.getPurchaseCost(sym, shares, "L");
            if (cost <= remaining && cost > 0) {
              const price = ns.stock.buyStock(sym, shares);
              if (price > 0) {
                remaining -= cost;
                log(ns, `BUY LONG ${sym}: ${shares} shares @ ${formatMoney(price)} (forecast: ${(forecast * 100).toFixed(1)}%)`);
              }
            }
          }
        }

        if (useShorts && forecast < 1 - FORECAST_BUY_THRESHOLD && shortShares === 0) {
          const affordable = Math.floor((remaining - COMMISSION) / ns.stock.getBidPrice(sym));
          const shares = Math.min(affordable, maxShares);
          if (shares > 0) {
            const cost = ns.stock.getPurchaseCost(sym, shares, "S");
            if (cost <= remaining && cost > 0) {
              try {
                const price = ns.stock.buyShort(sym, shares);
                if (price > 0) {
                  remaining -= cost;
                  log(ns, `BUY SHORT ${sym}: ${shares} shares @ ${formatMoney(price)} (forecast: ${(forecast * 100).toFixed(1)}%)`);
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
        const price = ns.stock.getPrice(sym);
        history[sym] = pushSample(history[sym], price, MOMENTUM_WINDOW);
        const signal = momentumSignal(history[sym], {
          minSamples: MOMENTUM_MIN_SAMPLES,
          buyThreshold: MOMENTUM_BUY_THRESHOLD,
          sellThreshold: MOMENTUM_SELL_THRESHOLD,
        });

        if (signal === "sell" && longShares > 0) {
          const gain = ns.stock.getSaleGain(sym, longShares, "L");
          const profit = gain - longShares * longAvg;
          // Same loss tolerance the 4S path uses. Without it the fallback trader would
          // dump on a 2% dip and pay commission twice to realise the loss.
          if (shouldRealize(profit, MIN_PROFIT) && ns.stock.sellStock(sym, longShares) > 0) {
            log(ns, `SELL LONG ${sym}: ${longShares} shares, profit ${formatMoney(profit)} (momentum)`);
          }
        }

        if (signal === "buy" && longShares === 0) {
          const slice = Math.min(remaining, money * DEFAULTS.stockBudgetPercent * MOMENTUM_POSITION_FRACTION);
          const affordable = Math.floor((slice - COMMISSION) / ns.stock.getAskPrice(sym));
          const shares = Math.min(affordable, maxShares);
          if (shares > 0) {
            const cost = ns.stock.getPurchaseCost(sym, shares, "L");
            if (cost > 0 && cost <= remaining && ns.stock.buyStock(sym, shares) > 0) {
              remaining -= cost;
              log(ns, `BUY LONG ${sym}: ${shares} shares (momentum)`);
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
