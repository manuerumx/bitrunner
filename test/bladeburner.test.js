import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BLADEBURNER_CITIES,
  pickBestCity,
  shouldSwitchCity,
  teamSizeFor,
} from "/src/advanced/bladeburner-manager.js";

function makeNs(cities) {
  return {
    bladeburner: {
      getCityEstimatedPopulation: (c) => cities[c]?.pop ?? 0,
      getCityChaos: (c) => cities[c]?.chaos ?? 0,
    },
  };
}

function allCities(overrides = {}) {
  const base = {};
  for (const c of BLADEBURNER_CITIES) base[c] = { pop: 1e6, chaos: 0 };
  return { ...base, ...overrides };
}

// ── pickBestCity ────────────────────────────────────────────────────────────
//
// The manager only ever ran Diplomacy in place when chaos got high. Population drives
// contract availability and success estimates, and chaos raises difficulty, so when a
// city is exhausted the answer is usually to move rather than to keep grinding it down.

test("pickBestCity prefers the most populous city when chaos is equal", () => {
  const ns = makeNs(allCities({ Aevum: { pop: 9e6, chaos: 0 } }));
  assert.equal(pickBestCity(ns).city, "Aevum");
});

test("pickBestCity avoids a populous city drowning in chaos", () => {
  const ns = makeNs(
    allCities({
      Aevum: { pop: 9e6, chaos: 500 },
      Chongqing: { pop: 5e6, chaos: 0 },
    })
  );
  assert.equal(pickBestCity(ns).city, "Chongqing");
});

test("pickBestCity reports the score it chose on", () => {
  const ns = makeNs(allCities({ Aevum: { pop: 2e6, chaos: 1 } }));
  const best = pickBestCity(ns);
  assert.equal(best.city, "Aevum");
  assert.equal(best.population, 2e6);
  assert.equal(best.chaos, 1);
});

// A city with nobody left in it produces nothing, regardless of how calm it is.
test("pickBestCity skips a depopulated city", () => {
  const ns = makeNs(allCities({ Sector12: { pop: 0, chaos: 0 } }));
  assert.notEqual(pickBestCity(ns).city, "Sector12");
});

// ── shouldSwitchCity ────────────────────────────────────────────────────────
//
// getCityEstimatedPopulation returns an *estimate*, and it jitters between calls. Without
// a margin, two comparable cities would trade places cycle to cycle and the manager would
// spend its time relocating instead of acting — each switch costs action time.

test("shouldSwitchCity moves when the new city is clearly better", () => {
  assert.equal(shouldSwitchCity({ currentScore: 100, bestScore: 200, margin: 1.25 }), true);
});

test("shouldSwitchCity holds position for a marginal improvement", () => {
  assert.equal(shouldSwitchCity({ currentScore: 100, bestScore: 110, margin: 1.25 }), false);
});

test("shouldSwitchCity holds position exactly at the margin", () => {
  assert.equal(shouldSwitchCity({ currentScore: 100, bestScore: 125, margin: 1.25 }), false);
});

test("shouldSwitchCity never moves to a worse city", () => {
  assert.equal(shouldSwitchCity({ currentScore: 200, bestScore: 100, margin: 1.25 }), false);
});

// A city we have drained to nothing scores zero, and any other city beats it.
test("shouldSwitchCity leaves a city scoring zero", () => {
  assert.equal(shouldSwitchCity({ currentScore: 0, bestScore: 1, margin: 1.25 }), true);
});

// ── teamSizeFor ─────────────────────────────────────────────────────────────
//
// Team members raise success chance on Operations and Black Ops, and cannot be assigned
// to Contracts or General actions at all.

test("teamSizeFor sends the full squad on Black Operations", () => {
  assert.equal(teamSizeFor("Black Operations", 10), 10);
});

test("teamSizeFor sends a squad on Operations", () => {
  assert.equal(teamSizeFor("Operations", 10), 10);
});

test("teamSizeFor sends nobody on Contracts", () => {
  assert.equal(teamSizeFor("Contracts", 10), 0);
});

test("teamSizeFor sends nobody on General actions", () => {
  assert.equal(teamSizeFor("General", 10), 0);
});

test("teamSizeFor cannot send more members than exist", () => {
  assert.equal(teamSizeFor("Operations", 0), 0);
});
