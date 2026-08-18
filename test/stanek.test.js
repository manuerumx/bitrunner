import { test } from "node:test";
import assert from "node:assert/strict";
import { placementOrder, rankFragments } from "/src/lib/stanek.js";

// ── placementOrder ──────────────────────────────────────────────────────────
//
// ns.stanek.canPlaceFragment() answers whether one (x, y, rotation) works, so the search
// order is ours to choose. Keeping it pure makes the packing deterministic and testable
// without a gift.

test("placementOrder covers every cell and rotation of the grid", () => {
  const order = placementOrder(2, 2);
  assert.equal(order.length, 2 * 2 * 4);
});

test("placementOrder starts at the origin", () => {
  assert.deepEqual(placementOrder(3, 3)[0], { x: 0, y: 0, rotation: 0 });
});

// Rotations are tried before moving on, so a fragment settles into the first cell it fits
// in any orientation rather than skipping across the board.
test("placementOrder tries all four rotations of a cell consecutively", () => {
  const order = placementOrder(3, 3);
  assert.deepEqual(
    order.slice(0, 4).map((p) => p.rotation),
    [0, 1, 2, 3]
  );
  assert.ok(order.slice(0, 4).every((p) => p.x === 0 && p.y === 0));
});

test("placementOrder yields nothing for an empty grid", () => {
  assert.deepEqual(placementOrder(0, 0), []);
});

// ── rankFragments ───────────────────────────────────────────────────────────
//
// Booster fragments multiply adjacent non-booster fragments rather than any multiplier of
// their own, so they are only worth space once something useful is down.

function frag(id, type, power = 1, shape = [[true]]) {
  return { id, type, power, shape, limit: 1, effect: "" };
}

test("rankFragments puts preferred fragment types first", () => {
  const ranked = rankFragments([frag(7, 7), frag(6, 6)], { preferredTypes: [6] });
  assert.equal(ranked[0].id, 6);
});

test("rankFragments ranks stronger fragments ahead of weaker ones of equal preference", () => {
  const ranked = rankFragments([frag(6, 6, 1), frag(60, 6, 5)], { preferredTypes: [6] });
  assert.equal(ranked[0].id, 60);
});

test("rankFragments places boosters after the fragments they boost", () => {
  const ranked = rankFragments([frag(18, 18, 10), frag(6, 6, 1)], { preferredTypes: [6] });
  assert.deepEqual(ranked.map((f) => f.id), [6, 18]);
});

test("rankFragments keeps unpreferred non-booster fragments ahead of boosters", () => {
  const ranked = rankFragments([frag(18, 18), frag(7, 7)], { preferredTypes: [6] });
  assert.deepEqual(ranked.map((f) => f.id), [7, 18]);
});

test("rankFragments handles an empty definition list", () => {
  assert.deepEqual(rankFragments([], { preferredTypes: [6] }), []);
});
