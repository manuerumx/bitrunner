// Faction work type preference, shared by sleeve-manager.js and faction-manager.js.
// No imports, so it adds nothing to either script's RAM cost.

/**
 * Faction work, best first. Field work trains every stat, security every stat but
 * charisma, and hacking only hacking. Not every faction offers all three, so the managers
 * (sleeve-manager.js and faction-manager.js) try these in order and keep whichever the
 * game accepts.
 * @type {FactionWorkType[]}
 */
export const FACTION_WORK_TYPES = ["field", "security", "hacking"];

/**
 * Work types worth trying in place of the one already running: those ranked above it.
 *
 * needsReassignment accepts any allowed type, so work that started on a worse type stays on
 * it. Switching costs nothing, because faction work pays reputation every cycle rather
 * than in one payout at the end. A type the faction doesn't offer is refused before the
 * current work is touched, so trying it does no harm. The live type itself is never in the
 * list, so it is never restarted.
 *
 * @param {string | undefined} current  the live factionWorkType
 * @returns {FactionWorkType[]}
 */
export function betterFactionWorkTypes(current) {
  const rank = FACTION_WORK_TYPES.indexOf(/** @type {FactionWorkType} */ (current));
  return rank < 0 ? [...FACTION_WORK_TYPES] : FACTION_WORK_TYPES.slice(0, rank);
}
