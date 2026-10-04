import { PORTS } from "/src/lib/constants.js";
import {
  activeCashRequest,
  entrySide,
  estimateForecast,
  estimateVolatility,
  exitSide,
  expectedReturn,
  fitSharesToBudget,
  parseStockHistory,
  pickRotation,
  planLiquidation,
  positionRoom,
  pushSample,
  rankByExpectedReturn,
  shareHeadroom,
  STOCK_HISTORY_FILE,
  worthTrading,
} from "/src/lib/market.js";
import { readPortData, writePortData } from "/src/lib/port-registry.js";
import { log, tlog, formatMoney } from "/src/lib/utils.js";

// Long/short trader for BitNode-8 (Ghost of Wall Street), where the market is the only
// income. Run it by hand instead of the daemon's stock-trader.js:
//
//   run /src/advanced/stock-trader-bn8.js
//   run /src/advanced/stock-trader-bn8.js --reserve 50e6   keep $50m out of the market
//   run /src/advanced/stock-trader-bn8.js --margin 0.12    only open on forecasts ≥0.62 / ≤0.38
//
// What it does differently from stock-trader.js:
//   - Fully invested. stock-trader.js holds back a $1b reserve and spends 25% of the rest
//     per cycle, which at BN8's $250m start means it never trades at all.
//   - Diversified: no symbol takes more than --max-position (default 25%) of net worth.
//     Uncapped, the first live run put the whole $240m bankroll into one short.
//   - Ranks by expected move per tick (volatility × edge), not forecast alone, and shorts
//     as readily as it goes long.
//   - Rotates: once the cash is spent, a candidate that beats the weakest holding by
//     --rotate (default 2×) gets funded by closing that holding.
//   - Funds grafts: a CashRequest on PORTS.CASH_REQUEST (tools/grafting.js queue) is held
//     back from buying, and the weakest holdings are sold until the cash is there. Net
//     worth is published on PORTS.STOCK_STATUS every tick so the queue can size grafts.
//   - Wakes on ns.stock.nextUpdate() instead of a fixed 6 s sleep, so it reacts to the tick
//     a forecast flips rather than up to a tick late.
//
// Forecasts: BN8 starts with the TIX API but not 4S, so there is no getForecast(). Until the
// 4S Market Data TIX API is owned, each symbol's forecast is estimated as the fraction of
// up-ticks over its last LONG_WINDOW ticks, and nothing is traded until a symbol has
// MIN_MOVES of history (~3 min after a start). The long window lags a market-cycle flip, so
// a SHORT_WINDOW estimate that has swung past FLIP_MARGIN forces an early exit. The moment
// has4SDataTixApi() turns true the trader switches to the real forecast and volatility —
// no restart needed. The history is saved to STOCK_HISTORY_FILE every tick, so a restart
// within HISTORY_MAX_AGE_MS picks up where it left off instead of warming up again.
//
// Shorting needs BitNode-8 or SF-8.2; without it the trader falls back to longs only.

const DAEMON_TRADER = "/src/advanced/stock-trader.js";
const RECENT_TRADES = 12;
const TRIM_SLACK = 1.2;

const LONG_WINDOW = 60; // moves; standard error of the estimate ≈ ±0.065
const SHORT_WINDOW = 15;
const MIN_MOVES = 30;
// A 0.6 stock shows ≤4 ups in 15 about 1% of the time; after a flip to 0.4, ~22% per tick.
const FLIP_MARGIN = 0.2;
// Entry dead band around 0.5. The estimate is noisy, so it needs a wider band than 4S.
const MARGIN_4S = 0.05;
const MARGIN_ESTIMATED = 0.1;
// ~20 ticks. Missed ticks merge into one move in the window, and a much older save could
// straddle a market-cycle flip, so past this the warm-up is the safer start.
const HISTORY_MAX_AGE_MS = 2 * 60_000;
// The grafting queue refreshes its request every few seconds; one it stops refreshing
// (the script died) lapses after this instead of freezing the cash.
const CASH_REQUEST_MAX_AGE_MS = 30_000;

/** @param {NS} ns */
export async function main(ns) {
  ns.disableLog("ALL");
  ns.ui.openTail();

  const flags = ns.flags([
    ["reserve", 0], // cash never invested
    ["margin", -1], // dead band around 0.5 for opening a position; -1 = 0.05 with 4S, 0.1 without
    ["rotate", 2], // a candidate must beat the weakest holding by this factor to replace it
    ["max-position", 0.25], // most of net worth any one symbol may hold
    ["min-order", 0], // smallest buy worth a commission; 0 = 50 × commission
  ]);
  const reserve = Number(flags.reserve);
  const marginFlag = Number(flags.margin);
  const rotateFactor = Number(flags.rotate);
  const maxPosition = Number(flags["max-position"]);

  if (!ns.stock.hasTixApiAccess()) {
    tlog(ns, "ERROR: stock-trader-bn8 needs the TIX API.");
    return;
  }

  const commission = ns.stock.getConstants().StockMarketCommission;
  const minOrder = Number(flags["min-order"]) > 0 ? Number(flags["min-order"]) : commission * 50;

  stopDaemonTrader(ns);

  let useShorts = true;
  /** @type {string[]} */
  const recent = [];
  const record = (/** @type {string} */ line) => {
    recent.push(`[${new Date().toLocaleTimeString()}] ${line}`);
    if (recent.length > RECENT_TRADES) recent.shift();
  };
  let realized = 0;

  const symbols = ns.stock.getSymbols();
  /** @type {Record<string, number[]>} one price per tick, bounded to LONG_WINDOW + 1 */
  const history = parseStockHistory(ns.read(STOCK_HISTORY_FILE), {
    now: Date.now(),
    maxAgeMs: HISTORY_MAX_AGE_MS,
    windowSize: LONG_WINDOW + 1,
  });
  const restored = Object.keys(history).length;
  if (restored > 0) {
    const ticks = Math.max(...Object.values(history).map((h) => h.length));
    record(`RESTORED ${ticks} ticks of price history for ${restored} symbols from ${STOCK_HISTORY_FILE}`);
  }

  while (true) {
    await ns.stock.nextUpdate();

    // Re-checked every tick (0.05 GB) so buying the API mid-run upgrades the trader in place.
    const has4S = ns.stock.has4SDataTixApi();
    const margin = marginFlag >= 0 ? marginFlag : has4S ? MARGIN_4S : MARGIN_ESTIMATED;
    let warm = 0;

    const all = symbols.map((sym) => {
      history[sym] = pushSample(history[sym], ns.stock.getPrice(sym), LONG_WINDOW + 1);
      const [longShares, longAvg, shortShares, shortAvg] = ns.stock.getPosition(sym);
      let forecast = null;
      let recent = null;
      let volatility = 0;
      if (has4S) {
        forecast = recent = ns.stock.getForecast(sym);
        volatility = ns.stock.getVolatility(sym);
      } else if (history[sym].length > MIN_MOVES) {
        forecast = estimateForecast(history[sym], LONG_WINDOW);
        recent = estimateForecast(history[sym], SHORT_WINDOW);
        volatility = estimateVolatility(history[sym], LONG_WINDOW);
      }
      if (forecast !== null) warm++;
      return {
        sym,
        forecast,
        recent: recent ?? forecast,
        volatility,
        maxShares: ns.stock.getMaxShares(sym),
        longShares,
        longAvg,
        shortShares,
        shortAvg,
      };
    });
    // Symbols still warming up are neither bought nor sold; positions in them are held.
    const book = /** @type {Array<typeof all[number] & {forecast: number, recent: number}>} */ (
      all.filter((s) => s.forecast !== null)
    );
    /** Our own order moves the price; rebase so the next tick's move isn't read as a signal. */
    const rebase = (/** @type {string} */ sym) => {
      history[sym][history[sym].length - 1] = ns.stock.getPrice(sym);
    };

    /** Close one side of a symbol, returning the net proceeds (0 if nothing sold). */
    const close = (/** @type {typeof book[number]} */ s, /** @type {"L" | "S"} */ side, /** @type {string} */ why) => {
      const shares = side === "L" ? s.longShares : s.shortShares;
      const avg = side === "L" ? s.longAvg : s.shortAvg;
      const gain = ns.stock.getSaleGain(s.sym, shares, side);
      const sold = side === "L" ? ns.stock.sellStock(s.sym, shares) : ns.stock.sellShort(s.sym, shares);
      if (!(sold > 0)) return 0;
      rebase(s.sym);
      const profit = gain - shares * avg - commission; // buy-side commission sits outside avg
      realized += profit;
      if (side === "L") s.longShares = 0;
      else s.shortShares = 0;
      record(`CLOSE ${side === "L" ? "LONG " : "SHORT"} ${s.sym.padEnd(5)} ${formatMoney(profit).padStart(9)}  ${why}`);
      return gain;
    };

    // 1. Exits first: they free cash and share headroom for this same tick.
    for (const s of book) {
      const side = exitSide({ ...s, flipMargin: has4S ? 0 : FLIP_MARGIN });
      if (!side) continue;
      const shares = side === "L" ? s.longShares : s.shortShares;
      // Dust stays: closing it would cost more in commission than it returns.
      if (!worthTrading(ns.stock.getSaleGain(s.sym, shares, side), commission)) continue;
      close(s, side, `forecast ${pct(s.forecast)}`);
    }

    /** Net proceeds of what a symbol holds right now (one side at most). */
    const heldValue = (/** @type {typeof all[number]} */ h) =>
      (h.longShares > 0 ? ns.stock.getSaleGain(h.sym, h.longShares, "L") : 0) +
      (h.shortShares > 0 ? ns.stock.getSaleGain(h.sym, h.shortShares, "S") : 0);
    // Fixed for the tick: trades only move it by commissions, and caps that shifted
    // mid-pass would let the first buys of a tick size against a different total.
    const netWorth = ns.getPlayer().money + all.reduce((sum, h) => sum + heldValue(h), 0);

    // 2. Trim anything that has outgrown its cap, back down to the cap. The slack keeps a
    // winner from being trimmed every tick it grows; this mostly catches a position opened
    // before the cap existed or under a smaller --max-position.
    for (const h of all) {
      const value = heldValue(h);
      const cap = netWorth * maxPosition;
      if (value <= cap * TRIM_SLACK) continue;
      const side = h.longShares > 0 ? "L" : "S";
      const shares = side === "L" ? h.longShares : h.shortShares;
      const sell = Math.floor(shares * (1 - cap / value));
      if (sell <= 0) continue;
      const sold = side === "L" ? ns.stock.sellStock(h.sym, sell) : ns.stock.sellShort(h.sym, sell);
      if (!(sold > 0)) continue;
      if (side === "L") h.longShares -= sell;
      else h.shortShares -= sell;
      if (history[h.sym]) rebase(h.sym);
      record(`TRIM  ${side === "L" ? "LONG " : "SHORT"} ${h.sym.padEnd(5)} ${formatMoney(value - cap).padStart(9)}  over ${pct(maxPosition)} cap`);
    }

    // 3. Cover a cash request (a graft waiting to start) by selling the weakest holdings.
    const requested = activeCashRequest(readPortData(ns, PORTS.CASH_REQUEST), {
      now: Date.now(),
      maxAgeMs: CASH_REQUEST_MAX_AGE_MS,
    });
    const holdBack = Math.max(reserve, requested);
    const shortfall = holdBack - ns.getPlayer().money;
    if (requested > 0 && shortfall > 0) {
      const held = all
        .filter((h) => h.longShares > 0 || h.shortShares > 0)
        .map((h) => ({
          sym: h.sym,
          h,
          er: h.forecast === null ? 0 : expectedReturn(h.forecast, h.volatility),
          value: heldValue(h),
        }));
      // Each sale pays a commission out of its proceeds, so ask for a little more.
      for (const { sym, fraction } of planLiquidation({ held, need: shortfall + commission * held.length })) {
        const h = /** @type {typeof all[number]} */ (held.find((x) => x.sym === sym)?.h);
        const side = h.longShares > 0 ? "L" : "S";
        const shares = side === "L" ? h.longShares : h.shortShares;
        const sell = fraction >= 1 ? shares : Math.min(shares, Math.ceil(shares * fraction));
        const sold = side === "L" ? ns.stock.sellStock(sym, sell) : ns.stock.sellShort(sym, sell);
        if (!(sold > 0)) continue;
        if (side === "L") h.longShares -= sell;
        else h.shortShares -= sell;
        if (history[sym]) rebase(sym);
        record(`FUND  ${side === "L" ? "LONG " : "SHORT"} ${sym.padEnd(5)} ${pct(fraction).padStart(9)}  for ${formatMoney(requested)} cash request`);
      }
    }

    // 4. Entries, strongest expected move first.
    /** @type {Set<string>} */
    const boughtThisTick = new Set();
    /** @type {Set<string>} */
    const rotatedOut = new Set();
    const candidates = rankByExpectedReturn(book).filter((s) => {
      const side = entrySide(s.forecast, margin);
      if (!side || (side === "S" && !useShorts)) return false;
      // The recent window must not already disagree — that is a flip the long window hasn't caught.
      if (side === "L" ? s.recent < 0.5 : s.recent > 0.5) return false;
      // Never hold both sides: add to the side already held, never open the opposite one.
      if (side === "L" && s.shortShares > 0) return false;
      if (side === "S" && s.longShares > 0) return false;
      return shareHeadroom(s) > 0;
    });

    for (const s of candidates) {
      if (rotatedOut.has(s.sym)) continue; // just sold to fund something better; buying back burns two fees
      const side = /** @type {"L" | "S"} */ (entrySide(s.forecast, margin));
      const er = expectedReturn(s.forecast, s.volatility);
      const held = heldValue(s);
      // At its cap already: nothing to buy, and nothing worth rotating out for it.
      if (netWorth * maxPosition - held < minOrder) continue;
      let cash = ns.getPlayer().money - holdBack;
      // A pending cash request owns everything up to holdBack; swapping holdings now would
      // only sell positions to fund buys that cannot happen.
      if (requested > 0 && cash < minOrder) break;

      if (cash < minOrder) {
        const held = book
          .filter((h) => h.sym !== s.sym && !boughtThisTick.has(h.sym) && (h.longShares > 0 || h.shortShares > 0))
          .map((h) => ({ h, er: expectedReturn(h.forecast, h.volatility) }));
        const out = pickRotation({ held, candidateEr: er, factor: rotateFactor });
        if (!out) break; // ranked order: if this one can't displace anything, nothing later can
        close(out.h, out.h.longShares > 0 ? "L" : "S", `rotated out for ${s.sym} (move ${fmtEr(out.er)} vs ${fmtEr(er)})`);
        rotatedOut.add(out.h.sym);
        cash = ns.getPlayer().money - holdBack;
        if (cash < minOrder) continue;
      }
      const budget = positionRoom({ netWorth, fraction: maxPosition, held, cash });

      const price = side === "L" ? ns.stock.getAskPrice(s.sym) : ns.stock.getBidPrice(s.sym);
      const shares = fitSharesToBudget({
        shares: Math.min(shareHeadroom(s), Math.floor((budget - commission) / price)),
        budget,
        costOf: (n) => ns.stock.getPurchaseCost(s.sym, n, side),
      });
      if (shares <= 0) continue;
      const cost = ns.stock.getPurchaseCost(s.sym, shares, side);
      // Too small to be worth a commission — unless it tops off the last of the symbol's cap.
      if (cost < minOrder && shares < shareHeadroom(s)) continue;

      let filled = 0;
      if (side === "L") {
        filled = ns.stock.buyStock(s.sym, shares);
      } else {
        try {
          filled = ns.stock.buyShort(s.sym, shares);
        } catch {
          useShorts = false;
          tlog(ns, "WARN: shorting unavailable (needs BitNode-8 or SF-8.2) — trading longs only.");
          continue;
        }
      }
      if (!(filled > 0)) continue;
      rebase(s.sym);

      if (side === "L") s.longShares += shares;
      else s.shortShares += shares;
      boughtThisTick.add(s.sym);
      record(`OPEN  ${side === "L" ? "LONG " : "SHORT"} ${s.sym.padEnd(5)} ${formatMoney(cost).padStart(9)}  forecast ${pct(s.forecast)}`);
    }

    const seen = Math.max(0, ...symbols.map((sym) => history[sym].length));
    const mode = has4S
      ? "4S forecasts"
      : warm === 0
        ? `warming up: ${seen}/${MIN_MOVES + 1} ticks, nothing trades until then`
        : `estimated forecasts (${warm}/${symbols.length} symbols warm)`;
    const reqNote = requested > 0 ? `   holding ${formatMoney(requested)} for a cash request` : "";
    const netWorthNow = render(ns, all, recent, realized, mode + reqNote);
    writePortData(ns, PORTS.STOCK_STATUS, /** @type {StockStatus} */ ({
      netWorth: netWorthNow,
      cash: ns.getPlayer().money,
      updatedAt: Date.now(),
    }));
    ns.write(STOCK_HISTORY_FILE, JSON.stringify({ savedAt: Date.now(), history }), "w");
  }
}

/** Kill the daemon's trader and keep it off, so the two don't trade against each other. */
function stopDaemonTrader(ns) {
  const overrides = /** @type {{ disabledManagers?: string[] }} */ (readPortData(ns, PORTS.CONFIG_OVERRIDES) || {});
  const disabled = new Set(overrides.disabledManagers || []);
  if (!disabled.has("stock")) {
    disabled.add("stock");
    writePortData(ns, PORTS.CONFIG_OVERRIDES, { ...overrides, disabledManagers: [...disabled] });
    tlog(ns, "Disabled the daemon's stock manager (re-enable with: run /src/tools/manager-toggle.js on stock)");
  }
  if (ns.scriptKill(DAEMON_TRADER, "home")) log(ns, "Stopped stock-trader.js");
}

/** Expected move per tick, as basis points of price. @param {number} er */
function fmtEr(er) {
  return `${(Math.abs(er) * 1e4).toFixed(1)}bp`;
}

/** @param {number} f */
function pct(f) {
  return `${(f * 100).toFixed(1)}%`;
}

/**
 * Redraw the tail window: net worth, every open position, the last few trades.
 * @param {NS} ns
 * @returns {number} net worth, cash plus the net proceeds of every position
 */
function render(ns, book, recent, realized, mode) {
  const cash = ns.getPlayer().money;
  let held = 0;
  const rows = [];
  for (const s of book) {
    for (const side of /** @type {const} */ (["L", "S"])) {
      const shares = side === "L" ? s.longShares : s.shortShares;
      if (!(shares > 0)) continue;
      const [, longAvg, , shortAvg] = ns.stock.getPosition(s.sym);
      const avg = side === "L" ? longAvg : shortAvg;
      const value = ns.stock.getSaleGain(s.sym, shares, side);
      held += value;
      rows.push(
        `${(side === "L" ? "LONG " : "SHORT")} ${s.sym.padEnd(5)} ${formatMoney(value).padStart(9)} ` +
          `${formatMoney(value - shares * avg).padStart(9)}  f ${s.forecast === null ? "  warm-up" : pct(s.forecast)}`,
      );
    }
  }

  ns.clearLog();
  ns.print(`Net worth ${formatMoney(cash + held)}   cash ${formatMoney(cash)}   invested ${formatMoney(held)}`);
  ns.print(`Realized this run ${formatMoney(realized)}   ${mode}`);
  ns.print("");
  ns.print("SIDE  SYM       VALUE       P/L  FORECAST");
  for (const r of rows) ns.print(r);
  if (rows.length === 0) ns.print("(no positions)");
  ns.print("");
  for (const t of recent) ns.print(t);
  return cash + held;
}
