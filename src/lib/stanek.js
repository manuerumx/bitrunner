// Stanek's Gift packing and fragment ranking. See docs/API-COVERAGE-AUDIT.md §5.14.
//
// Note what is absent: ns.stanek.acceptGift(). Accepting the gift is irreversible and
// permanently shrinks home RAM, so it stays a human decision — the same reasoning that
// keeps `augmentation-buyer.js install` manual. tools/stanek.js never references it, which
// means the suite cannot accept the gift even by accident.

// Booster fragments carry no multiplier of their own; they amplify adjacent non-booster
// fragments. Space spent on one before there is anything to boost is space wasted.
const BOOSTER_TYPE = 18;

/**
 * Every (x, y, rotation) worth trying, in search order.
 *
 * ns.stanek.canPlaceFragment() answers one position at a time, so the order is ours to
 * pick. All four rotations of a cell are tried consecutively, so a fragment settles into
 * the first cell where it fits in *any* orientation rather than skipping across the board
 * and leaving holes behind it.
 *
 * @param {number} width   ns.stanek.giftWidth()
 * @param {number} height  ns.stanek.giftHeight()
 * @returns {Array<{x: number, y: number, rotation: number}>}
 */
export function placementOrder(width, height) {
  const order = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      for (let rotation = 0; rotation < 4; rotation++) {
        order.push({ x, y, rotation });
      }
    }
  }
  return order;
}

/**
 * Fragments in the order they should claim board space.
 *
 * Preferred types first (this suite lives on hacking, so hacking fragments earn the most),
 * strongest first within a tier, and boosters last — a booster placed before the fragment
 * it would amplify just occupies the space that fragment needed.
 *
 * @param {Array<{id: number, type: number, power: number}>} definitions
 * @param {{preferredTypes: number[]}} opts
 */
export function rankFragments(definitions, { preferredTypes }) {
  const tier = (f) => {
    if (f.type === BOOSTER_TYPE) return 2;
    return preferredTypes.includes(f.type) ? 0 : 1;
  };

  return [...definitions].sort((a, b) => tier(a) - tier(b) || b.power - a.power || a.id - b.id);
}
