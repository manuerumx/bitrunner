import { test } from "node:test";
import assert from "node:assert/strict";
import {
  chooseTask,
  nextMemberName,
  planEquipmentPurchases,
  planWarfare,
  powerBuilders,
  rankEquipment,
  respectChasers,
  selectBestTask,
  shouldAscend,
} from "/src/lib/gang.js";

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

// ── nextMemberName ──────────────────────────────────────────────────────────
//
// Members assigned to Territory Warfare can die in a clash. Naming recruits after the
// member count then re-issues a name that is still taken ("Runner-2" with Runner-1 dead),
// recruitMember rejects the duplicate, and recruiting stalls for good.

test("nextMemberName starts at Runner-0 for an empty gang", () => {
  assert.equal(nextMemberName([]), "Runner-0");
});

test("nextMemberName appends after a gap-free roster", () => {
  assert.equal(nextMemberName(["Runner-0", "Runner-1"]), "Runner-2");
});

test("nextMemberName reuses the slot a dead member left", () => {
  assert.equal(nextMemberName(["Runner-0", "Runner-2"]), "Runner-1");
});

// ── chooseTask ──────────────────────────────────────────────────────────────

function member(over = {}) {
  return { name: "m", task: "Unassigned", hack: 1000, str: 1000, def: 1000, dex: 1000, agi: 1000, cha: 1000, ...over };
}

function gangInfo(over = {}) {
  return { isHacking: false, wantedPenalty: 1, wantedLevel: 1, ...over };
}

const WEAK_COMBAT = { str: 10, def: 10, dex: 10, agi: 10 };
const WANTED = { wantedPenalty: 0.5, wantedLevel: 50 };

// Every task getTaskNames() returns to a hacking gang. setMemberTask silently sets a
// member to "Unassigned" when handed a task outside this list.
const HACKING_GANG_TASKS = new Set([
  "Ransomware", "Phishing", "Identity Theft", "DDoS Attacks", "Plant Virus",
  "Fraud & Counterfeiting", "Money Laundering", "Cyberterrorism", "Ethical Hacking",
  "Vigilante Justice", "Train Combat", "Train Hacking", "Train Charisma", "Territory Warfare",
]);

test("chooseTask trains an untrained combat member", () => {
  assert.equal(chooseTask(member(WEAK_COMBAT), gangInfo()), "Train Combat");
});

test("chooseTask keeps the combat ladder's earning rungs", () => {
  assert.equal(chooseTask(member({ str: 300, def: 300, dex: 300, agi: 300 }), gangInfo()), "Mug People");
  assert.equal(chooseTask(member(), gangInfo()), "Human Trafficking");
});

test("chooseTask sends a combat gang to Vigilante Justice when wanted bites", () => {
  assert.equal(chooseTask(member(), gangInfo(WANTED)), "Vigilante Justice");
});

test("chooseTask never sends a hacking gang to combat training", () => {
  assert.equal(chooseTask(member({ ...WEAK_COMBAT, hack: 1000 }), gangInfo({ isHacking: true })), "Money Laundering");
});

test("chooseTask only picks tasks a hacking gang can actually be given", () => {
  for (const hack of [10, 200, 1000]) {
    for (const extra of [{}, WANTED]) {
      const task = chooseTask(member({ ...WEAK_COMBAT, hack }), gangInfo({ isHacking: true, ...extra }));
      assert.ok(HACKING_GANG_TASKS.has(task), `hack=${hack} ${JSON.stringify(extra)} → ${task}`);
    }
  }
});

test("chooseTask sends a hacking gang to Ethical Hacking when wanted bites", () => {
  assert.equal(chooseTask(member(), gangInfo({ isHacking: true, ...WANTED })), "Ethical Hacking");
});

// Gang power only comes from members on "Territory Warfare" — without it the win chance
// can never rise and territory never grows.
test("chooseTask puts trained members on Territory Warfare while building power", () => {
  assert.equal(chooseTask(member(), gangInfo(), { buildPower: true }), "Territory Warfare");
});

test("chooseTask finishes training before building power", () => {
  assert.equal(chooseTask(member(WEAK_COMBAT), gangInfo(), { buildPower: true }), "Train Combat");
});

test("chooseTask clears a wanted penalty before building power", () => {
  assert.equal(chooseTask(member(), gangInfo(WANTED), { buildPower: true }), "Vigilante Justice");
});

test("chooseTask prefers the formulas-ranked task over the ladder", () => {
  assert.equal(chooseTask(member(), gangInfo(), { ranked: "Terrorism" }), "Terrorism");
});

// Stat level is linear in the ascension multiplier, so an ascended member reaches 100 on a
// fraction of the exp. The bar scales with it: 100 × mult costs the same training as an
// unascended member reaching 100.
const ASCENDED_5X = { str_asc_mult: 5, def_asc_mult: 5, dex_asc_mult: 5, agi_asc_mult: 5 };

test("chooseTask keeps an ascended combat member training up to its multiplied bar", () => {
  const m = member({ ...ASCENDED_5X, str: 300, def: 300, dex: 300, agi: 300 });
  assert.equal(chooseTask(m, gangInfo()), "Train Combat");
});

test("chooseTask puts an ascended combat member to work once past its multiplied bar", () => {
  const m = member({ ...ASCENDED_5X, str: 600, def: 600, dex: 600, agi: 600 });
  assert.equal(chooseTask(m, gangInfo()), "Human Trafficking");
});

test("chooseTask scales a hacking gang's bar with the hacking multiplier", () => {
  const m = member({ hack: 300, hack_asc_mult: 4 });
  assert.equal(chooseTask(m, gangInfo({ isHacking: true })), "Train Hacking");
});

// Every ascension resets hacking exp, so a scaled hacking bar made a combat gang retrain a
// stat it barely uses (to ~280) after every ascension, on top of combat. Only the stats the
// gang uses scale; a combat gang's hacking check stays at a flat 100.
test("chooseTask keeps a combat gang's hacking bar flat after ascension", () => {
  const m = member({ hack: 150, hack_asc_mult: 3 });
  assert.equal(chooseTask(m, gangInfo()), "Human Trafficking");
});

// Manual "train now" (tools/gang-train.js): the player asked for it, so it outranks
// everything the manager would otherwise do.
test("chooseTask trains a fully trained combat member when train-now is on", () => {
  assert.equal(chooseTask(member(), gangInfo(WANTED), { trainNow: true, buildPower: true, ranked: "Terrorism" }), "Train Combat");
});

test("chooseTask trains hacking for a hacking gang when train-now is on", () => {
  assert.equal(chooseTask(member(), gangInfo({ isHacking: true }), { trainNow: true }), "Train Hacking");
});

// ── respectChasers ──────────────────────────────────────────────────────────
//
// The top respect task (Terrorism) earns nothing, and the last recruits cost millions of
// respect, so sending the whole roster after respect stalls income for hours. Only a
// share of the roster chases it; the rest earn.

const ROSTER = Array.from({ length: 10 }, (_, i) => `Runner-${i}`);

test("respectChasers sends only a third of a growing roster after respect", () => {
  assert.deepEqual([...respectChasers(ROSTER, false)], ["Runner-0", "Runner-1", "Runner-2", "Runner-3"]);
});

test("respectChasers keeps at least one member on respect while recruiting", () => {
  assert.deepEqual([...respectChasers(["Runner-0"], false)], ["Runner-0"]);
});

test("respectChasers stops chasing respect once the roster is full", () => {
  assert.equal(respectChasers(ROSTER, true).size, 0);
});

// ── shouldAscend ────────────────────────────────────────────────────────────

const ASC_BASE = { respect: 0, hack: 1, str: 1, def: 1, dex: 1, agi: 1, cha: 1 };

test("shouldAscend ascends a combat member on a combat multiplier jump", () => {
  const result = { ...ASC_BASE, str: 1.6, def: 1.6, dex: 1.6, agi: 1.6 };
  assert.equal(shouldAscend(result, { isHacking: false }), true);
});

test("shouldAscend judges a hacking gang on its hacking multiplier", () => {
  assert.equal(shouldAscend({ ...ASC_BASE, hack: 1.6 }, { isHacking: true }), true);
  assert.equal(shouldAscend({ ...ASC_BASE, str: 1.6, def: 1.6, dex: 1.6, agi: 1.6 }, { isHacking: true }), false);
});

test("shouldAscend waits while the gain is below the threshold", () => {
  const result = { ...ASC_BASE, str: 1.4, def: 1.4, dex: 1.4, agi: 1.4 };
  assert.equal(shouldAscend(result, { isHacking: false }), false);
});

test("shouldAscend declines when ascension isn't possible", () => {
  assert.equal(shouldAscend(undefined, { isHacking: false }), false);
});

// ── planWarfare ─────────────────────────────────────────────────────────────
//
// Clashes only happen against gangs that hold territory, so an eliminated gang's win
// chance must not veto warfare.

function rival(name, territory, chance) {
  return { name, territory, chance };
}

test("planWarfare ignores rivals that hold no territory", () => {
  const plan = planWarfare({ territory: 0.2, rosterFull: false, rivals: [rival("A", 0.1, 0.6), rival("B", 0, 0.1)] });
  assert.equal(plan.engage, true);
});

test("planWarfare stays out while any territory-holding rival is too strong", () => {
  const plan = planWarfare({ territory: 0.2, rosterFull: false, rivals: [rival("A", 0.1, 0.6), rival("C", 0.2, 0.5)] });
  assert.equal(plan.engage, false);
});

test("planWarfare stands down once the gang owns all territory", () => {
  const plan = planWarfare({ territory: 1, rosterFull: true, rivals: [rival("A", 0, 0.1)] });
  assert.deepEqual(plan, { engage: false, buildPower: false });
});

// Enough builder power (sum of (hack+str+def+dex+agi+cha)/95) to out-grow any rival at
// territory 0.2, and far too little to.
const STRONG_BUILDERS = 1000;
const WEAK_BUILDERS = 50;

test("planWarfare builds power with a full roster and a shaky win chance", () => {
  const plan = planWarfare({ territory: 0.2, rosterFull: true, builderPower: STRONG_BUILDERS, rivals: [rival("A", 0.1, 0.6)] });
  assert.equal(plan.buildPower, true);
});

test("planWarfare leaves power alone while the roster is still growing", () => {
  const plan = planWarfare({ territory: 0.2, rosterFull: false, builderPower: STRONG_BUILDERS, rivals: [rival("A", 0.1, 0.3)] });
  assert.equal(plan.buildPower, false);
});

test("planWarfare stops building power once every rival is clearly beaten", () => {
  const plan = planWarfare({ territory: 0.2, rosterFull: true, builderPower: STRONG_BUILDERS, rivals: [rival("A", 0.1, 0.9)] });
  assert.deepEqual(plan, { engage: true, buildPower: false });
});

// A gang's power gain scales with its own territory, while NPC gangs gain ~0.6 a tick
// regardless. A fresh gang (1/7 territory, members around 100 per stat) levels off near a
// 20% win chance: power built there never reaches a clash, and the roster earned nothing
// while it tried.
test("planWarfare leaves power alone when the builders can never out-grow a rival", () => {
  const fresh = 6 * (600 / 95);
  const plan = planWarfare({
    territory: 1 / 7,
    rosterFull: true,
    builderPower: fresh,
    rivals: [rival("Speakers for the Dead", 1 / 7, 0.3)],
  });
  assert.deepEqual(plan, { engage: false, buildPower: false });
});

test("planWarfare builds power once the builders out-grow the strongest rival", () => {
  const rivals = [rival("Slum Snakes", 0.1, 0.3), rival("The Black Hand", 0.1, 0.3)];
  assert.equal(planWarfare({ territory: 0.2, rosterFull: true, builderPower: WEAK_BUILDERS, rivals }).buildPower, false);
  assert.equal(planWarfare({ territory: 0.2, rosterFull: true, builderPower: STRONG_BUILDERS, rivals }).buildPower, true);
});

// ── powerBuilders ───────────────────────────────────────────────────────────
//
// Territory Warfare earns nothing, so only part of the roster builds power — the members
// who add the most of it — and the rest keep earning.

test("powerBuilders picks the strongest half of the roster", () => {
  const members = [
    member({ name: "weak", hack: 10, str: 10, def: 10, dex: 10, agi: 10, cha: 10 }),
    member({ name: "strong" }),
    member({ name: "mid", hack: 500, str: 500, def: 500, dex: 500, agi: 500, cha: 500 }),
    member({ name: "weakest", hack: 1, str: 1, def: 1, dex: 1, agi: 1, cha: 1 }),
  ];
  const { names, power } = powerBuilders(members);
  assert.deepEqual([...names].sort(), ["mid", "strong"]);
  assert.ok(Math.abs(power - (6000 + 3000) / 95) < 1e-9);
});

test("powerBuilders rounds an odd roster up", () => {
  const { names } = powerBuilders([member({ name: "a" }), member({ name: "b" }), member({ name: "c" })]);
  assert.equal(names.size, 2);
});

// ── planEquipmentPurchases ──────────────────────────────────────────────────
//
// buyEquipment used to test every item against 1% of a cash figure taken once at the
// top of the cycle, so one cycle could spend many multiples of that across the roster.

const CAPS = { itemFraction: 0.01, budgetFraction: 0.02 };

function buys(plan) {
  return plan.map((p) => `${p.member}:${p.item}`);
}

test("planEquipmentPurchases skips gear a member already owns", () => {
  const plan = planEquipmentPurchases(
    [{ name: "m1", owned: ["Katana"] }, { name: "m2", owned: [] }],
    [{ name: "Katana", cost: 50 }],
    10_000,
    CAPS
  );
  assert.deepEqual(buys(plan), ["m2:Katana"]);
});

test("planEquipmentPurchases stops at the per-cycle budget", () => {
  const plan = planEquipmentPurchases(
    [{ name: "m1", owned: [] }, { name: "m2", owned: [] }, { name: "m3", owned: [] }],
    [{ name: "Katana", cost: 90 }],
    10_000, // budget 200 → two katanas, not three
    CAPS
  );
  assert.deepEqual(buys(plan), ["m1:Katana", "m2:Katana"]);
});

test("planEquipmentPurchases gives the best item to everyone before the next", () => {
  const plan = planEquipmentPurchases(
    [{ name: "m1", owned: [] }, { name: "m2", owned: [] }],
    [{ name: "A", cost: 50 }, { name: "B", cost: 50 }],
    10_000,
    { itemFraction: 0.01, budgetFraction: 0.01 } // budget 100
  );
  assert.deepEqual(buys(plan), ["m1:A", "m2:A"]);
});

test("planEquipmentPurchases still fits cheaper gear after a pricier item runs out of budget", () => {
  const plan = planEquipmentPurchases(
    [{ name: "m1", owned: [] }, { name: "m2", owned: [] }],
    [{ name: "A", cost: 90 }, { name: "B", cost: 5 }],
    10_000,
    { itemFraction: 0.01, budgetFraction: 0.01 } // budget 100
  );
  assert.deepEqual(buys(plan), ["m1:A", "m1:B", "m2:B"]);
});

test("planEquipmentPurchases never buys an item at or above the per-item cap", () => {
  const plan = planEquipmentPurchases([{ name: "m1", owned: [] }], [{ name: "Pricey", cost: 100 }], 10_000, CAPS);
  assert.deepEqual(plan, []);
});
