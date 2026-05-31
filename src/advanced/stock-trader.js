import { DEFAULTS } from "/src/lib/constants.js";
import { log, formatMoney } from "/src/lib/utils.js";

const COMMISSION = 100000;
const MIN_PROFIT = COMMISSION * 2;
const FORECAST_BUY_THRESHOLD = 0.55;
const FORECAST_SELL_THRESHOLD = 0.5;

function has4SData(ns) {
  try {
    ns.stock.getForecast("ECP");
    return true;
  } catch {
    return false;
  }
}

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
      const value = shortShares * shortAvg - shortShares * price;
      totalValue += shortShares * shortAvg;
      totalProfit += value - COMMISSION;
      positions.push({ sym, shares: shortShares, avg: shortAvg, type: "short", value: shortShares * shortAvg });
    }
  }

  return { positions, totalValue, totalProfit };
}

/** @param {NS} ns */
export async function main(ns) {
  ns.disableLog("ALL");

  if (!hasTIX(ns)) {
    ns.tprint("ERROR: TIX API access required. Purchase from World Stock Exchange.");
    return;
  }

  const use4S = has4SData(ns);
  const useShorts = hasShortAccess(ns);

  if (!use4S) {
    ns.tprint("WARN: No 4S Market Data. Trading will be limited.");
  }

  log(ns, `Stock Trader started (4S: ${use4S}, Shorts: ${useShorts})`);

  while (true) {
    const symbols = ns.stock.getSymbols();
    const money = ns.getPlayer().money;
    const budget = money * DEFAULTS.stockBudgetPercent;

    for (const sym of symbols) {
      const [longShares, longAvg, shortShares, shortAvg] = ns.stock.getPosition(sym);
      const maxShares = ns.stock.getMaxShares(sym);

      if (use4S) {
        const forecast = ns.stock.getForecast(sym);
        const volatility = ns.stock.getVolatility(sym);

        if (longShares > 0 && forecast < FORECAST_SELL_THRESHOLD) {
          const gain = ns.stock.getSaleGain(sym, longShares, "L");
          const profit = gain - longShares * longAvg;
          if (profit > -MIN_PROFIT) {
            const salePrice = ns.stock.sellStock(sym, longShares);
            if (salePrice > 0) {
              log(ns, `SELL LONG ${sym}: ${longShares} shares, profit ${formatMoney(profit)}`);
            }
          }
        }

        if (useShorts && shortShares > 0 && forecast > FORECAST_SELL_THRESHOLD) {
          const gain = ns.stock.getSaleGain(sym, shortShares, "S");
          const profit = gain - shortShares * shortAvg;
          if (profit > -MIN_PROFIT) {
            const salePrice = ns.stock.sellShort(sym, shortShares);
            if (salePrice > 0) {
              log(ns, `SELL SHORT ${sym}: ${shortShares} shares, profit ${formatMoney(profit)}`);
            }
          }
        }

        if (forecast > FORECAST_BUY_THRESHOLD && longShares === 0) {
          const affordable = Math.floor(budget / ns.stock.getAskPrice(sym));
          const shares = Math.min(affordable, maxShares - longShares);
          if (shares > 0) {
            const cost = ns.stock.getPurchaseCost(sym, shares, "L");
            if (cost < budget && cost > 0) {
              const price = ns.stock.buyStock(sym, shares);
              if (price > 0) {
                log(ns, `BUY LONG ${sym}: ${shares} shares @ ${formatMoney(price)} (forecast: ${(forecast * 100).toFixed(1)}%)`);
              }
            }
          }
        }

        if (useShorts && forecast < 1 - FORECAST_BUY_THRESHOLD && shortShares === 0) {
          const affordable = Math.floor(budget / ns.stock.getBidPrice(sym));
          const shares = Math.min(affordable, maxShares - shortShares);
          if (shares > 0) {
            const cost = ns.stock.getPurchaseCost(sym, shares, "S");
            if (cost < budget && cost > 0) {
              const price = ns.stock.shortStock(sym, shares);
              if (price > 0) {
                log(ns, `BUY SHORT ${sym}: ${shares} shares @ ${formatMoney(price)} (forecast: ${(forecast * 100).toFixed(1)}%)`);
              }
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
