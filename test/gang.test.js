import { test } from "node:test";
import assert from "node:assert/strict";
import { rankEquipment, selectBestTask } from "/src/lib/gang.js";

function task(name, over = {}) {
  return { name, money: 100, respect: 10, wanted: 1, ...over };
}

// ── selectBestTask ──────────────────────────────────────────────────────────
//
// Gains are supplied by the caller, never derived here: with Formulas.exe they come from
// ns.formulas.gang.* and are exact. Without it, gang-manager keeps its hardcoded ladder
// rather than guessing at the game's scaling — an invented formula would be worse than
// the ladder it replaced.

test("selectBestTask maximises money by default", () => {
  const best = selectBestTask([task("Mug", { money: 50 }), task("Traffick", { money: 500 })], {});
  assert.equal(best, "Traffick");
});

test("selectBestTask maximises respect when respect is what's needed", () => {
  const tasks = [
    task("Mug", { money: 500, respect: 1 }),
    task("Terrorism", { money: 0, respect: 90 }),
  ];
  assert.equal(selectBestTask(tasks, { preferRespect: true }), "Terrorism");
});

// A wanted penalty throttles every member's output, so clearing it outranks earning.
// Vigilante work is the task with a negative wanted gain.
test("selectBestTask picks the strongest wanted reduction when the penalty bites", () => {
  const tasks = [
    task("Traffick", { money: 900, wanted: 5 }),
    task("Vigilante Justice", { money: 0, wanted: -3 }),
    task("Ethical Hacking", { money: 10, wanted: -1 }),
  ];
  assert.equal(selectBestTask(tasks, { needWantedReduction: true }), "Vigilante Justice");
});

// If nothing on the list actually reduces wanted, don't idle on a zero-earning task —
// fall back to earning.
test("selectBestTask earns anyway when no task reduces wanted", () => {
  const tasks = [task("Mug", { money: 50, wanted: 1 }), task("Traffick", { money: 500, wanted: 5 })];
  assert.equal(selectBestTask(tasks, { needWantedReduction: true }), "Traffick");
});

// Training tasks have zero base money and respect, so they score zero under the formulas.
// Returning null lets the caller apply its own training rule instead of picking arbitrarily.
test("selectBestTask returns null when no task produces anything", () => {
  const tasks = [task("Train Combat", { money: 0, respect: 0, wanted: 0 })];
  assert.equal(selectBestTask(tasks, {}), null);
});

test("selectBestTask returns null for an empty task list", () => {
  assert.equal(selectBestTask([], {}), null);
});

// ── rankEquipment ───────────────────────────────────────────────────────────
//
// buyEquipment used to buy anything under 1% of cash, in catalogue order — which spends
// on charisma and hacking gear for a combat gang.

function gear(name, over = {}) {
  return { name, type: "Weapon", cost: 1000, stats: { str: 1.1, def: 1.1 }, ...over };
}

test("rankEquipment puts the best stat gain per dollar first", () => {
  const ranked = rankEquipment(
    [
      gear("cheap-weak", { cost: 100, stats: { str: 1.01 } }),
      gear("cheap-strong", { cost: 100, stats: { str: 1.5 } }),
    ],
    { combat: true }
  );
  assert.equal(ranked[0].name, "cheap-strong");
});

test("rankEquipment ignores stats a combat gang cannot use", () => {
  const ranked = rankEquipment(
    [
      gear("hacker-gear", { stats: { hack: 3 } }),
      gear("combat-gear", { stats: { str: 1.2 } }),
    ],
    { combat: true }
  );
  assert.equal(ranked[0].name, "combat-gear");
});

test("rankEquipment values hacking gear for a hacking gang", () => {
  const ranked = rankEquipment(
    [
      gear("hacker-gear", { stats: { hack: 3 } }),
      gear("combat-gear", { stats: { str: 1.2 } }),
    ],
    { combat: false }
  );
  assert.equal(ranked[0].name, "hacker-gear");
});

// Rootkits and augmentations carry real multipliers; vehicles and cosmetics may carry
// nothing this gang can use, and buying them is pure waste.
test("rankEquipment drops gear with no usable stats", () => {
  const ranked = rankEquipment([gear("useless", { stats: { cha: 2 } })], { combat: true });
  assert.deepEqual(ranked, []);
});

test("rankEquipment handles an empty catalogue", () => {
  assert.deepEqual(rankEquipment([], { combat: true }), []);
});
