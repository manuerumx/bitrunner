import { DEFAULTS } from "/src/lib/constants.js";
import {
  FORECAST_BUY_THRESHOLD,
  FORECAST_SELL_THRESHOLD,
  portfolioStats,
  worthTrading,
} from "/src/lib/market.js";
import { formatMoney } from "/src/lib/utils.js";

// What the trader holds, against the capital that can actually reach the market.
//
//   run /src/tools/stock-report.js
//
// The first version of this report measured the portfolio against total market capacity and
// concluded from a 0.6% fill that the trader was under-investing. That reading is a trap:
// fill is bounded by net worth, so $33.77b in a $5.36t market cannot exceed 0.63% however
// well the trader performs. It was at 95% of its ceiling and the report called it a failure
// — a verdict that could not have come out any other way until the player was worth
// trillions. Acting on it (commit 8657540) removed the trader's buy gate without capping
// per-symbol spend, and the portfolio went 100% into one symbol.
//
// So DEPLOYED, not FILL, is the headline: held over investable capital. CONCENTRATION is
// the number whose absence hid the damage. Market capacity is still shown per symbol —
// it is a real ceiling on any single position — but it no longer judges the portfolio.

/** @param {NS} ns */
export async function main(ns) {
  ns.disableLog("ALL");
  ns.ui.openTail();

  let symbols;
  try {
    symbols = ns.stock.getSymbols();
  } catch {
    ns.tprint("ERROR: TIX API access required. run /src/tools/market-access.js");
    return;
  }

  const use4S = ns.stock.has4SData();
  const commission = ns.stock.getConstants().StockMarketCommission;
  const money = ns.getPlayer().money;
  const reserve = DEFAULTS.stockReservedCash;

  let capacity = 0; // what the market would let you hold, at today's prices
  let underfilled = 0; // bullish symbols the trader has room to buy more of
  const rows = [];
  /** @type {Array<{sym: string, value: number}>} */
  const positions = [];

  for (const sym of symbols) {
    // Shorts used to be dropped on this line, which reported a shorted symbol as $0 held
    // and understated the portfolio by the whole short book.
    const [longShares, longAvg, shortShares, shortAvg] = ns.stock.getPosition(sym);
    const ask = ns.stock.getAskPrice(sym);
    const maxShares = ns.stock.getMaxShares(sym);
    const forecast = use4S ? ns.stock.getForecast(sym) : NaN;

    // Realisable value and profit, both from getSaleGain, which prices in the commission
    // and the impact a position of this size has on its own exit. HELD used to be
    // longShares * bid — the naive figure, in the same row as an impact-adjusted profit.
    const longGain = longShares > 0 ? ns.stock.getSaleGain(sym, longShares, "L") : 0;
    const shortGain = shortShares > 0 ? ns.stock.getSaleGain(sym, shortShares, "S") : 0;
    const symHeld = longGain + shortGain;
    const profit = longGain - longShares * longAvg + (shortGain - shortShares * shortAvg);

    capacity += maxShares * ask;
    if (symHeld > 0) positions.push({ sym, value: symHeld });

    // What stock-trader.js will do with this symbol on its next cycle, by the same rules —
    // imported now, rather than re-declared here under a comment claiming they were.
    let action = "";
    if (use4S && forecast > FORECAST_BUY_THRESHOLD && longShares < maxShares) {
      action = longShares > 0 ? "ADD" : "BUY";
      underfilled++;
    } else if (use4S && longShares > 0 && forecast < FORECAST_SELL_THRESHOLD) {
      action = worthTrading(longGain, commission) ? "SELL" : "dust";
    } else if (longShares > 0 || shortShares > 0) {
      action = "hold";
    }

    rows.push({
      sym,
      forecast,
      fill: maxShares > 0 ? (longShares + shortShares) / maxShares : 0,
      symHeld,
      symCapacity: maxShares * ask,
      profit,
      shares: longShares + shortShares,
      short: shortShares > 0,
      action,
    });
  }

  const stats = portfolioStats({ positions, cash: money, reserve });

  // Held first: the positions are the subject of the report, and sorting by headroom put
  // them wherever the market happened to be widest.
  rows.sort((a, b) => b.symHeld - a.symHeld || b.symCapacity - a.symCapacity);

  ns.print(`SYM   FCST   FILL      HELD        CAPACITY     UNREALISED  NEXT`);
  for (const r of rows) {
    const fcst = use4S ? (r.forecast * 100).toFixed(0).padStart(3) + "%" : "  — ";
    const flag = r.action ? ` ${r.action}${r.short ? " (short)" : ""}` : "";
    ns.print(
      `${r.sym.padEnd(5)} ${fcst} ${(r.fill * 100).toFixed(1).padStart(5)}% ` +
        `${formatMoney(r.symHeld).padStart(11)} ${formatMoney(r.symCapacity).padStart(11)} ` +
        `${r.shares > 0 ? formatMoney(r.profit).padStart(11) : "".padStart(11)}${flag}`,
    );
  }

  ns.print("");
  ns.print(`Cash                ${formatMoney(money)}   (${formatMoney(reserve)} reserved, untouchable)`);
  ns.print(`Portfolio value     ${formatMoney(stats.held)}   (realisable now, net of fees and impact)`);
  ns.print(`Investable capital  ${formatMoney(stats.investable)}   portfolio + cash above the reserve`);
  ns.print(`Deployed            ${(stats.deployed * 100).toFixed(1)}% of investable capital is in the market`);
  ns.print(
    `Concentration       ${(stats.concentration * 100).toFixed(1)}% of the portfolio is ${stats.topSymbol ?? "—"}` +
      `   (${positions.length} position${positions.length === 1 ? "" : "s"})`,
  );
  ns.print(`Buyable now         ${underfilled} symbols are bullish with room left to fill`);
  ns.print("");
  // Market capacity is a ceiling on a single position, not a target for the portfolio, so
  // it is reported as context and never compared against what is held.
  ns.print(`Market capacity     ${formatMoney(capacity)}   (max holdable at today's prices — a wall, not a goal)`);
  ns.print(`Capital reaches     ${((stats.investable / capacity) * 100).toFixed(2)}% of it, so that is the fill ceiling`);
  ns.print("");

  // Three failures, in the order they matter. Idle capital is money doing nothing;
  // concentration is money doing one thing very hard. Both were invisible before.
  let verdict;
  if (stats.investable <= 0) {
    verdict = "no capital in play — nothing to judge";
  } else if (stats.deployed < 0.5 && underfilled > 0) {
    verdict = `under-invested — ${formatMoney(stats.investable - stats.held)} idle with ${underfilled} bullish symbols to buy`;
  } else if (positions.length > 0 && stats.concentration > 0.5) {
    verdict = `over-concentrated — ${(stats.concentration * 100).toFixed(0)}% in ${stats.topSymbol}; one forecast turning takes the portfolio with it`;
  } else {
    verdict = `healthy — ${(stats.deployed * 100).toFixed(0)}% deployed across ${positions.length} positions, none over ${(stats.concentration * 100).toFixed(0)}%`;
  }
  ns.print(`Verdict: ${verdict}`);

  ns.tprint(
    `Portfolio ${formatMoney(stats.held)} — ${(stats.deployed * 100).toFixed(0)}% deployed, ` +
      `${(stats.concentration * 100).toFixed(0)}% in ${stats.topSymbol ?? "—"} across ${positions.length} positions. ` +
      `Verdict: ${verdict}. See tail for the per-symbol table.`,
  );
}
