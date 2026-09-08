import { test } from "node:test";
import assert from "node:assert/strict";
import { main } from "/src/tools/program-buyer.js";

// Port openers are the bottleneck on root coverage — rooter.js can only open as many ports
// as it has programs — so they are bought the moment the wallet covers them, with no budget
// share held back. The non-opener extras (Formulas.exe, DarkscapeNavigator.exe) unlock
// subsystems rather than servers and cost orders of magnitude more, so they still spend
// against DEFAULTS.programBudgetPercent.

const TOR_COST = 200e3;

// Vanilla darkweb prices. The five openers total $287m — cheap enough that "buy them
// immediately" never meaningfully competes with server-buyer.js, which is the whole point.
const COSTS = {
  "BruteSSH.exe": 500e3,
  "FTPCrack.exe": 1.5e6,
  "relaySMTP.exe": 5e6,
  "HTTPWorm.exe": 30e6,
  "SQLInject.exe": 250e6,
  "Formulas.exe": 5e9,
  "DarkscapeNavigator.exe": 1e9,
};

const OPENERS = ["BruteSSH.exe", "FTPCrack.exe", "relaySMTP.exe", "HTTPWorm.exe", "SQLInject.exe"];

const OPENER_TOTAL = OPENERS.reduce((sum, name) => sum + COSTS[name], 0);

/**
 * Minimal Bitburner mock. `costs` doubles as the darkweb stock list: a name missing from it
 * makes getDarkwebProgramCost throw, which is how the game reports a program this BitNode
 * doesn't sell.
 */
function makeMockNs({ money, owned = [], costs = COSTS, hasTor = true, args = [] }) {
  const state = { money, tor: hasTor };
  const purchases = [];
  const logs = [];
  const files = new Set(owned);

  const ns = {
    args,
    disableLog() {},
    print(msg) {
      logs.push(String(msg));
    },
    tprint(msg) {
      logs.push(String(msg));
    },
    hasTorRouter: () => state.tor,
    fileExists: (name, host) => host === "home" && files.has(name),
    getPlayer: () => ({ money: state.money }),
    singularity: {
      purchaseTor() {
        if (state.money < TOR_COST) return false;
        state.money -= TOR_COST;
        state.tor = true;
        return true;
      },
      getDarkwebProgramCost(name) {
        if (!(name in costs)) throw new Error(`${name} is not sold on this darkweb`);
        return costs[name];
      },
      purchaseProgram(name) {
        const cost = costs[name];
        if (cost === undefined || cost < 0) return false;
        if (state.money < cost) return false;
        state.money -= cost;
        files.add(name);
        purchases.push(name);
        return true;
      },
    },
  };

  return { ns, purchases, logs, state };
}

// ── Port openers: no budget ─────────────────────────────────────────────────

// The regression this whole change exists for. SQLInject is $250m of a $300m wallet — 83%,
// so the old `reserveFraction: 1 - programBudgetPercent` capped the run at $150m and refused
// it every five minutes forever, leaving the 5-port servers unrooted.
test("buys a port opener costing more than half the wallet", async () => {
  const { ns, purchases } = makeMockNs({ money: 300e6 });

  await main(ns);

  assert.ok(purchases.includes("SQLInject.exe"), "SQLInject must not be held back by a budget");
});

test("buys every port opener in one run when the wallet covers them", async () => {
  const { ns, purchases } = makeMockNs({ money: 300e6 });

  await main(ns);

  assert.deepEqual(
    purchases.filter((name) => OPENERS.includes(name)),
    OPENERS,
    "all five openers, cheapest first",
  );
});

// No budget still is not unlimited: cash is the only ceiling, and an opener out of reach is
// skipped rather than stopping the walk, so cheaper openers still land.
test("buys the openers cash covers and skips the ones it does not", async () => {
  const { ns, purchases } = makeMockNs({ money: 10e6 });

  await main(ns);

  assert.deepEqual(purchases, ["BruteSSH.exe", "FTPCrack.exe", "relaySMTP.exe"]);
});

// ── Extras: still budgeted ──────────────────────────────────────────────────

test("holds back an extra the budget share does not cover", async () => {
  const { ns, purchases } = makeMockNs({ money: 8e9, owned: OPENERS });

  await main(ns);

  assert.ok(
    !purchases.includes("Formulas.exe"),
    "$5b Formulas.exe exceeds the 50% share of an $8b wallet",
  );
  assert.ok(purchases.includes("DarkscapeNavigator.exe"), "the affordable extra still lands");
});

test("buys an extra once the budget share covers it", async () => {
  const { ns, purchases } = makeMockNs({ money: 12e9, owned: OPENERS });

  await main(ns);

  assert.deepEqual(purchases, ["Formulas.exe", "DarkscapeNavigator.exe"]);
});

// The two tiers spend one wallet. Budgeting the extras off the pre-opener balance would let
// the run promise more than it holds — the same over-commit planPurchases guards against
// within a single list.
test("budgets the extras against what the openers left, not the opening balance", async () => {
  // $10.1b: half the opening balance ($5.05b) covers Formulas.exe, half of what the openers
  // leave ($4.91b) does not.
  const { ns, purchases } = makeMockNs({ money: 10.1e9 });

  await main(ns);

  assert.ok(
    OPENERS.every((name) => purchases.includes(name)),
    "openers are bought first",
  );
  assert.ok(
    !purchases.includes("Formulas.exe"),
    "the extras budget must be computed after the openers commit",
  );
});

test("buys the openers before the extras", async () => {
  const { ns, purchases } = makeMockNs({ money: 20e9 });

  await main(ns);

  assert.ok(
    purchases.indexOf("SQLInject.exe") < purchases.indexOf("Formulas.exe"),
    "rooting is the more urgent bottleneck",
  );
});

// ── Existing behaviour that must survive the change ─────────────────────────

test("skips a program this darkweb does not stock", async () => {
  const costs = { ...COSTS };
  delete costs["DarkscapeNavigator.exe"];
  const { ns, purchases } = makeMockNs({ money: 20e9, costs });

  await main(ns);

  assert.ok(purchases.includes("Formulas.exe"), "an absent program costs a row, not the run");
  assert.ok(!purchases.includes("DarkscapeNavigator.exe"));
});

// One-shot: the daemon re-runs it about three times per burst, so a repeat run must be a no-op.
test("buys nothing when every program is already owned", async () => {
  const { ns, purchases } = makeMockNs({
    money: 20e9,
    owned: [...OPENERS, "Formulas.exe", "DarkscapeNavigator.exe"],
  });

  await main(ns);

  assert.deepEqual(purchases, []);
});

test("a dry run buys nothing", async () => {
  const { ns, purchases, state } = makeMockNs({ money: 20e9, args: ["dry"] });

  await main(ns);

  assert.deepEqual(purchases, []);
  assert.equal(state.money, 20e9);
});

test("buys the TOR router first, then shops in the same run", async () => {
  const { ns, purchases } = makeMockNs({ money: 300e6, hasTor: false });

  await main(ns);

  assert.ok(purchases.includes("SQLInject.exe"), "shopping continues once TOR is bought");
});

// "None within budget" is the wrong words for an opener now that openers have no budget —
// they are unaffordable, which is a different problem with a different fix.
test("reports an unaffordable opener as unaffordable, not as over budget", async () => {
  const { ns, logs } = makeMockNs({ money: 100e3 });

  await main(ns);

  const report = logs.join("\n");
  assert.match(report, /can't afford/i);
  assert.doesNotMatch(report, /budget/i);
});
