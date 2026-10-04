// Grafting selection. See docs/API-COVERAGE-AUDIT.md §5.11.
//
// Grafting buys an augmentation for money alone — no faction reputation — which is exactly
// the constraint faction-manager.js spends its whole cycle grinding against. That makes it
// the highest-leverage unautomated subsystem for a cash-rich, reputation-poor run.

// Repeatable, and every level multiplies the price of every *other* augmentation. The
// augmentation buyer already defers it to the end of a run for that reason (059c5ae);
// grafting it early would price the rest of the catalogue out of reach.
const NEVER_GRAFT = ["NeuroFlux Governor"];

/**
 * Which graftable augmentations are worth starting, cheapest first.
 *
 * The budget is a per-graft ceiling rather than a running total: the player can only graft
 * one augmentation at a time, and each is charged when it starts, so there is no shared
 * pot to divide up. Cheapest-first maximises how many get grafted before money runs out.
 *
 * Prerequisites are deliberately not checked here. ns.grafting.getGraftableAugmentations()
 * already excludes augmentations you own but does *not* check prerequisites, and
 * singularity.getAugmentationPrereq costs 5 GB before the ×16 Source-File multiplier —
 * 80 GB at SF4.1. graftAugmentation() simply returns false for an unmet prerequisite,
 * which is the same answer for free.
 *
 * @param {Array<{name: string, price: number, time: number}>} candidates
 * @param {{money: number, budgetFraction?: number}} opts
 */
export function selectGraftTargets(candidates, { money, budgetFraction = 1 }) {
  const budget = money * budgetFraction;

  return candidates
    .filter((c) => !NEVER_GRAFT.includes(c.name))
    .filter((c) => c.price <= budget)
    .sort((a, b) => a.price - b.price);
}

// Written by tools/graft-stats-worker.js: JSON array of the graftable augmentations whose
// every effect is hacking/hacknet. Lives here, not in the worker, so grafting.js can read it
// without importing the worker's 80 GB getAugmentationStats into its own RAM cost.
export const GRAFT_HACKING_ONLY_FILE = "/data/graft-hacking-only.txt";

// Multiplier prefixes that earn nothing in BitNode-8: hacking pays no money there, and
// hacknet production is zeroed.
const USELESS_IN_BN8 = ["hacking", "hacknet_"];

/**
 * Does every effect of this augmentation fall on hacking or hacknet?
 *
 * An augmentation with no multipliers at all is kept: those are the special-effect ones
 * (e.g. Neuroreceptor Management Implant removes the unfocused-work penalty).
 *
 * @param {Record<string, number>} stats singularity.getAugmentationStats()
 */
export function isHackingOnly(stats) {
  const effects = Object.entries(stats).filter(([, v]) => typeof v === "number" && v !== 1);
  if (effects.length === 0) return false;
  return effects.every(([key]) => USELESS_IN_BN8.some((prefix) => key.startsWith(prefix)));
}

/**
 * The next augmentation the queue should graft, or null.
 *
 * Measured against net worth rather than cash: in BN8 the stock trader keeps cash near
 * zero and sells to cover a request, so cash alone would say nothing is ever affordable.
 * `maxShare` caps one graft's share of net worth, so a single expensive graft cannot
 * liquidate the whole portfolio the trader lives on.
 *
 * @param {Array<{name: string, price: number, time: number}>} candidates
 * @param {{netWorth: number, maxShare: number, skip: Set<string>}} opts
 */
export function pickNextGraft(candidates, { netWorth, maxShare, skip }) {
  const eligible = candidates.filter((c) => !skip.has(c.name));
  return selectGraftTargets(eligible, { money: netWorth, budgetFraction: maxShare })[0] ?? null;
}
