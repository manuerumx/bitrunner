import { test } from "node:test";
import assert from "node:assert/strict";
import { AUG_CATEGORIES, augCategories, orderByPreference, parsePreference } from "/src/lib/augmentations.js";

function aug(name, price) {
  return { name, price };
}

test("augCategories maps each non-neutral multiplier to its category", () => {
  const stats = { hacking: 1.05, hacking_speed: 1.03, faction_rep: 1.1, strength: 1, crime_money: 1.2 };
  assert.deepEqual([...augCategories(stats)].sort(), ["crime", "hacking", "rep"]);
});

test("augCategories files every combat stat and its exp under combat", () => {
  for (const key of ["strength", "defense_exp", "dexterity", "agility_exp"]) {
    assert.deepEqual([...augCategories({ [key]: 1.1 })], ["combat"], key);
  }
});

test("augCategories is empty for a special-effect aug with no multipliers", () => {
  assert.equal(augCategories({ hacking: 1, charisma: 1 }).size, 0);
});

test("orderByPreference with no preference keeps most-expensive-first", () => {
  const ordered = orderByPreference([aug("Cheap", 10), aug("Pricey", 90), aug("Mid", 50)], {}, []);
  assert.deepEqual(ordered.map((a) => a.name), ["Pricey", "Mid", "Cheap"]);
});

test("orderByPreference puts augs touching a preferred category first", () => {
  const stats = { Pricey: { charisma: 1.2 }, Cheap: { hacking: 1.05 } };
  const ordered = orderByPreference([aug("Pricey", 90), aug("Cheap", 10)], stats, ["hacking"]);
  assert.deepEqual(ordered.map((a) => a.name), ["Cheap", "Pricey"]);
});

test("orderByPreference ranks the first listed category above the second", () => {
  const stats = { Rep: { faction_rep: 1.1 }, Hack: { hacking: 1.05 }, Other: { charisma: 1.1 } };
  const augs = [aug("Other", 100), aug("Hack", 20), aug("Rep", 50)];
  const ordered = orderByPreference(augs, stats, ["rep", "hacking"]);
  assert.deepEqual(ordered.map((a) => a.name), ["Rep", "Hack", "Other"]);
});

// An aug boosting both hacking and rep belongs to the better of its tiers, not the worse.
test("orderByPreference ranks a multi-category aug by its best preferred category", () => {
  const stats = { Both: { hacking: 1.05, faction_rep: 1.1 }, Rep: { faction_rep: 1.2 } };
  const ordered = orderByPreference([aug("Rep", 90), aug("Both", 10)], stats, ["hacking", "rep"]);
  assert.deepEqual(ordered.map((a) => a.name), ["Both", "Rep"]);
});

test("orderByPreference keeps most-expensive-first within a tier", () => {
  const stats = { A: { hacking: 1.05 }, B: { hacking: 1.1 }, C: { charisma: 1.1 }, D: { charisma: 1.1 } };
  const augs = [aug("A", 10), aug("C", 5), aug("B", 30), aug("D", 50)];
  const ordered = orderByPreference(augs, stats, ["hacking"]);
  assert.deepEqual(ordered.map((a) => a.name), ["B", "A", "D", "C"]);
});

// Missing stats (the worker failed or skipped a name) must not crash or promote the aug.
test("orderByPreference treats augs with unknown stats as unpreferred", () => {
  const stats = { Hack: { hacking: 1.05 } };
  const ordered = orderByPreference([aug("Unknown", 90), aug("Hack", 10)], stats, ["hacking"]);
  assert.deepEqual(ordered.map((a) => a.name), ["Hack", "Unknown"]);
});

test("parsePreference splits a comma list into categories", () => {
  assert.deepEqual(parsePreference("hacking, rep"), { prefer: ["hacking", "rep"], unknown: [] });
});

test("parsePreference is empty for an empty string", () => {
  assert.deepEqual(parsePreference(""), { prefer: [], unknown: [] });
});

test("parsePreference reports names that are not categories", () => {
  assert.deepEqual(parsePreference("hacking,hax"), { prefer: ["hacking"], unknown: ["hax"] });
});

test("AUG_CATEGORIES lists every category a preference may name", () => {
  assert.deepEqual(
    [...AUG_CATEGORIES].sort(),
    ["bladeburner", "charisma", "combat", "crime", "hacking", "hacknet", "rep", "work"],
  );
});
