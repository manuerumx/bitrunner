import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CRIME_KARMA,
  GANG_KARMA_REQUIREMENT,
  CRIME_TIME_MS,
  crimeSuccessChance,
  fallbackCrime,
  pickAchievableCrime,
  needsRecommit,
  rankCrimes,
  selectNextCrime,
} from "/src/lib/crime.js";

function crime(name, money, chance) {
  return { name, money, chance };
}

// --- rankCrimes -------------------------------------------------------------------

// Isolating duration: identical money and chance, so only the clock separates them.
// Ranking on payout per attempt is the mistake that makes a crime script look busy and
// earn nothing.
test("rankCrimes ranks on yield per second, not payout per attempt", () => {
  const ranked = rankCrimes([crime("Larceny", 100_000, 1), crime("Mug", 100_000, 1)]);
  assert.deepEqual(ranked.map((c) => c.name), ["Mug", "Larceny"]);
});

test("rankCrimes discounts by success chance", () => {
  // Same money and duration; only the chance differs.
  const ranked = rankCrimes([crime("Mug", 36_000, 0.2), crime("Mug", 36_000, 0.9)]);
  assert.equal(ranked[0].chance, 0.9);
});

// The realistic early-run comparison, and the one the worker actually faces: Heist's huge
// payout is gated behind a success chance near zero, which is what sinks its rate.
test("rankCrimes prefers Homicide over Heist at realistic early success chances", () => {
  const ranked = rankCrimes([crime("Heist", 120_000_000, 0.001), crime("Homicide", 45_000, 0.5)]);
  assert.equal(ranked[0].name, "Homicide");
});

// ...and does NOT pretend Heist is always worse. Once the chance gap closes, the payout
// wins, which is exactly why this is arithmetic and not a hardcoded "always Homicide".
test("rankCrimes prefers Heist once its success chance catches up", () => {
  const ranked = rankCrimes([crime("Heist", 120_000_000, 0.5), crime("Homicide", 45_000, 1)]);
  assert.equal(ranked[0].name, "Heist");
});

test("rankCrimes reports the per-second rate it sorted on", () => {
  const [only] = rankCrimes([crime("Homicide", 45_000, 0.5)]);
  // 45,000 x 0.5 over 3 s
  assert.equal(only.perSecond, 7_500);
  assert.equal(only.timeMs, 3_000);
});

test("rankCrimes ranks on karma per second when that is the goal", () => {
  // Grand Theft Auto has more karma per attempt (5 vs 3) but takes 80 s to Homicide's 3 s.
  const ranked = rankCrimes([crime("Grand Theft Auto", 1_600_000, 1), crime("Homicide", 45_000, 1)], {
    goal: "karma",
  });
  assert.equal(ranked[0].name, "Homicide");
});

// The two goals genuinely disagree, which is why the mode exists. Heist wins on money
// per second at an equal chance; Homicide wins on karma per second by 40x.
test("rankCrimes flips its answer between the money and karma goals", () => {
  const candidates = [crime("Heist", 120_000_000, 1), crime("Homicide", 45_000, 1)];
  assert.equal(rankCrimes(candidates, { goal: "money" })[0].name, "Heist");
  assert.equal(rankCrimes(candidates, { goal: "karma" })[0].name, "Homicide");
});

// A fork adding a crime the tables don't know would otherwise divide by undefined and
// sort NaN to an arbitrary position.
test("rankCrimes drops crimes it has no duration for", () => {
  const ranked = rankCrimes([crime("Jaywalking", 1e12, 1), crime("Mug", 36_000, 1)]);
  assert.deepEqual(ranked.map((c) => c.name), ["Mug"]);
});

test("rankCrimes breaks ties toward the shorter crime", () => {
  // Rob Store: 60s. Larceny: 90s. Money chosen so both score 1000/s.
  const ranked = rankCrimes([crime("Larceny", 90_000, 1), crime("Rob Store", 60_000, 1)]);
  assert.deepEqual(ranked.map((c) => c.name), ["Rob Store", "Larceny"]);
});

test("rankCrimes returns nothing for no candidates", () => {
  assert.deepEqual(rankCrimes([]), []);
});

// --- selectNextCrime --------------------------------------------------------------

// The correctness fix. A player crime accumulates cyclesWorked toward a payout and
// re-issuing commitCrime() resets it to zero, so two near-tied crimes trading places every
// cycle would cancel and restart forever and bank nothing.
test("selectNextCrime keeps the running crime when the best is only marginally better", () => {
  const ranked = [
    { name: "Homicide", perSecond: 105 },
    { name: "Mug", perSecond: 100 },
  ];
  assert.equal(selectNextCrime(ranked, "Mug"), "Mug");
});

test("selectNextCrime switches when the best clears the margin", () => {
  const ranked = [
    { name: "Homicide", perSecond: 200 },
    { name: "Mug", perSecond: 100 },
  ];
  assert.equal(selectNextCrime(ranked, "Mug"), "Homicide");
});

test("selectNextCrime honours a custom switch margin", () => {
  const ranked = [
    { name: "Homicide", perSecond: 105 },
    { name: "Mug", perSecond: 100 },
  ];
  assert.equal(selectNextCrime(ranked, "Mug", { switchMargin: 0.01 }), "Homicide");
});

test("selectNextCrime takes the best when nothing is running", () => {
  const ranked = [
    { name: "Homicide", perSecond: 200 },
    { name: "Mug", perSecond: 100 },
  ];
  assert.equal(selectNextCrime(ranked, null), "Homicide");
});

// The running crime dropping off the rankable list (e.g. started by hand) must not pin
// the worker to a crime it can no longer score.
test("selectNextCrime takes the best when the running crime is unrankable", () => {
  const ranked = [{ name: "Homicide", perSecond: 200 }];
  assert.equal(selectNextCrime(ranked, "Jaywalking"), "Homicide");
});

test("selectNextCrime returns null when nothing is rankable", () => {
  assert.equal(selectNextCrime([], "Mug"), null);
});

// --- needsRecommit ----------------------------------------------------------------

test("needsRecommit leaves a correctly running crime alone", () => {
  assert.equal(needsRecommit({ type: "CRIME", crimeType: "Homicide" }, "Homicide"), false);
});

test("needsRecommit re-issues when the wrong crime is running", () => {
  assert.equal(needsRecommit({ type: "CRIME", crimeType: "Mug" }, "Homicide"), true);
});

test("needsRecommit re-issues when idle", () => {
  assert.equal(needsRecommit(null, "Homicide"), true);
});

// faction-manager.js calls workForFaction() every 30 s, which cancels a crime outright.
test("needsRecommit re-issues when something else took the player over", () => {
  assert.equal(needsRecommit({ type: "FACTION", factionName: "Sector-12" }, "Homicide"), true);
  assert.equal(needsRecommit({ type: "GRAFTING" }, "Homicide"), true);
});

// --- fallbackCrime ----------------------------------------------------------------

function skills(n) {
  return { strength: n, defense: n, dexterity: n, agility: n };
}

test("fallbackCrime mugs while combat stats are low", () => {
  assert.equal(fallbackCrime(skills(10)), "Mug");
});

test("fallbackCrime moves to Homicide once combat stats carry it", () => {
  assert.equal(fallbackCrime(skills(200)), "Homicide");
});

// Homicide is 3 karma per 3 s against Mug's 0.25 per 4 s — a 48x rate edge that no
// plausible success chance closes, so the karma goal needs no stat ladder at all.
test("fallbackCrime always answers Homicide for karma", () => {
  assert.equal(fallbackCrime(skills(1), { goal: "karma" }), "Homicide");
  assert.equal(fallbackCrime(skills(500), { goal: "karma" }), "Homicide");
});

// --- tables -----------------------------------------------------------------------

test("every crime with a duration also has a karma value", () => {
  assert.deepEqual(Object.keys(CRIME_TIME_MS).sort(), Object.keys(CRIME_KARMA).sort());
});

test("crime durations are all positive", () => {
  for (const [name, ms] of Object.entries(CRIME_TIME_MS)) {
    assert.ok(ms > 0, `${name} has a non-positive duration`);
  }
});

// --- gang threshold ---------------------------------------------------------------

test("the gang karma requirement is negative — karma counts down", () => {
  assert.ok(GANG_KARMA_REQUIREMENT < 0);
});

// --- crimeSuccessChance -----------------------------------------------------------
//
// A local port of the game's formula, so a success chance exists without Formulas.exe.
// Sleeves need it: without a chance the manager parked fresh sleeves on Homicide at well
// under 1%, where they loop and never land one.

const person = (n, extra = {}) => ({
  skills: { strength: n, defense: n, dexterity: n, agility: n },
  ...extra,
});

test("crimeSuccessChance weights skills, divides by 975 and by the crime's difficulty", () => {
  // Homicide: 2 str + 2 def + 0.5 dex + 0.5 agi, difficulty 1.
  assert.ok(Math.abs(crimeSuccessChance(person(1), "Homicide") - 5 / 975) < 1e-9);
  assert.ok(Math.abs(crimeSuccessChance(person(100), "Homicide") - 500 / 975) < 1e-9);
  // Shoplift: dex + agi, difficulty 1/20.
  assert.ok(Math.abs(crimeSuccessChance(person(5), "Shoplift") - (10 / 975) * 20) < 1e-9);
});

test("crimeSuccessChance caps at 1 and applies the crime_success multiplier", () => {
  assert.equal(crimeSuccessChance(person(100), "Mug"), 1);
  const boosted = person(1, { mults: { crime_success: 2 } });
  assert.ok(Math.abs(crimeSuccessChance(boosted, "Homicide") - 10 / 975) < 1e-9);
});

test("crimeSuccessChance is 0 for a crime it has no weights for", () => {
  assert.equal(crimeSuccessChance(person(500), "Jaywalking"), 0);
});

// --- pickAchievableCrime ----------------------------------------------------------

// Pure expected value still picks Homicide for karma at a 1% chance, which is the crime
// that "runs and runs" and never commits. The floor restricts the ranking to crimes the
// sleeve can actually land.
test("pickAchievableCrime ranks only crimes at or above the success floor", () => {
  const candidates = [crime("Homicide", 45_000, 0.2), crime("Mug", 36_000, 0.9), crime("Shoplift", 15_000, 1)];
  assert.equal(pickAchievableCrime(candidates, null, { goal: "karma", minChance: 0.5 }), "Mug");
  candidates[0].chance = 0.5;
  assert.equal(pickAchievableCrime(candidates, null, { goal: "karma", minChance: 0.5 }), "Homicide");
});

// Nothing clears the floor on a fresh sleeve. The likeliest crime is the one that pays
// full exp most often, so it is how the sleeve trains its way up to the floor.
test("pickAchievableCrime takes the likeliest crime when none clears the floor", () => {
  const candidates = [crime("Homicide", 45_000, 0.01), crime("Mug", 36_000, 0.02), crime("Shoplift", 15_000, 0.04)];
  assert.equal(pickAchievableCrime(candidates, null, { goal: "karma", minChance: 0.5 }), "Shoplift");
});

test("pickAchievableCrime keeps the running crime unless another is clearly better", () => {
  const near = [crime("Homicide", 45_000, 0.68), crime("Mug", 36_000, 1)];
  // Money: Homicide 10.2k/s vs Mug 9k/s — 13% better, past the 10% margin.
  assert.equal(pickAchievableCrime(near, "Mug", { minChance: 0.5 }), "Homicide");
  near[0].chance = 0.62; // 9.3k/s, only 3% better
  assert.equal(pickAchievableCrime(near, "Mug", { minChance: 0.5 }), "Mug");
  // Below the floor too: don't flip between two near-tied long shots.
  const weak = [crime("Mug", 36_000, 0.105), crime("Shoplift", 15_000, 0.1)];
  assert.equal(pickAchievableCrime(weak, "Shoplift", { minChance: 0.5 }), "Shoplift");
});

test("pickAchievableCrime returns null with nothing to rank", () => {
  assert.equal(pickAchievableCrime([], null), null);
});
