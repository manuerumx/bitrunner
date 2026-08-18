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
