import { DARKWEB_EXTRAS, DEFAULTS, PROGRAMS } from "/src/lib/constants.js";
import { selectProgramsToBuy } from "/src/lib/programs.js";
import { planPurchases } from "/src/lib/purchasing.js";
import { formatMoney, tlog } from "/src/lib/utils.js";

// Buys the TOR router, then the darkweb catalogue. See docs/API-COVERAGE-AUDIT.md §5.1 —
// rooter.js can only open as many ports as it has programs, and until now those were bought
// by hand, so root coverage stalled behind manual shopping.
//
// TWO TIERS, ONE WALLET. Port openers have no budget: every one is bought the moment the
// balance covers it, because each is a permanent unlock of servers the whole botnet then
// earns from, and the five together top out around $287m — a rounding error next to what
// the servers they root return. A budget share here was actively harmful: SQLInject.exe at
// $250m is 83% of a $300m wallet, so a 50% cap refused it on every five-minute burst and
// the 5-port servers stayed dark indefinitely. The non-opener extras still spend against
// DEFAULTS.programBudgetPercent — they unlock subsystems rather than servers, and
// Formulas.exe alone is $5b, enough to starve server-buyer.js and augmentation-buyer.js.
//
//   run /src/tools/program-buyer.js          buy the openers, then what the budget allows
//   run /src/tools/program-buyer.js dry      report what it would buy, buy nothing
//
// ONE-SHOT: does its job and exits. The daemon re-runs it every ~5 min (see MANAGERS
// `oneShot` in constants.js), so it must stay idempotent — the fileExists filter is what
// makes repeat runs no-ops.
//
// RAM, and why it is a one-shot rather than a manager. Singularity costs are multiplied
// 16/4/1 by Source-File 4 level:
//                              base    SF4.1    SF4.2   SF4.3
//   script base                1.6      1.6      1.6     1.6
//   ns.hasTorRouter            0.05     0.05     0.05    0.05   (top-level NS: NOT multiplied)
//   ns.fileExists              0.1      0.1      0.1     0.1
//   ns.getPlayer               0.5      0.5      0.5     0.5
//   singularity.purchaseTor    2       32        8       2
//   singularity.purchaseProgram 2      32        8       2
//   singularity.getDarkwebProgramCost 0.5  8     2       0.5
//                                   ─────────────────────────
//                                     74.25    20.25    6.75
// Holding 74 GB permanently for a job that finishes after seven purchases would cost more
// than DEFAULTS.reservedHomeRAM protects for the whole botnet.

/** @param {NS} ns */
export async function main(ns) {
  const dryRun = String(ns.args[0] ?? "").toLowerCase() === "dry";

  // hasTorRouter is the cheap gate (0.05 GB, unmultiplied). Checking via
  // getDarkwebPrograms() instead would cost 16 GB at SF4.1 for the same answer.
  if (!ns.hasTorRouter()) {
    if (dryRun) {
      tlog(ns, "program-buyer: no TOR router — would buy it first");
      return;
    }
    if (!ns.singularity.purchaseTor()) {
      tlog(ns, "program-buyer: can't afford the TOR router yet");
      return;
    }
    tlog(ns, "program-buyer: bought the TOR router");
  }

  // Port openers first (they unblock rooting), then the subsystem unlocks.
  const openerNames = PROGRAMS.map((p) => p.name);
  const catalog = [...openerNames, ...DARKWEB_EXTRAS];
  const owned = catalog.filter((name) => ns.fileExists(name, "home"));
  const wantedOpeners = selectProgramsToBuy(openerNames, owned);
  const wantedExtras = selectProgramsToBuy(DARKWEB_EXTRAS, owned);
  const wanted = [...wantedOpeners, ...wantedExtras];

  if (wanted.length === 0) {
    tlog(ns, "program-buyer: every darkweb program already owned");
    return;
  }

  // getDarkwebProgramCost throws for a name this BitNode's darkweb doesn't stock, and
  // returns -1 when it isn't purchasable — planPurchases skips negatives, so an absent
  // DarkscapeNavigator.exe costs us a skipped row rather than a failed run.
  /** @type {(names: readonly ProgramName[]) => {name: ProgramName, cost: number}[]} */
  const priceList = (names) => {
    /** @type {{name: ProgramName, cost: number}[]} */
    const items = [];
    for (const name of names) {
      try {
        items.push({ name, cost: ns.singularity.getDarkwebProgramCost(name) });
      } catch {
        // not sold here
      }
    }
    return items;
  };

  const openerItems = priceList(wantedOpeners);
  const extraItems = priceList(wantedExtras);

  const money = ns.getPlayer().money;
  // No reserve: cash is the only ceiling on a port opener.
  const openerPlan = planPurchases({ money, items: openerItems });
  // The extras' share is taken from what the openers left. Budgeting both tiers off the same
  // opening balance is how a run promises more than the wallet holds — the over-commit
  // planPurchases already guards against within a single list.
  const extraPlan = planPurchases({
    money: money - openerPlan.spend,
    reserveFraction: 1 - DEFAULTS.programBudgetPercent,
    items: extraItems,
  });
  const plan = {
    buy: [...openerPlan.buy, ...extraPlan.buy],
    spend: openerPlan.spend + extraPlan.spend,
  };

  if (plan.buy.length === 0) {
    const cheapest = (items) => items.filter((i) => i.cost >= 0).sort((a, b) => a.cost - b.cost)[0];
    // An opener out of reach and an extra held back are different problems with different
    // fixes — the first needs more income, the second only needs patience.
    const opener = cheapest(openerItems);
    const extra = cheapest(extraItems);
    const detail = opener
      ? `can't afford the next port opener yet (${opener.name} at ${formatMoney(opener.cost)})`
      : `holding back${extra ? ` ${extra.name} at ${formatMoney(extra.cost)}` : ""}` +
        ` — over this run's ${Math.round(DEFAULTS.programBudgetPercent * 100)}% share`;
    tlog(ns, `program-buyer: ${wanted.length} program(s) left, ${detail}`);
    return;
  }

  if (dryRun) {
    tlog(ns, `program-buyer: would buy ${plan.buy.length} for ${formatMoney(plan.spend)}`);
    for (const item of plan.buy) ns.tprint(`    ${item.name} — ${formatMoney(item.cost)}`);
    return;
  }

  let bought = 0;
  for (const item of plan.buy) {
    if (ns.singularity.purchaseProgram(item.name)) {
      bought++;
      tlog(ns, `program-buyer: bought ${item.name} for ${formatMoney(item.cost)}`);
    }
  }
  tlog(ns, `program-buyer: ${bought}/${plan.buy.length} bought, ${wanted.length - bought} left`);
}
