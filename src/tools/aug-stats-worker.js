import { AUG_STATS_FILE } from "/src/lib/augmentations.js";

// One-shot helper for `augmentation-buyer.js --prefer`: writes the stats of the augmentation
// names passed as arguments, then exits.
//
// It exists for RAM. getAugmentationStats is 5 GB × 16/4/1 by SF4 level — 80 GB at SF4.1 —
// and the buyer's default order doesn't need it. Out here the cost is paid only with --prefer.

/** @param {NS} ns */
export async function main(ns) {
  /** @type {Record<string, Record<string, number>>} */
  const stats = {};
  for (const name of ns.args.map(String)) {
    try {
      stats[name] = /** @type {Record<string, number>} */ (/** @type {unknown} */ (ns.singularity.getAugmentationStats(name)));
    } catch {
      // unknown name: leave it out, the buyer ranks it as unpreferred
    }
  }
  ns.write(AUG_STATS_FILE, JSON.stringify(stats), "w");
}
