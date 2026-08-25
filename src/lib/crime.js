// Crime selection. Fills the "no crime" Singularity gap in docs/API-COVERAGE-AUDIT.md §2.
//
// WHY TWO CONSTANT TABLES. Ranking crimes needs money, success chance, duration and karma.
// ns.formulas.work.crimeSuccessChance + crimeGains give the first two for 0 GB, but a
// WorkStats carries only money and exp — there is no `time` and no `karma` on it. The one
// API with all four is singularity.getCrimeStats, at 5 GB × 16/4/1 — 80 GB at SF4.1, which
// is most of what the whole crime worker costs. Durations and karma are fixed game
// constants, so a table is the same answer for free. Same trade lib/gang.js makes with
// legacyBestTask.
//
// The tables are not trusted blindly: commitCrime() returns the real duration, and
// tools/crime-worker.js compares it against TIME_MS and logs a warning on a mismatch. A
// fork or a rebalance shows up as a log line instead of as a silently mis-ranked crime.

/**
 * Crime duration in milliseconds. Fixed constants — nothing scales them.
 * @type {Record<string, number>}
 */
export const CRIME_TIME_MS = {
  Shoplift: 2_000,
  "Rob Store": 60_000,
  Mug: 4_000,
  Larceny: 90_000,
  "Deal Drugs": 10_000,
  "Bond Forgery": 300_000,
  "Traffick Arms": 40_000,
  Homicide: 3_000,
  "Grand Theft Auto": 80_000,
  Kidnap: 120_000,
  Assassination: 300_000,
  Heist: 600_000,
};

/**
 * Karma lost per SUCCESSFUL attempt. Negative karma is what gates gang creation
 * (-54,000), which is the reason a karma ranking mode exists at all.
 * @type {Record<string, number>}
 */
export const CRIME_KARMA = {
  Shoplift: 0.1,
  "Rob Store": 0.25,
  Mug: 0.25,
  Larceny: 1.5,
  "Deal Drugs": 0.5,
  "Bond Forgery": 0.1,
  "Traffick Arms": 1,
  Homicide: 3,
  "Grand Theft Auto": 5,
  Kidnap: 6,
  Assassination: 10,
  Heist: 15,
};

/**
 * Crimes we know the duration of — the only ones rankable.
 * Cast to CrimeType (see globals.d.ts) so call sites can pass these straight to the
 * singularity and formulas APIs without re-asserting at each one.
 * @type {CrimeType[]}
 */
export const KNOWN_CRIMES = /** @type {CrimeType[]} */ (Object.keys(CRIME_TIME_MS));

/**
 * Rank crimes by expected yield per second: (yield × success chance) ÷ duration.
 *
 * Expected value per SECOND, not per attempt, is the whole point, and all three inputs
 * pull. Heist pays ~2,700x Homicide per attempt and still loses early on, because it needs
 * 600 s to Homicide's 3 s AND lands at a success chance near zero until combat stats are
 * enormous. Ranking on payout alone is the mistake that makes a crime script look busy and
 * earn nothing.
 *
 * A BitNode's CrimeMoney multiplier scales every crime's money by the same constant, so it
 * cannot reorder this list — it changes the printed rate, never the pick. That holds
 * whether or not formulas.crimeGains has already applied it.
 *
 * @param {Array<{name: string, money: number, chance: number}>} candidates
 * @param {{goal?: "money" | "karma"}} [opts]
 * @returns {Array<{name: string, money: number, chance: number, timeMs: number, karma: number, perSecond: number}>}
 */
export function rankCrimes(candidates, { goal = "money" } = {}) {
  return candidates
    .filter((c) => CRIME_TIME_MS[c.name] !== undefined)
    .map((c) => {
      const timeMs = CRIME_TIME_MS[c.name];
      const karma = CRIME_KARMA[c.name] ?? 0;
      const perAttempt = goal === "karma" ? karma : c.money;
      return { ...c, timeMs, karma, perSecond: (perAttempt * c.chance) / (timeMs / 1000) };
    })
    // Tie-break on the shorter crime: equal rates but faster feedback means stat gains
    // land sooner, which raises the success chance of everything above it.
    .sort((a, b) => b.perSecond - a.perSecond || a.timeMs - b.timeMs);
}

/**
 * Which crime should be running, given what already is.
 *
 * The switch margin is not a nicety, it is the correctness fix. A player crime is a
 * CrimeTask extending PlayerBaseTask — it accumulates `cyclesWorked` toward a payout, and
 * re-issuing commitCrime() resets that to zero. Success chances drift upward as combat
 * stats grow, so two near-tied crimes will trade places cycle after cycle; without a
 * margin the worker would cancel and restart forever and bank nothing. This is the same
 * trap needsReassignment() guards sleeves against in advanced/sleeve-manager.js.
 *
 * @param {Array<{name: string, perSecond: number}>} ranked  output of rankCrimes
 * @param {string | null} currentCrime  crime already running, or null
 * @param {{switchMargin?: number}} [opts]
 * @returns {CrimeType | null} crime that should be running, or null if nothing is rankable
 */
export function selectNextCrime(ranked, currentCrime, { switchMargin = 0.1 } = {}) {
  const best = ranked[0];
  if (!best) return null;

  const current = ranked.find((c) => c.name === currentCrime);
  const pick = !current
    ? best.name
    // Only abandon a running crime for a clearly better one, never a marginally better one.
    : best.perSecond > current.perSecond * (1 + switchMargin)
      ? best.name
      : current.name;

  return /** @type {CrimeType} */ (pick);
}

/**
 * Does commitCrime() need to be called at all?
 *
 * Written as a reconciler rather than a re-issuer, which is correct under either crime
 * semantics: if player crimes auto-repeat, this never interrupts a running one; if each
 * commitCrime is a single attempt, getCurrentWork() reads null when it ends and this
 * re-issues on the next tick. The naive `while (true) { commitCrime(...) }` loop is only
 * correct under the second, and earns zero under the first.
 *
 * @param {{type?: string, crimeType?: string} | null} currentWork  ns.singularity.getCurrentWork()
 * @param {string} desiredCrime
 */
export function needsRecommit(currentWork, desiredCrime) {
  if (!currentWork || currentWork.type !== "CRIME") return true;
  return currentWork.crimeType !== desiredCrime;
}

/**
 * Crime pick when Formulas.exe is not owned, so no success chance is available.
 *
 * Deliberately a coarse ladder rather than a reimplementation of the game's success
 * formula — the same call lib/gang.js makes in legacyBestTask. A hand-derived
 * approximation would be a guess dressed up as an improvement.
 *
 * Karma always answers Homicide: at 3 karma per 3 s it beats every alternative on
 * karma/sec by a margin no plausible success chance closes (Mug is 0.25 per 4 s, so
 * Homicide wins even at a 5% chance against Mug's 100%).
 *
 * @param {{strength: number, defense: number, dexterity: number, agility: number}} skills
 * @param {{goal?: "money" | "karma"}} [opts]
 * @returns {CrimeType}
 */
export function fallbackCrime(skills, { goal = "money" } = {}) {
  if (goal === "karma") return "Homicide";

  const avgCombat = (skills.strength + skills.defense + skills.dexterity + skills.agility) / 4;
  // Homicide pays 45k/3s against Mug's 36k/4s, so it wins on rate the moment its success
  // chance is within striking distance of Mug's — which is roughly where combat stats
  // clear the double digits.
  return avgCombat >= 50 ? "Homicide" : "Mug";
}

/**
 * Karma needed to create a gang (ns.gang.createGang). Negative — karma counts down.
 *
 * The only reason the "karma" ranking goal exists. advanced/gang-manager.js gates on
 * ns.gang.inGang() and never creates one, so reaching this number is currently a manual
 * step; the worker reports progress toward it so you know when to take it.
 */
export const GANG_KARMA_REQUIREMENT = -54_000;
