import { worthTrading } from "/src/lib/market.js";
import { formatMoney } from "/src/lib/utils.js";

// What the trader holds against what the market would let it hold.
//
//   run /src/tools/stock-report.js
//
// Written to settle why a $5 t player held $45 b of stock. FILL is the number that decides
// it: held / maxShares. Low fill everywhere with large unused CAPACITY means the trader is
// leaving money on the table; fill near the ceiling means the market is simply full and
// there is nothing to fix.
//
// It found 0.6 % fill against $7.8 t of headroom, with 15 of 15 held positions locked —
// stock-trader.js sized a position once and never added to it (`longShares === 0`), while
// the old loss tolerance refused to close anything more than $200 k underwater. Neither
// door opened. Both are fixed; ACTION now shows what the trader will do with each symbol
// on its next cycle, so the same command verifies the fix instead of just diagnosing it.

// Mirrors stock-trader.js. Kept in sync by importing the same rule the trader applies.
const FORECAST_BUY_THRESHOLD = 0.55;
const FORECAST_SELL_THRESHOLD = 0.5;

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

  let capacity = 0; // what the market would let you hold, at today's prices
  let held = 0; // what you actually hold
  let underfilled = 0; // bullish symbols the trader has room to buy more of
  const rows = [];

  for (const sym of symbols) {
    const [longShares, longAvg] = ns.stock.getPosition(sym);
    const ask = ns.stock.getAskPrice(sym);
    const bid = ns.stock.getBidPrice(sym);
    const maxShares = ns.stock.getMaxShares(sym);
    const forecast = use4S ? ns.stock.getForecast(sym) : NaN;

    const symCapacity = maxShares * ask;
    const symHeld = longShares * bid;
    capacity += symCapacity;
    held += symHeld;

    // Realisable profit if closed right now. getSaleGain already nets the sale commission.
    const gain = longShares > 0 ? ns.stock.getSaleGain(sym, longShares, "L") : 0;
    const profit = longShares > 0 ? gain - longShares * longAvg : 0;

    // What stock-trader.js will do with this symbol on its next cycle, by the same rules.
    let action = "";
    if (use4S && forecast > FORECAST_BUY_THRESHOLD && longShares < maxShares) {
      action = longShares > 0 ? "ADD" : "BUY";
      underfilled++;
    } else if (use4S && longShares > 0 && forecast < FORECAST_SELL_THRESHOLD) {
      action = worthTrading(gain, commission) ? "SELL" : "dust";
    } else if (longShares > 0) {
      action = "hold";
    }

    rows.push({
      sym,
      forecast,
      fill: maxShares > 0 ? longShares / maxShares : 0,
      symHeld,
      symCapacity,
      headroom: symCapacity - symHeld,
      profit,
      longShares,
      action,
    });
  }

  rows.sort((a, b) => b.headroom - a.headroom);

  ns.print(`SYM   FCST   FILL      HELD        CAPACITY     UNREALISED  NEXT`);
  for (const r of rows) {
    const fcst = use4S ? (r.forecast * 100).toFixed(0).padStart(3) + "%" : "  — ";
    const flag = r.action ? ` ${r.action}` : "";
    ns.print(
      `${r.sym.padEnd(5)} ${fcst} ${(r.fill * 100).toFixed(1).padStart(5)}% ` +
        `${formatMoney(r.symHeld).padStart(11)} ${formatMoney(r.symCapacity).padStart(11)} ` +
        `${r.longShares > 0 ? formatMoney(r.profit).padStart(11) : "".padStart(11)}${flag}`,
    );
  }

  ns.print("");
  ns.print(`Cash                ${formatMoney(money)}`);
  ns.print(`Portfolio value     ${formatMoney(held)}`);
  ns.print(`Market capacity     ${formatMoney(capacity)}   (max holdable at today's prices)`);
  ns.print(`Unused headroom     ${formatMoney(capacity - held)}   ${((1 - held / capacity) * 100).toFixed(1)}% of the market is untouched`);
  ns.print(`Overall fill        ${((held / capacity) * 100).toFixed(1)}%`);
  ns.print(`Buyable now         ${underfilled} symbols are bullish with room left to fill`);
  ns.print("");
  ns.print(`Verdict: ${capacity > held * 2 ? "market has room — the trader is under-investing" : "at or near the market ceiling — nothing to fix"}`);

  ns.tprint(`Portfolio ${formatMoney(held)} / capacity ${formatMoney(capacity)} (${((held / capacity) * 100).toFixed(1)}% filled, ${underfilled} buyable). See tail for the per-symbol table.`);
}
