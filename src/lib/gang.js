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
