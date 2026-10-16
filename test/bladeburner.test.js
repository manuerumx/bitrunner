import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BLADEBURNER_CITIES,
  fallbackAction,
  pickBestCity,
  shouldSwitchCity,
  teamSizeFor,
} from "/src/advanced/bladeburner-manager.js";
import { bladeburnerHoldsPlayer } from "/src/lib/faction-work.js";
import { CONTRACTS_BY_REWARD, OPERATIONS_BY_REWARD, bestPayingAction } from "/src/lib/bladeburner.js";

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

// ── bladeburnerHoldsPlayer ──────────────────────────────────────────────────
//
// faction-manager.js restarts faction work every 30 s when getCurrentWork() looks idle, and
// getCurrentWork() never reports a Bladeburner action. Without The Blade's Simulacrum the
// two can't run together, so each cancelled the other and Bladeburner actions kept losing
// their progress.

test("bladeburnerHoldsPlayer is true while a Bladeburner action runs", () => {
  assert.equal(bladeburnerHoldsPlayer({ type: "Contracts", name: "Tracking" }, []), true);
});

test("bladeburnerHoldsPlayer is false with no Bladeburner action", () => {
  assert.equal(bladeburnerHoldsPlayer(null, []), false);
  assert.equal(bladeburnerHoldsPlayer({ type: "Idle", name: "Idle" }, []), false);
});

// The Blade's Simulacrum lets Bladeburner actions run alongside other work.
test("bladeburnerHoldsPlayer is false once The Blade's Simulacrum is installed", () => {
  const action = { type: "Operations", name: "Investigation" };
  assert.equal(bladeburnerHoldsPlayer(action, ["The Blade's Simulacrum"]), false);
});

// ── fallbackAction ──────────────────────────────────────────────────────────
//
// The manager judges every action on the low end of the game's estimate, and right after
// joining that estimate is wide (Tracking at "40.6% ~ 100.0%"), so nothing cleared its floor
// and it trained for hours. The width comes from the game's uncertainty about the city's
// population; Field Analysis narrows it, Training doesn't.

test("fallbackAction runs Field Analysis while an estimate is wide", () => {
  assert.deepEqual(fallbackAction([[0.406, 1], [0.2, 0.25]]), { type: "General", name: "Field Analysis" });
});

// A narrow estimate that still falls short means the stats are too low, which Training fixes.
test("fallbackAction trains once every estimate is narrow", () => {
  assert.deepEqual(fallbackAction([[0.4, 0.45], [0.2, 0.25]]), { type: "General", name: "Training" });
});

test("fallbackAction trains with nothing to estimate", () => {
  assert.deepEqual(fallbackAction([]), { type: "General", name: "Training" });
});

// ── bestPayingAction ────────────────────────────────────────────────────────
//
// The manager took the action with the highest success chance, which is always the easiest
// one, so it stayed on Tracking and Investigation however strong the player got. Rank is
// what unlocks the Black Ops, and the harder actions pay far more of it.

test("bestPayingAction takes the best-paying operation that clears the floor", () => {
  const candidates = [
    { name: "Investigation", chance: 1 },
    { name: "Undercover Operation", chance: 0.95 },
    { name: "Assassination", chance: 0.75 },
  ];
  assert.equal(bestPayingAction(candidates, OPERATIONS_BY_REWARD, 0.7), "Assassination");
});

test("bestPayingAction passes over a better-paying action below the floor", () => {
  const candidates = [
    { name: "Tracking", chance: 0.9 },
    { name: "Retirement", chance: 0.5 },
  ];
  assert.equal(bestPayingAction(candidates, CONTRACTS_BY_REWARD, 0.6), "Tracking");
});

// Raid and Sting Operation raise chaos, which lowers every success chance in the city.
test("bestPayingAction never takes an action left out of the order", () => {
  const candidates = [
    { name: "Raid", chance: 1 },
    { name: "Sting Operation", chance: 1 },
  ];
  assert.equal(bestPayingAction(candidates, OPERATIONS_BY_REWARD, 0.7), null);
});

test("bestPayingAction returns null when nothing clears the floor", () => {
  assert.equal(bestPayingAction([{ name: "Tracking", chance: 0.4 }], CONTRACTS_BY_REWARD, 0.6), null);
});
