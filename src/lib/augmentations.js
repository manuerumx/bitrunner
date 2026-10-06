// Stat-based ordering for augmentation-buyer.js --prefer.
//
// The buyer's default order is most-expensive-first: every purchase multiplies the price of
// every remaining aug by 1.9x, so that order buys the most augs for the money. --prefer
// trades some of that count for buying what matters to this run first.

// Category → the getAugmentationStats() key prefixes that belong to it.
const CATEGORY_PREFIXES = {
  hacking: ["hacking"],
  combat: ["strength", "defense", "dexterity", "agility"],
  charisma: ["charisma"],
  rep: ["faction_rep", "company_rep"],
  hacknet: ["hacknet_"],
  bladeburner: ["bladeburner_"],
  crime: ["crime_"],
  work: ["work_"],
};

export const AUG_CATEGORIES = Object.keys(CATEGORY_PREFIXES);

// Written by tools/aug-stats-worker.js: JSON object of aug name → getAugmentationStats().
// Lives here, not in the worker, so the buyer can read it without importing the worker's
// getAugmentationStats RAM (5 GB × 16/4/1 by SF4 level).
export const AUG_STATS_FILE = "/data/aug-stats.txt";

/**
 * Which categories an augmentation boosts. Empty for the special-effect augs (e.g.
 * Neuroreceptor Management Implant), whose multipliers are all 1.
 *
 * @param {Record<string, number>} stats singularity.getAugmentationStats()
 * @returns {Set<string>}
 */
export function augCategories(stats) {
  const categories = new Set();
  for (const [key, value] of Object.entries(stats)) {
    if (typeof value !== "number" || value === 1) continue;
    for (const [category, prefixes] of Object.entries(CATEGORY_PREFIXES)) {
      if (prefixes.some((prefix) => key.startsWith(prefix))) categories.add(category);
    }
  }
  return categories;
}

/**
 * Parse a --prefer value like "hacking,rep" into categories, best first.
 *
 * @param {string} value
 * @returns {{prefer: string[], unknown: string[]}}
 */
export function parsePreference(value) {
  const names = value
    .split(",")
    .map((name) => name.trim())
    .filter((name) => name !== "");
  return {
    prefer: names.filter((name) => AUG_CATEGORIES.includes(name)),
    unknown: names.filter((name) => !AUG_CATEGORIES.includes(name)),
  };
}

/**
 * Order augs by preference tier, most expensive first within a tier.
 *
 * An aug's tier is the position of the best preferred category it boosts; augs boosting
 * none of them (including those with no known stats) come last. With no preference this is
 * plain most-expensive-first.
 *
 * @template {{name: string, price: number}} T
 * @param {T[]} augs
 * @param {Record<string, Record<string, number>>} statsByName
 * @param {string[]} prefer categories, best first
 * @returns {T[]}
 */
export function orderByPreference(augs, statsByName, prefer) {
  const tier = (aug) => {
    const categories = augCategories(statsByName[aug.name] ?? {});
    const ranks = prefer.map((category, i) => (categories.has(category) ? i : prefer.length));
    return Math.min(prefer.length, ...ranks);
  };
  return augs
    .map((aug) => ({ aug, tier: tier(aug) }))
    .sort((a, b) => a.tier - b.tier || b.aug.price - a.aug.price)
    .map(({ aug }) => aug);
}
