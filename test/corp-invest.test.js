import { test } from "node:test";
import assert from "node:assert/strict";
import { main } from "/src/tools/corp-invest.js";
import { PORTS } from "/src/lib/constants.js";
import { callsTo, makeCorpNs } from "./corp-mock.mjs";

const TRACK_FILE = "/data/corp-invest.txt";
// A record whose last growth was at the epoch: the 15-minute plateau has long passed.
const stale = (best) => JSON.stringify({ round: 1, best, mark: best, markAt: 0 });

test("the first look at an offer records it and accepts nothing", async () => {
  const { ns, state } = makeCorpNs({ offer: { round: 1, funds: 100e9, shares: 1e8 } });
  await main(ns);
  assert.deepEqual(callsTo(state, "acceptInvestmentOffer"), []);
  assert.equal(JSON.parse(state.files[TRACK_FILE]).best, 100e9);
});

test("it accepts an offer that has stopped growing", async () => {
  const { ns, state } = makeCorpNs({
    offer: { round: 1, funds: 99e9, shares: 1e8 },
    files: { [TRACK_FILE]: stale(100e9) },
  });
  await main(ns);
  assert.equal(callsTo(state, "acceptInvestmentOffer").length, 1);
  assert.equal(state.files[TRACK_FILE], "");
});

test("it doesn't accept an offer that has dipped below the best", async () => {
  const { ns, state } = makeCorpNs({
    offer: { round: 1, funds: 90e9, shares: 1e8 },
    files: { [TRACK_FILE]: stale(100e9) },
  });
  await main(ns);
  assert.deepEqual(callsTo(state, "acceptInvestmentOffer"), []);
});

test("it treats an unreadable record as no record", async () => {
  const { ns, state } = makeCorpNs({
    offer: { round: 1, funds: 100e9, shares: 1e8 },
    files: { [TRACK_FILE]: "not json" },
  });
  await main(ns);
  assert.deepEqual(callsTo(state, "acceptInvestmentOffer"), []);
  assert.equal(JSON.parse(state.files[TRACK_FILE]).best, 100e9);
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
  const { ns, state } = makeCorpNs({
    args: ["dry"],
    offer: { round: 1, funds: 99e9, shares: 1e8 },
    files: { [TRACK_FILE]: stale(100e9) },
  });
  await main(ns);
  assert.deepEqual(state.calls, []);
  assert.equal(state.files[TRACK_FILE], stale(100e9));
  assert.deepEqual(state.ports, {});
});

