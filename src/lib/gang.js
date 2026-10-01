// Gang ranking logic. See docs/API-COVERAGE-AUDIT.md §5.8.
//
// Gains are always supplied by the caller and never derived here. With Formulas.exe on
// home, gang-manager.js gets them from ns.formulas.gang.moneyGain/respectGain/
// wantedLevelGain, which are exact and take precisely the three objects it already has.
// Without Formulas.exe it keeps its existing hardcoded task ladder — an invented scaling
// formula would be a guess, and a guess is worse than the ladder it replaced.

// Which member stats a gang can actually convert into output. Combat gangs get nothing
// from hacking gear and vice versa, so equipment is scored against only the relevant set.
const COMBAT_STATS = ["str", "def", "dex", "agi"];
const HACK_STATS = ["hack"];

// Members train until the stats their gang uses reach this × their ascension multiplier.
// Stat level is linear in the multiplier, so this costs an ascended member the same exp as
// an unascended one reaching this bar. Stats the gang doesn't use stay at a flat bar.
const TRAIN_BASE = 100;

// Ascend once the stats this gang uses would grow by this factor.
const ASCEND_THRESHOLD = 1.5;

// Clashes are only engaged at this win chance against every rival that holds territory.
const WARFARE_WIN_THRESHOLD = 0.55;

// Keep building power until every territory-holding rival is beaten at this chance. Set
// above the engage threshold so a gang that has just started clashing keeps getting
// stronger instead of sitting at a coin-flip while NPC gangs keep growing.
const POWER_TARGET = 0.8;

// Share of the roster (the strongest members) that builds power. Territory Warfare earns
// nothing, so the rest keep earning.
const POWER_SHARE = 1 / 2;

// Power gain per territory tick, from bitburner-src Gang.processTerritoryAndPowerGains.
// The player gains POWER_GAIN_RATE × max(0.002, territory) × Σ member power. Each NPC gang
// gains, with equal odds, min(0.85, 0.5% of its power) or 0.75 × roll × territory ×
// its multiplier (roll uniform in [0.5, 1)). Rivals are judged on the capped 0.85, which
// they hit within about an hour, so a gang isn't sent to build against a rival it only
// out-grows while that rival is still small.
const POWER_GAIN_RATE = 0.015;
const NPC_POWER_MULT = {
  "Slum Snakes": 1,
  Tetrads: 2,
  "The Syndicate": 2,
  "The Dark Army": 2,
  "Speakers for the Dead": 5,
  NiteSec: 2,
  "The Black Hand": 5,
};
const NPC_MAX_POWER_MULT = 5;

// Task ladders used without Formulas.exe. setMemberTask quietly sets a member to
// "Unassigned" when given a task outside its gang type, so each type needs its own names.
// The hacking ladder mirrors the combat one rung for rung (the entry-level earner, the
// high-wanted top earner, the wanted reducer) rather than being separately tuned.
const LADDERS = {
  combat: { wanted: "Vigilante Justice", early: "Mug People", late: "Human Trafficking" },
  hacking: { wanted: "Ethical Hacking", early: "Phishing", late: "Money Laundering" },
};

// Share of a growing roster that chases respect (which unlocks recruits) instead of money.
// The top respect task earns nothing, so the whole roster on it means no income at all.
const RESPECT_SHARE = 1 / 3;

// Recruits are named Runner-0, Runner-1, … — see nextMemberName.
const MEMBER_PREFIX = "Runner-";

/**
 * Best task for one member, given per-task gain estimates.
 *
 * @param {Array<{name: string, money: number, respect: number, wanted: number}>} tasks
 * @param {{needWantedReduction?: boolean, preferRespect?: boolean}} opts
 * @returns {string | null} null when no task produces anything (e.g. only training is
 *   available, which earns nothing) — the caller applies its own rule then.
 */
export function selectBestTask(tasks, { needWantedReduction = false, preferRespect = false } = {}) {
  if (tasks.length === 0) return null;

  // A wanted penalty throttles every member's output at once, so clearing it outranks
  // earning. Only worth doing if something on the list actually reduces wanted level.
  if (needWantedReduction) {
    const reducers = tasks.filter((t) => t.wanted < 0);
    if (reducers.length > 0) {
      return reducers.reduce((best, t) => (t.wanted < best.wanted ? t : best)).name;
    }
    // Nothing reduces wanted — fall through and earn rather than idle.
  }

  const key = preferRespect ? "respect" : "money";
  const productive = tasks.filter((t) => t[key] > 0);
  if (productive.length === 0) return null;

  return productive.reduce((best, t) => (t[key] > best[key] ? t : best)).name;
}

/**
 * Equipment worth buying, best stat gain per dollar first.
 *
 * buyEquipment previously bought anything under 1% of cash in catalogue order, which
 * spends a combat gang's money on charisma and hacking gear. Stats are multipliers, so
 * value is the gain above 1.0 summed over the stats this gang can use.
 *
 * @param {Array<{name: string, type: string, cost: number,
 *   stats: {str?: number, def?: number, dex?: number, agi?: number, cha?: number, hack?: number}}>} equipment
 *   `stats` is ns.gang.getEquipmentStats() — every field is optional, and a missing stat
 *   means this item does not touch it (treated as the 1.0 no-op multiplier).
 * @param {{combat: boolean}} opts
 */
export function rankEquipment(equipment, { combat }) {
  const wanted = combat ? COMBAT_STATS : HACK_STATS;

  return equipment
    .map((item) => {
      const gain = wanted.reduce((sum, stat) => sum + Math.max(0, (item.stats?.[stat] ?? 1) - 1), 0);
      return { ...item, gain, value: item.cost > 0 ? gain / item.cost : gain };
    })
    .filter((item) => item.gain > 0)
    .sort((a, b) => b.value - a.value);
}

/**
 * Name for the next recruit: the lowest free Runner-N.
 *
 * Deriving it from the member count broke once a member died in a clash — the count
 * dropped, the derived name was still taken, recruitMember rejected the duplicate, and
 * recruiting stopped for good.
 *
 * @param {string[]} existing  current member names
 */
export function nextMemberName(existing) {
  const taken = new Set(existing);
  for (let i = 0; ; i++) {
    const name = `${MEMBER_PREFIX}${i}`;
    if (!taken.has(name)) return name;
  }
}

/**
 * Members who rank tasks by respect rather than money.
 *
 * Sending everyone after respect until the roster is full stalled income for hours: the
 * best respect task (Terrorism) earns nothing, and the 11th and 12th recruits need ~2M
 * and ~10M respect. The first members in roster order take the job, so it doesn't
 * reshuffle between cycles.
 *
 * @param {string[]} names  current member names, in roster order
 * @param {boolean} rosterFull
 * @returns {Set<string>}
 */
export function respectChasers(names, rosterFull) {
  if (rosterFull) return new Set();
  return new Set(names.slice(0, Math.ceil(names.length * RESPECT_SHARE)));
}

/** @param {{wantedPenalty: number, wantedLevel: number}} gang */
export function needsWantedReduction(gang) {
  return gang.wantedPenalty < 0.9 && gang.wantedLevel > 1;
}

/** @param {{str: number, def: number, dex: number, agi: number}} member */
function avgCombat(member) {
  return COMBAT_STATS.reduce((sum, s) => sum + member[s], 0) / COMBAT_STATS.length;
}

/** Average combat ascension multiplier; 1 before any ascension. */
function avgCombatAscMult(member) {
  return COMBAT_STATS.reduce((sum, s) => sum + (member[`${s}_asc_mult`] ?? 1), 0) / COMBAT_STATS.length;
}

/**
 * Task for one member. Priority: manual train-now, finish training, clear a wanted
 * penalty, build power for territory, earn.
 *
 * Training always comes from the ladder: training tasks earn no money and no respect, so
 * they score zero under the formulas and would never be `ranked`, however untrained the
 * member is. A hacking gang never trains combat — none of its tasks use those stats.
 *
 * @param {{hack: number, str: number, def: number, dex: number, agi: number,
 *   hack_asc_mult?: number, str_asc_mult?: number, def_asc_mult?: number,
 *   dex_asc_mult?: number, agi_asc_mult?: number}} member
 *   ns.gang.getMemberInformation(); a missing multiplier counts as 1 (never ascended).
 * @param {{isHacking: boolean, wantedPenalty: number, wantedLevel: number}} gang
 * @param {{buildPower?: boolean, ranked?: string | null, trainNow?: boolean}} opts
 *   `buildPower` from planWarfare; `ranked` is the formulas-ranked task (selectBestTask),
 *   or null to use the ladder; `trainNow` is the player's manual override
 *   (tools/gang-train.js).
 */
export function chooseTask(member, gang, { buildPower = false, ranked = null, trainNow = false } = {}) {
  if (trainNow) return gang.isHacking ? "Train Hacking" : "Train Combat";

  if (!gang.isHacking && avgCombat(member) < TRAIN_BASE * avgCombatAscMult(member)) return "Train Combat";
  // Only the stats this gang uses scale. Ascension resets hacking exp too, so a scaled
  // hacking bar had a combat gang retraining a stat it barely uses after every ascension.
  const hackBar = gang.isHacking ? TRAIN_BASE * (member.hack_asc_mult ?? 1) : TRAIN_BASE;
  if (member.hack < hackBar) return "Train Hacking";

  const ladder = gang.isHacking ? LADDERS.hacking : LADDERS.combat;

  // selectBestTask already favours wanted reducers when asked, so a ranked task stands.
  if (needsWantedReduction(gang)) return ranked ?? ladder.wanted;

  // Gang power only accrues from members on this task; without it the win chance can
  // never rise and territory never grows.
  if (buildPower) return "Territory Warfare";

  if (ranked) return ranked;

  const level = gang.isHacking ? member.hack : avgCombat(member);
  return level < 500 ? ladder.early : ladder.late;
}

/**
 * Whether to ascend, judged on the multipliers this gang type actually uses.
 *
 * @param {{hack: number, str: number, def: number, dex: number, agi: number} | undefined} result
 *   ns.gang.getAscensionResult() — undefined when ascension isn't possible.
 * @param {{isHacking: boolean}} gang
 */
export function shouldAscend(result, { isHacking }) {
  if (!result) return false;
  const stats = isHacking ? HACK_STATS : COMBAT_STATS;
  const avgMult = stats.reduce((sum, s) => sum + result[s], 0) / stats.length;
  return avgMult >= ASCEND_THRESHOLD;
}

/** Power a member adds per territory tick on Territory Warfare, before the gang's scaling. */
export function memberPower(member) {
  return (member.hack + member.str + member.def + member.dex + member.agi + member.cha) / 95;
}

/**
 * Members who build power when planWarfare asks for it: the strongest POWER_SHARE of the
 * roster.
 *
 * @param {Array<{name: string, hack: number, str: number, def: number, dex: number, agi: number, cha: number}>} members
 * @returns {{names: Set<string>, power: number}}  `power` is their summed memberPower.
 */
export function powerBuilders(members) {
  const strongest = [...members]
    .sort((a, b) => memberPower(b) - memberPower(a))
    .slice(0, Math.ceil(members.length * POWER_SHARE));
  return {
    names: new Set(strongest.map((m) => m.name)),
    power: strongest.reduce((sum, m) => sum + memberPower(m), 0),
  };
}

/** A rival NPC gang's long-run power gain per territory tick (see POWER_GAIN_RATE). */
function rivalPowerGain({ name, territory }) {
  const mult = NPC_POWER_MULT[name] ?? NPC_MAX_POWER_MULT;
  const multiplicative = 0.85;
  const additive = 0.75 * 0.75 * territory * mult; // mean roll over [0.5, 1)
  return (multiplicative + additive) / 2;
}

/**
 * Territory warfare plan.
 *
 * Clashes only happen against gangs that hold territory, so an eliminated gang's win
 * chance is ignored. Power is built only once the roster is full: until then respect
 * (which unlocks recruits) is worth more than territory.
 *
 * Power is also only built when the builders out-grow every rival enough to hold the engage
 * chance. Win chance is power / (power + rival power), and both grow roughly linearly, so it
 * tends to gain / (gain + rival gain). Our gain scales with territory, so a fresh gang at
 * 1/7 levels off near a 20% chance: building there never reaches a clash, never gains
 * territory, and the builders earn nothing the whole time.
 *
 * @param {{territory: number, rosterFull: boolean, builderPower: number,
 *   rivals: Array<{name: string, territory: number, chance: number}>}} state
 *   `rivals` excludes this gang; `chance` is ns.gang.getChanceToWinClash(name).
 *   `builderPower` is powerBuilders().power.
 * @returns {{engage: boolean, buildPower: boolean}}
 */
export function planWarfare({ territory, rosterFull, builderPower, rivals }) {
  const contested = rivals.filter((r) => r.territory > 0);
  if (territory >= 1 || contested.length === 0) return { engage: false, buildPower: false };

  const weakest = Math.min(...contested.map((r) => r.chance));
  const gain = POWER_GAIN_RATE * Math.max(0.002, territory) * builderPower;
  const outgrowsAll = contested.every((r) => gain / (gain + rivalPowerGain(r)) >= WARFARE_WIN_THRESHOLD);

  return {
    engage: weakest >= WARFARE_WIN_THRESHOLD,
    buildPower: rosterFull && weakest < POWER_TARGET && outgrowsAll,
  };
}

/**
 * Equipment purchases for this cycle.
 *
 * Each item must cost under `itemFraction` of cash (non-augmentation gear is lost when a
 * member ascends, so only gear that is cheap relative to cash is worth it), and the whole
 * cycle is capped at `budgetFraction` of cash. The best-value item goes to every member
 * before the next item is considered.
 *
 * @param {Array<{name: string, owned: string[]}>} members  `owned` = upgrades + augmentations
 * @param {Array<{name: string, cost: number}>} catalogue  rankEquipment output, best first
 * @param {number} money
 * @param {{itemFraction: number, budgetFraction: number}} caps
 * @returns {Array<{member: string, item: string}>}
 */
export function planEquipmentPurchases(members, catalogue, money, { itemFraction, budgetFraction }) {
  let remaining = money * budgetFraction;
  const plan = [];

  for (const item of catalogue) {
    if (item.cost >= money * itemFraction) continue;
    for (const m of members) {
      if (item.cost > remaining) break;
      if (m.owned.includes(item.name)) continue;
      plan.push({ member: m.name, item: item.name });
      remaining -= item.cost;
    }
  }
  return plan;
}
