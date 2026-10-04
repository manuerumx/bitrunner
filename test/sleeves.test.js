import { test } from "node:test";
import assert from "node:assert/strict";
import { companiesToUnlock, sleeveCompanies } from "/src/lib/companies.js";
import {
  needsReassignment,
  planSleeveSpending,
  chooseSleeveTask,
  assignFactions,
  assignCompanies,
  factionWorkOrder,
  spareFactions,
  needsKarma,
  canBuySleeveAugs,
  FACTION_WORK_TYPES,
} from "/src/lib/sleeves.js";

// ── needsReassignment ───────────────────────────────────────────────────────
//
// sleeve-manager.js re-issues every setTo* call on each 30 s cycle regardless of what the
// sleeve is already doing. Some of those calls restart the task, throwing away partial
// progress (crimes and faction work accumulate cycles). ns.sleeve.getTask() reports the
// live task; matching against it makes the assignment idempotent.

test("needsReassignment is false when the sleeve already commits the desired crime", () => {
  const current = { type: "CRIME", crimeType: "Homicide" };
  assert.equal(needsReassignment(current, { type: "crime", crime: "Homicide" }), false);
});

test("needsReassignment is true when the sleeve commits a different crime", () => {
  const current = { type: "CRIME", crimeType: "Mug" };
  assert.equal(needsReassignment(current, { type: "crime", crime: "Homicide" }), true);
});

test("needsReassignment is true when the task type differs entirely", () => {
  const current = { type: "RECOVERY" };
  assert.equal(needsReassignment(current, { type: "crime", crime: "Mug" }), true);
});

test("needsReassignment is false when the sleeve already works for the desired faction", () => {
  const current = { type: "FACTION", factionName: "BitRunners", factionWorkType: "hacking" };
  const desired = { type: "faction", faction: "BitRunners", workTypes: ["hacking"] };
  assert.equal(needsReassignment(current, desired), false);
});

test("needsReassignment is true when the sleeve works for a different faction", () => {
  const current = { type: "FACTION", factionName: "Netburners", factionWorkType: "hacking" };
  const desired = { type: "faction", faction: "BitRunners", workTypes: ["hacking"] };
  assert.equal(needsReassignment(current, desired), true);
});

test("needsReassignment is false when the sleeve is already recovering", () => {
  assert.equal(needsReassignment({ type: "RECOVERY" }, { type: "recovery" }), false);
});

test("needsReassignment is false when the sleeve is already synchronizing", () => {
  assert.equal(needsReassignment({ type: "SYNCHRO" }, { type: "sync" }), false);
});

test("needsReassignment is false when the sleeve already trains the desired stat", () => {
  const current = { type: "CLASS", classType: "str" };
  assert.equal(needsReassignment(current, { type: "gym", stat: "str" }), false);
});

// getTask() returns null for an idle sleeve, and after a reset every sleeve is idle.
test("needsReassignment is true when the sleeve has no task at all", () => {
  assert.equal(needsReassignment(null, { type: "crime", crime: "Mug" }), true);
});

// ── planSleeveSpending ──────────────────────────────────────────────────────
//
// A new sleeve compounds — it earns from the moment it exists — so it outranks memory on
// an existing one. Memory is the other permanent buy: it survives resets, unlike shock
// and sync which reset with the run.

test("planSleeveSpending buys a new sleeve before upgrading memory", () => {
  const plan = planSleeveSpending({
    money: 1000,
    sleeveCost: 400,
    memoryCosts: [{ sleeveNum: 0, cost: 300 }],
  });
  assert.deepEqual(plan.buy.map((i) => i.name), ["sleeve", "memory-0"]);
});

test("planSleeveSpending upgrades memory when no sleeve is for sale", () => {
  const plan = planSleeveSpending({
    money: 1000,
    sleeveCost: null,
    memoryCosts: [{ sleeveNum: 2, cost: 300 }],
  });
  assert.deepEqual(plan.buy.map((i) => i.name), ["memory-2"]);
});

test("planSleeveSpending honours the reserve fraction", () => {
  const plan = planSleeveSpending({
    money: 1000,
    reserveFraction: 0.9,
    sleeveCost: 400,
    memoryCosts: [],
  });
  assert.deepEqual(plan.buy, []);
});

// Memory is cheapest-first so a partial budget spreads across sleeves rather than
// stalling on the priciest one.
test("planSleeveSpending upgrades the cheapest memory first", () => {
  const plan = planSleeveSpending({
    money: 500,
    sleeveCost: null,
    memoryCosts: [
      { sleeveNum: 0, cost: 400 },
      { sleeveNum: 1, cost: 100 },
    ],
  });
  assert.deepEqual(plan.buy.map((i) => i.name), ["memory-1", "memory-0"]);
});

test("planSleeveSpending buys nothing when broke", () => {
  const plan = planSleeveSpending({ money: 0, sleeveCost: 400, memoryCosts: [] });
  assert.deepEqual(plan.buy, []);
});

// ── needsReassignment: faction work types ───────────────────────────────────
//
// Not every faction offers hacking work, so the manager may land a sleeve on field or
// security work instead. Demanding "hacking" on the next cycle would re-issue the task and
// wipe its progress every 30 s — any work type the task allows is a match.

test("needsReassignment accepts any allowed faction work type", () => {
  const current = { type: "FACTION", factionName: "Tetrads", factionWorkType: "field" };
  const desired = { type: "faction", faction: "Tetrads", workTypes: FACTION_WORK_TYPES };
  assert.equal(needsReassignment(current, desired), false);
});

// ── chooseSleeveTask ────────────────────────────────────────────────────────

const skills = { strength: 5, defense: 5, dexterity: 5, agility: 5 };

// Exp scales with (100 - shock)%, and shock keeps falling on its own while a sleeve works,
// so recovery stops at a threshold rather than at zero.
test("chooseSleeveTask recovers while shock is above the work threshold", () => {
  const sleeve = { shock: 34, sync: 100, skills };
  const ctx = { needKarma: false, faction: null, workShock: 33 };
  assert.deepEqual(chooseSleeveTask(sleeve, ctx), { type: "recovery" });
});

test("chooseSleeveTask goes to work once shock reaches the threshold", () => {
  const sleeve = { shock: 33, sync: 100, skills };
  const ctx = { needKarma: false, faction: null, workShock: 33 };
  assert.notDeepEqual(chooseSleeveTask(sleeve, ctx), { type: "recovery" });
});

test("chooseSleeveTask synchronizes once shock is gone", () => {
  const sleeve = { shock: 0, sync: 40, skills };
  assert.deepEqual(chooseSleeveTask(sleeve, { needKarma: false, faction: null, workShock: 0 }), { type: "sync" });
});

// Homicide is the best karma crime only once the sleeve can land it. A fresh sleeve is
// under 3% on it, so it loops without ever committing one; it takes the likeliest crime
// instead and trains up.
test("chooseSleeveTask picks a karma crime the sleeve can actually land", () => {
  const ctx = { needKarma: true, faction: "CyberSec", workShock: 0 };
  const fresh = { shock: 0, sync: 100, skills };
  assert.deepEqual(chooseSleeveTask(fresh, ctx), { type: "crime", crime: "Shoplift" });
  const strong = { shock: 0, sync: 100, skills: { strength: 100, defense: 100, dexterity: 100, agility: 100 } };
  assert.deepEqual(chooseSleeveTask(strong, ctx), { type: "crime", crime: "Homicide" });
});

// Formulas.exe gives the exact chance for 0 GB; the manager passes it in when owned.
test("chooseSleeveTask uses the supplied success-chance source", () => {
  const sleeve = { shock: 0, sync: 100, skills };
  const chanceOf = (_person, name) => (name === "Homicide" ? 0.9 : 0.1);
  const task = chooseSleeveTask(sleeve, { needKarma: true, faction: null, workShock: 0, chanceOf });
  assert.deepEqual(task, { type: "crime", crime: "Homicide" });
});

// Switching crimes throws away the running one's progress.
test("chooseSleeveTask keeps the running crime over a marginally better one", () => {
  const sleeve = { shock: 0, sync: 100, skills };
  const chanceOf = (_person, name) => ({ Homicide: 0.62, Mug: 1 })[name] ?? 0;
  const ctx = { needKarma: false, faction: null, workShock: 0, chanceOf };
  assert.equal(chooseSleeveTask(sleeve, ctx).crime, "Homicide");
  assert.equal(chooseSleeveTask(sleeve, { ...ctx, currentCrime: "Mug" }).crime, "Mug");
});

test("chooseSleeveTask works the assigned faction once karma is done", () => {
  const sleeve = { shock: 0, sync: 100, skills };
  const task = chooseSleeveTask(sleeve, { needKarma: false, faction: "CyberSec", workShock: 0 });
  assert.deepEqual(task, { type: "faction", faction: "CyberSec", workTypes: FACTION_WORK_TYPES });
});

// Faction rep buys augmentations now; company rep only unlocks a faction to grind later.
test("chooseSleeveTask prefers faction work over company work", () => {
  const sleeve = { shock: 0, sync: 100, skills };
  const task = chooseSleeveTask(sleeve, { needKarma: false, faction: "CyberSec", company: "ECorp", workShock: 0 });
  assert.equal(task.type, "faction");
});

test("chooseSleeveTask works the assigned company when no faction is free", () => {
  const sleeve = { shock: 0, sync: 100, skills };
  const task = chooseSleeveTask(sleeve, { needKarma: false, faction: null, company: "ECorp", workShock: 0 });
  assert.deepEqual(task, { type: "company", company: "ECorp" });
});

test("chooseSleeveTask puts karma ahead of company work", () => {
  const sleeve = { shock: 0, sync: 100, skills };
  const task = chooseSleeveTask(sleeve, { needKarma: true, faction: null, company: "ECorp", workShock: 0 });
  assert.equal(task.type, "crime");
});

// With no faction to work, the old manager sent a sleeve to the gym for strength forever.
test("chooseSleeveTask falls back to a money crime when no faction or company is free", () => {
  const weak = { shock: 0, sync: 100, skills };
  const strong = { shock: 0, sync: 100, skills: { strength: 200, defense: 200, dexterity: 200, agility: 200 } };
  assert.deepEqual(chooseSleeveTask(weak, { needKarma: false, faction: null, workShock: 0 }), { type: "crime", crime: "Shoplift" });
  assert.deepEqual(chooseSleeveTask(strong, { needKarma: false, faction: null, workShock: 0 }), {
    type: "crime",
    crime: "Homicide",
  });
});

test("needsReassignment is false when the sleeve already works at the desired company", () => {
  const desired = { type: "company", company: "ECorp" };
  assert.equal(needsReassignment({ type: "COMPANY", companyName: "ECorp" }, desired), false);
  assert.equal(needsReassignment({ type: "COMPANY", companyName: "NWO" }, desired), true);
});

// ── assignFactions ──────────────────────────────────────────────────────────
//
// The game throws when two sleeves (or a sleeve and the player) work the same faction, so
// each faction goes to at most one sleeve.

test("assignFactions gives each eligible sleeve a different faction", () => {
  const result = assignFactions(
    [
      { sleeveNum: 0, eligible: true, current: null },
      { sleeveNum: 1, eligible: true, current: null },
    ],
    ["CyberSec", "NiteSec"],
  );
  assert.deepEqual([...result], [[0, "CyberSec"], [1, "NiteSec"]]);
});

// Moving a sleeve to a different faction restarts its work, so a sleeve keeps the faction
// it already has as long as it's still available.
test("assignFactions keeps a sleeve on the faction it already works", () => {
  const result = assignFactions(
    [
      { sleeveNum: 0, eligible: true, current: null },
      { sleeveNum: 1, eligible: true, current: "CyberSec" },
    ],
    ["CyberSec", "NiteSec"],
  );
  assert.equal(result.get(1), "CyberSec");
  assert.equal(result.get(0), "NiteSec");
});

test("assignFactions skips excluded factions and ineligible sleeves", () => {
  const result = assignFactions(
    [
      { sleeveNum: 0, eligible: false, current: null },
      { sleeveNum: 1, eligible: true, current: "Slum Snakes" },
      { sleeveNum: 2, eligible: true, current: null },
    ],
    ["Slum Snakes", "CyberSec"],
    { exclude: ["Slum Snakes"] },
  );
  assert.deepEqual([...result], [[0, null], [1, "CyberSec"], [2, null]]);
});

// ── factionWorkOrder ────────────────────────────────────────────────────────
//
// faction-manager.js publishes the factions that still have augmentations needing rep.
// Rep earned anywhere else buys nothing.

test("factionWorkOrder uses the published pending-augment factions, best first", () => {
  const status = { currentFaction: null, pendingFactions: ["NiteSec", "CyberSec"] };
  assert.deepEqual(factionWorkOrder(["CyberSec", "Tian Di Hui", "NiteSec"], status), ["NiteSec", "CyberSec"]);
});

// The game only forbids two sleeves on one faction. The player's faction is the
// top-priority one, so a sleeve works it alongside the player.
test("factionWorkOrder keeps the faction the player is working", () => {
  const status = { currentFaction: "NiteSec", pendingFactions: ["NiteSec", "CyberSec"] };
  assert.deepEqual(factionWorkOrder(["CyberSec", "NiteSec"], status), ["NiteSec", "CyberSec"]);
});

test("factionWorkOrder drops published factions the player is no longer in", () => {
  const status = { currentFaction: null, pendingFactions: ["NiteSec", "CyberSec"] };
  assert.deepEqual(factionWorkOrder(["CyberSec"], status), ["CyberSec"]);
});

// Faction manager disabled, or a status written before it published the list.
test("factionWorkOrder falls back to newest-joined first without a published list", () => {
  assert.deepEqual(factionWorkOrder(["CyberSec", "NiteSec"], null), ["NiteSec", "CyberSec"]);
  assert.deepEqual(factionWorkOrder(["CyberSec", "NiteSec"], { currentFaction: null }), ["NiteSec", "CyberSec"]);
});

// ── spareFactions ───────────────────────────────────────────────────────────
//
// A faction whose augmentations are all within reach on reputation isn't "pending", but
// rep there still builds favor for the next run and pays for NeuroFlux levels — better
// than a money crime for a sleeve with nothing else to do.

test("spareFactions lists joined factions outside the pending list, newest first", () => {
  const status = { pendingFactions: ["NiteSec"] };
  assert.deepEqual(spareFactions(["CyberSec", "NiteSec", "Tian Di Hui"], status), ["Tian Di Hui", "CyberSec"]);
});

// Without a published list factionWorkOrder already offers every joined faction.
test("spareFactions is empty without a published list", () => {
  assert.deepEqual(spareFactions(["CyberSec", "NiteSec"], null), []);
});

// ── companies ───────────────────────────────────────────────────────────────

test("companiesToUnlock lists megacorps whose faction is not joined yet", () => {
  const todo = companiesToUnlock(["ECorp", "Fulcrum Secret Technologies"]);
  assert.equal(todo.includes("ECorp"), false);
  // The one megacorp whose faction has a different name.
  assert.equal(todo.includes("Fulcrum Technologies"), false);
  assert.equal(todo.includes("NWO"), true);
  assert.equal(todo.length, 8);
});

// A sleeve can only work where the player holds a job, and company rep is only worth
// earning while it still unlocks a faction.
test("sleeveCompanies keeps held jobs at companies with a faction still to unlock", () => {
  const jobs = { ECorp: "Software Engineer", NWO: "IT Intern", FoodNStuff: "Employee" };
  assert.deepEqual(sleeveCompanies(jobs, ["ECorp"]), ["NWO"]);
  assert.deepEqual(sleeveCompanies({}, []), []);
});

test("assignCompanies gives each sleeve its own company and keeps current ones", () => {
  const result = assignCompanies(
    [
      { sleeveNum: 0, eligible: true, current: null },
      { sleeveNum: 1, eligible: true, current: "NWO" },
      { sleeveNum: 2, eligible: false, current: null },
      { sleeveNum: 3, eligible: true, current: null },
    ],
    ["NWO", "ECorp"],
  );
  assert.deepEqual([...result], [[0, "ECorp"], [1, "NWO"], [2, null], [3, null]]);
});

// ── needsKarma ──────────────────────────────────────────────────────────────

test("needsKarma is true only while a gang is possible, absent, and karma is short", () => {
  assert.equal(needsKarma({ karma: -100, inGang: false, canGang: true }), true);
  assert.equal(needsKarma({ karma: -60_000, inGang: false, canGang: true }), false);
  assert.equal(needsKarma({ karma: -100, inGang: true, canGang: true }), false);
  // Without Source-File 2 karma unlocks nothing, so crime for karma is wasted time.
  assert.equal(needsKarma({ karma: -100, inGang: false, canGang: false }), false);
});

// ── canBuySleeveAugs ────────────────────────────────────────────────────────

test("canBuySleeveAugs requires zero shock", () => {
  assert.equal(canBuySleeveAugs({ shock: 0 }), true);
  assert.equal(canBuySleeveAugs({ shock: 0.5 }), false);
});
