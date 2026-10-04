import { test } from "node:test";
import assert from "node:assert/strict";
import { isHackingOnly, pickNextGraft, selectGraftTargets } from "/src/lib/grafting.js";

function aug(name, price, time = 60_000) {
  return { name, price, time };
}

// Grafting buys an augmentation for money alone — no faction reputation — which is exactly
// the constraint faction-manager.js spends its entire cycle grinding against.

test("selectGraftTargets takes the cheapest augmentations first", () => {
  const picks = selectGraftTargets([aug("Pricey", 900), aug("Cheap", 100)], { money: 10_000 });
  assert.deepEqual(picks.map((p) => p.name), ["Cheap", "Pricey"]);
});

test("selectGraftTargets drops augmentations beyond the budget", () => {
  const picks = selectGraftTargets([aug("Cheap", 100), aug("Huge", 100_000)], { money: 1_000 });
  assert.deepEqual(picks.map((p) => p.name), ["Cheap"]);
});

test("selectGraftTargets honours the budget fraction", () => {
  const picks = selectGraftTargets([aug("Mid", 600)], { money: 1_000, budgetFraction: 0.5 });
  assert.deepEqual(picks, []);
});

// NeuroFlux Governor is repeatable and its price escalates every level, dragging every
// other augmentation's price up with it — the same trap augmentation-buyer.js defers for
// (059c5ae). Grafting it early would price the rest of the catalogue out of reach.
test("selectGraftTargets never grafts NeuroFlux Governor", () => {
  const picks = selectGraftTargets([aug("NeuroFlux Governor", 10), aug("Real Aug", 500)], {
    money: 10_000,
  });
  assert.deepEqual(picks.map((p) => p.name), ["Real Aug"]);
});

// Each graft is charged separately and the player can only graft one at a time, so the
// budget is a per-graft ceiling, not a running total to divide up.
test("selectGraftTargets checks each augmentation against the full budget", () => {
  const picks = selectGraftTargets([aug("A", 600), aug("B", 700)], { money: 1_000 });
  assert.deepEqual(picks.map((p) => p.name), ["A", "B"]);
});

test("selectGraftTargets returns nothing when broke", () => {
  assert.deepEqual(selectGraftTargets([aug("A", 600)], { money: 0 }), []);
});

test("selectGraftTargets handles an empty catalogue", () => {
  assert.deepEqual(selectGraftTargets([], { money: 10_000 }), []);
});

// ── isHackingOnly ───────────────────────────────────────────────────────────
//
// In BitNode-8 hacking earns nothing, so the queue can skip augmentations whose every
// effect is a hacking (or hacknet) multiplier. Anything with another effect is kept.

test("isHackingOnly flags an augmentation that only boosts hacking", () => {
  assert.equal(isHackingOnly({ hacking: 1.05, hacking_exp: 1.1, strength: 1 }), true);
});

test("isHackingOnly counts hacknet-only augmentations as useless too", () => {
  assert.equal(isHackingOnly({ hacknet_node_money: 1.1, hacknet_node_purchase_cost: 0.9 }), true);
});

test("isHackingOnly keeps an augmentation with any non-hacking effect", () => {
  assert.equal(isHackingOnly({ hacking: 1.05, faction_rep: 1.1 }), false);
});

test("isHackingOnly keeps an augmentation with no multipliers (special effects)", () => {
  // e.g. Neuroreceptor Management Implant: no multiplier, removes the unfocused penalty.
  assert.equal(isHackingOnly({ hacking: 1, strength: 1 }), false);
});

// ── pickNextGraft ───────────────────────────────────────────────────────────
//
// The queue grafts against net worth, not cash: the BN8 trader keeps cash near zero and
// sells to cover a request. The cap stops one graft from liquidating the whole portfolio.

test("pickNextGraft takes the cheapest augmentation within the net-worth cap", () => {
  const pick = pickNextGraft([aug("B", 300), aug("A", 200)], { netWorth: 1_000, maxShare: 0.5, skip: new Set() });
  assert.equal(pick?.name, "A");
});

test("pickNextGraft refuses an augmentation above the cap", () => {
  assert.equal(pickNextGraft([aug("Big", 600)], { netWorth: 1_000, maxShare: 0.5, skip: new Set() }), null);
});

test("pickNextGraft skips names in the skip set", () => {
  const pick = pickNextGraft([aug("A", 100), aug("B", 200)], { netWorth: 1_000, maxShare: 1, skip: new Set(["A"]) });
  assert.equal(pick?.name, "B");
});

test("pickNextGraft never grafts NeuroFlux Governor", () => {
  assert.equal(pickNextGraft([aug("NeuroFlux Governor", 1)], { netWorth: 1_000, maxShare: 1, skip: new Set() }), null);
});
