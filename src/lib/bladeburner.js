// Bladeburner action choice, shared by bladeburner-manager.js and lib/sleeves.js.
// No imports, so it adds nothing to either script's RAM cost.

/**
 * Contracts, best-paying first. Rank and money rise down the game's list (Tracking, Bounty
 * Hunter, Retirement), and so does difficulty.
 * @type {BladeburnerContractName[]}
 */
export const CONTRACTS_BY_REWARD = ["Retirement", "Bounty Hunter", "Tracking"];

/**
 * Operations, best-paying first by rank gained. Raid and Sting Operation are left out on
 * purpose: both raise chaos, which lowers every success chance in the city.
 * @type {BladeburnerActionName[]}
 */
export const OPERATIONS_BY_REWARD = [
  "Assassination",
  "Stealth Retirement Operation",
  "Undercover Operation",
  "Investigation",
];

/**
 * The best-paying action that clears the success floor, or null.
 *
 * Taking the highest success chance instead always picks the easiest action, so the
 * manager stayed on Tracking and Investigation however strong the player got.
 *
 * @param {Array<{name: string, chance: number}>} candidates  actions with some count left
 * @param {string[]} order  best-paying first; anything not listed is never taken
 * @param {number} minChance
 * @returns {string | null}
 */
export function bestPayingAction(candidates, order, minChance) {
  const landable = candidates.filter((c) => c.chance >= minChance).map((c) => c.name);
  return order.find((name) => landable.includes(name)) ?? null;
}
