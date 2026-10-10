import { test } from "node:test";
import assert from "node:assert/strict";
import { main } from "/src/tools/corp-invest.js";
import { DEFAULTS, PORTS } from "/src/lib/constants.js";
import { SPENDING_HOLD_FILE } from "/src/lib/corp.js";
import { callsTo, makeCorpNs, makeDivision, makeOffice, makeWarehouse } from "./corp-mock.mjs";

const TRACK_FILE = "/data/corp-invest.txt";
// The mock corp makes 2m revenue against 1m expenses: 1m profit.
// A record watched a minute ago whose last growth was at the epoch: the 15-minute plateau has
// long passed.
const stale = (profit = 1e6) => JSON.stringify({ round: 1, profit, markAt: 0, seenAt: Date.now() - 60e3 });
const hold = (round, ageMs) => JSON.stringify({ round, since: Date.now() - ageMs });
const holdOf = (state) => JSON.parse(state.files[SPENDING_HOLD_FILE]);
const trackOf = (state) => JSON.parse(state.files[TRACK_FILE]);

test("the first look at a round records its profit and accepts nothing", async () => {
  const { ns, state } = makeCorpNs({ offer: { round: 1, funds: 100e9, shares: 1e8 } });
  await main(ns);
  assert.deepEqual(callsTo(state, "acceptInvestmentOffer"), []);
  assert.equal(trackOf(state).profit, 1e6);
});

// Valuation averages the last ~100 s of asset growth, and every purchase the other corp tools
// make cuts it. So once profit levels off, their spending stops first, and the offer is
// accepted later.
test("a profit that has stopped growing holds the corp's spending instead of accepting", async () => {
  const { ns, state } = makeCorpNs({
    offer: { round: 1, funds: 99e9, shares: 1e8 },
    files: { [TRACK_FILE]: stale() },
  });
  await main(ns);
  assert.deepEqual(callsTo(state, "acceptInvestmentOffer"), []);
  assert.equal(holdOf(state).round, 1);
  assert.ok(Date.now() - holdOf(state).since < 60e3);
});

test("a profit still growing keeps waiting", async () => {
  const { ns, state } = makeCorpNs({
    revenue: 3e6,
    offer: { round: 1, funds: 99e9, shares: 1e8 },
    files: { [TRACK_FILE]: stale() },
  });
  await main(ns);
  assert.equal(state.files[SPENDING_HOLD_FILE], undefined);
  assert.equal(trackOf(state).profit, 2e6);
  assert.ok(Date.now() - trackOf(state).markAt < 60e3);
});

// Each purchase knocks the offer ~15% for ~100 s. The wait must not track those swings, or
// it never ends: that is how round 3 sat for hours.
test("the offer's swings don't restart the wait", async () => {
  for (const funds of [20e9, 500e9]) {
    const { ns, state } = makeCorpNs({
      offer: { round: 1, funds, shares: 1e8 },
      files: { [TRACK_FILE]: stale() },
    });
    await main(ns);
    assert.equal(holdOf(state).round, 1, `offer ${funds}`);
  }
});

// The offer rises while spending is held; that rise is the point.
test("it accepts once spending has been held long enough", async () => {
  const { ns, state } = makeCorpNs({
    offer: { round: 1, funds: 130e9, shares: 1e8 },
    files: { [TRACK_FILE]: stale(), [SPENDING_HOLD_FILE]: hold(1, DEFAULTS.corpHoldSettleMs + 1000) },
  });
  await main(ns);
  assert.equal(callsTo(state, "acceptInvestmentOffer").length, 1);
  assert.equal(state.files[TRACK_FILE], "");
  assert.equal(state.files[SPENDING_HOLD_FILE], "");
});

test("it doesn't accept before the hold has settled", async () => {
  const record = hold(1, 60e3);
  const { ns, state } = makeCorpNs({
    offer: { round: 1, funds: 130e9, shares: 1e8 },
    files: { [TRACK_FILE]: stale(), [SPENDING_HOLD_FILE]: record },
  });
  await main(ns);
  assert.deepEqual(callsTo(state, "acceptInvestmentOffer"), []);
  assert.equal(state.files[SPENDING_HOLD_FILE], record);
});

// A round accepted by hand leaves the hold behind; it must neither accept the next round
// unwatched nor keep the corp from spending.
test("a hold from another round is lifted, not acted on", async () => {
  const { ns, state } = makeCorpNs({
    offer: { round: 2, funds: 300e9, shares: 1e8 },
    files: { [SPENDING_HOLD_FILE]: hold(1, DEFAULTS.corpHoldSettleMs + 1000) },
  });
  await main(ns);
  assert.deepEqual(callsTo(state, "acceptInvestmentOffer"), []);
  assert.equal(state.files[SPENDING_HOLD_FILE], "");
});

test("a lapsed hold starts over instead of accepting", async () => {
  const { ns, state } = makeCorpNs({
    offer: { round: 1, funds: 99e9, shares: 1e8 },
    files: { [TRACK_FILE]: stale(), [SPENDING_HOLD_FILE]: hold(1, DEFAULTS.corpHoldMaxMs + 1000) },
  });
  await main(ns);
  assert.deepEqual(callsTo(state, "acceptInvestmentOffer"), []);
  assert.ok(Date.now() - holdOf(state).since < 60e3);
});

// Unreadable, missing a field, or the offer-tracking record older versions wrote.
test("it treats a record it can't use as no record", async () => {
  const old = JSON.stringify({ round: 1, best: 9e10, mark: 9e10, markAt: 0, seenAt: Date.now() - 60e3 });
  for (const text of ["not json", JSON.stringify({ round: 1 }), old]) {
    const { ns, state } = makeCorpNs({
      offer: { round: 1, funds: 100e9, shares: 1e8 },
      files: { [TRACK_FILE]: text },
    });
    await main(ns);
    assert.equal(state.files[SPENDING_HOLD_FILE], undefined, text);
    assert.ok(Date.now() - trackOf(state).markAt < 60e3, text);
  }
});

// Offline time becomes bonus time, and the corporation doesn't move while the game is closed.
test("time the game was closed doesn't count as profit levelling off", async () => {
  const unwatched = JSON.stringify({ round: 1, profit: 1e6, markAt: 0, seenAt: 0 });
  const { ns, state } = makeCorpNs({ offer: { round: 1, funds: 99e9, shares: 1e8 }, files: { [TRACK_FILE]: unwatched } });
  await main(ns);
  assert.equal(state.files[SPENDING_HOLD_FILE], undefined);
  assert.ok(Date.now() - trackOf(state).markAt < 60e3);
});

// getBonusTime() is storedCycles × 200 ms, and a state runs every 10 cycles, so it reads
// 0–1800 ms during normal play. Real bonus time runs the corp faster, so a plateau timed by
// the clock covers more corp cycles, not fewer: it can't fake one.
test("bonus time doesn't hold back a round whose profit levelled off", async () => {
  for (const bonusTime of [1800, 3_600_000]) {
    const { ns, state } = makeCorpNs({
      bonusTime,
      offer: { round: 1, funds: 99e9, shares: 1e8 },
      files: { [TRACK_FILE]: stale() },
    });
    await main(ns);
    assert.equal(holdOf(state).round, 1, `bonus time ${bonusTime} ms`);
  }
});

// A corp whose offices or warehouses are failing earns a cheap offer that isn't the plateau
// of a healthy one: round 3 went for $39b with morale at 10 and every warehouse full.
const sick = (office, warehouse) => ({
  unlocks: ["Office API", "Warehouse API"],
  divisions: [makeDivision({
    offices: { "Sector-12": makeOffice({ numEmployees: 3, ...office }) },
    warehouses: { "Sector-12": makeWarehouse({ size: 1000, sizeUsed: 500, ...warehouse }) },
  })],
});

test("a corp in poor shape doesn't hold spending for a round", async () => {
  for (const [office, warehouse] of [[{ avgMorale: 10 }, {}], [{ avgEnergy: 10 }, {}], [{}, { sizeUsed: 1000 }]]) {
    const { ns, state } = makeCorpNs({
      ...sick(office, warehouse),
      offer: { round: 1, funds: 99e9, shares: 1e8 },
      files: { [TRACK_FILE]: stale() },
    });
    await main(ns);
    assert.equal(state.files[SPENDING_HOLD_FILE], undefined, JSON.stringify([office, warehouse]));
    assert.ok(state.log.some((line) => line.includes("poor shape")), JSON.stringify([office, warehouse]));
  }
});

test("a corp that falls into poor shape during the hold lifts it instead of accepting", async () => {
  const { ns, state } = makeCorpNs({
    ...sick({ avgMorale: 10 }, {}),
    offer: { round: 1, funds: 99e9, shares: 1e8 },
    files: { [TRACK_FILE]: stale(), [SPENDING_HOLD_FILE]: hold(1, DEFAULTS.corpHoldSettleMs + 1000) },
  });
  await main(ns);
  assert.deepEqual(callsTo(state, "acceptInvestmentOffer"), []);
  assert.equal(state.files[SPENDING_HOLD_FILE], "");
});

test("a corp in good shape still holds and accepts", async () => {
  const { ns, state } = makeCorpNs({
    ...sick({}, {}),
    offer: { round: 1, funds: 99e9, shares: 1e8 },
    files: { [TRACK_FILE]: stale(), [SPENDING_HOLD_FILE]: hold(1, DEFAULTS.corpHoldSettleMs + 1000) },
  });
  await main(ns);
  assert.equal(callsTo(state, "acceptInvestmentOffer").length, 1);
});

// A corporation making no profit sits at the valuation floor, so its offer is flat and cheap.
test("it neither tracks nor accepts while the corp makes no profit", async () => {
  const record = stale();
  const { ns, state } = makeCorpNs({
    revenue: 0,
    offer: { round: 1, funds: 99e9, shares: 1e8 },
    files: { [TRACK_FILE]: record },
  });
  await main(ns);
  assert.deepEqual(callsTo(state, "acceptInvestmentOffer"), []);
  assert.equal(state.files[TRACK_FILE], record);
  assert.equal(state.files[SPENDING_HOLD_FILE], undefined);
});

test("after the last round it goes public without issuing shares", async () => {
  const { ns, state } = makeCorpNs({ offer: { round: 5, funds: 0, shares: 0 } });
  await main(ns);
  assert.deepEqual(callsTo(state, "goPublic"), [[0]]);
});

test("once public it sets the dividend rate, once", async () => {
  const { ns, state } = makeCorpNs({ isPublic: true });
  await main(ns);
  await main(ns);
  assert.deepEqual(callsTo(state, "issueDividends"), [[0.1]]);
});

test("it publishes the corp's status", async () => {
  const { ns, state } = makeCorpNs({ funds: 7e9 });
  await main(ns);
  assert.deepEqual(JSON.parse(state.ports[PORTS.CORP_STATUS]), {
    revenue: 2e6, expenses: 1e6, profit: 1e6, funds: 7e9, divisions: 1,
  });
});

test("dry changes nothing and writes nothing", async () => {
  const record = stale();
  const { ns, state } = makeCorpNs({
    args: ["dry"],
    offer: { round: 1, funds: 99e9, shares: 1e8 },
    files: { [TRACK_FILE]: record },
  });
  await main(ns);
  assert.deepEqual(state.calls, []);
  assert.equal(state.files[TRACK_FILE], record);
  assert.equal(state.files[SPENDING_HOLD_FILE], undefined);
  assert.deepEqual(state.ports, {});
});

