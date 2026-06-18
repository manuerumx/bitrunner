import { log, tlog, formatMoney } from "/src/lib/utils.js";

// Pre-reset stock liquidator. Run this INSTEAD of the daemon when you're about to
// install augmentations and need to be flat (all positions sold) for cash.
//
//   run src/tools/sell-stocks.js        → wait for each position to be green, then sell it
//   run src/tools/sell-stocks.js now    → dump EVERYTHING immediately, profit or loss
//
// On startup it stops the daemon and the stock-trader so nothing keeps buying while
// it liquidates (the daemon would otherwise relaunch the trader every few seconds).

const POLL_MS = 4000;
const DAEMON = "src/daemon.js";
const TRADER = "src/advanced/stock-trader.js";

function hasTIX(ns) {
  try {
    ns.stock.getSymbols();
    return true;
  } catch {
    return false;
  }
}

// Kill all instances of a script on home by name, tolerant of leading-slash differences.
function killByName(ns, name) {
  const target = name.replace(/^\/+/, "");
  let killed = 0;
  for (const p of ns.ps("home")) {
    if (p.filename.replace(/^\/+/, "") === target) {
      ns.kill(p.pid);
      killed++;
    }
  }
  return killed;
}

// Realizable profit of a position. getSaleGain already nets out the sale commission,
// so (gain - costBasis) is the true profit if we close right now.
function positionProfit(ns, sym, shares, avg, type) {
  return ns.stock.getSaleGain(sym, shares, type) - shares * avg;
}

/** @param {NS} ns */
export async function main(ns) {
  ns.disableLog("ALL");
  ns.ui.openTail();

  if (!hasTIX(ns)) {
    ns.tprint("ERROR: TIX API access required to sell stocks.");
    return;
  }

  const force = ["now", "force", "all"].includes(String(ns.args[0]));

  // Stop anything that keeps BUYING. Killing the daemon prevents it from relaunching
  // the trader; killing the trader stops the currently-running one immediately.
  for (const script of [DAEMON, TRADER]) {
    if (killByName(ns, script) > 0) tlog(ns, `Stopped ${script}`);
  }

  tlog(ns, force
    ? "=== STOCK LIQUIDATOR — dumping ALL positions now (profit or loss) ==="
    : "=== STOCK LIQUIDATOR — selling each position as soon as it's green ===");

  let totalRealized = 0;

  while (true) {
    const symbols = ns.stock.getSymbols();
    let waiting = 0;
    let waitingBasis = 0;

    for (const sym of symbols) {
      const [longShares, longAvg, shortShares, shortAvg] = ns.stock.getPosition(sym);

      // --- LONG ---
      if (longShares > 0) {
        const profit = positionProfit(ns, sym, longShares, longAvg, "L");
        if (force || profit > 0) {
          if (ns.stock.sellStock(sym, longShares) > 0) {
            totalRealized += profit;
            log(ns, `SOLD LONG  ${sym}: ${longShares} sh  ${profit >= 0 ? "+" : ""}${formatMoney(profit)}`);
          }
        } else {
          waiting++;
          waitingBasis += longShares * longAvg;
        }
      }

      // --- SHORT --- (closing an existing short always works, even without short-open access)
      if (shortShares > 0) {
        let profit = 0;
        try {
          profit = positionProfit(ns, sym, shortShares, shortAvg, "S");
        } catch {
          profit = force ? 0 : -1; // can't price it — only force-close
        }
        if (force || profit > 0) {
          try {
            if (ns.stock.sellShort(sym, shortShares) > 0) {
              totalRealized += profit;
              log(ns, `COVERED SHT ${sym}: ${shortShares} sh  ${profit >= 0 ? "+" : ""}${formatMoney(profit)}`);
            }
          } catch (e) {
            log(ns, `Could not cover short ${sym}: ${e}`);
          }
        } else {
          waiting++;
          waitingBasis += shortShares * shortAvg;
        }
      }
    }

    if (waiting === 0) {
      tlog(ns, `\n=== DONE — flat. Realized P/L: ${totalRealized >= 0 ? "+" : ""}${formatMoney(totalRealized)} ===`);
      tlog(ns, "You're clear to install augmentations. (Daemon was stopped — it restarts automatically after a reset.)");
      return;
    }

    log(ns, `Waiting on ${waiting} position(s) to turn green (~${formatMoney(waitingBasis)} at cost). Realized so far: ${formatMoney(totalRealized)}. Run with 'now' to dump immediately.`);
    await ns.sleep(POLL_MS);
  }
}
