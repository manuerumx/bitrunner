import { test } from "node:test";
import assert from "node:assert/strict";
import { selectGraftTargets } from "/src/lib/grafting.js";

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
