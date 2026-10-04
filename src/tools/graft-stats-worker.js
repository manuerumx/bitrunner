import { GRAFT_HACKING_ONLY_FILE, isHackingOnly } from "/src/lib/grafting.js";

// One-shot helper for `grafting.js queue --skip-hacking`: writes which of the augmentation
// names passed as arguments only boost hacking/hacknet, then exits.
//
// It exists for RAM. getAugmentationStats is 5 GB × 16/4/1 by SF4 level — 80 GB at SF4.1 —
// and grafting.js runs for hours. Out here the cost is paid once, for a second.

/** @param {NS} ns */
export async function main(ns) {
  const names = ns.args.map(String);
  const hackingOnly = names.filter((name) => {
    try {
      return isHackingOnly(/** @type {Record<string, number>} */ (/** @type {unknown} */ (ns.singularity.getAugmentationStats(name))));
    } catch {
      return false; // unknown name: keep it rather than silently drop it
    }
  });
  ns.write(GRAFT_HACKING_ONLY_FILE, JSON.stringify(hackingOnly), "w");
}
