import { test } from "node:test";
import assert from "node:assert/strict";
import { rankBySalary, workableCompanies, promotionBlockers, companyJobField } from "/src/lib/companies.js";

// ── rankBySalary ────────────────────────────────────────────────────────────
//
// tools/sleeve-company.js sends sleeves to the companies whose Chief Executive Officer
// pays most. A company without the position (a noodle bar) reads as salary null.

test("rankBySalary orders companies by salary, highest first", () => {
  const ranked = rankBySalary([
    { company: "Fulcrum Technologies", salary: 2000 },
    { company: "ECorp", salary: 3000 },
    { company: "Four Sigma", salary: 2500 },
  ]);
  assert.deepEqual(ranked, ["ECorp", "Four Sigma", "Fulcrum Technologies"]);
});

test("rankBySalary drops companies that lack the position", () => {
  const ranked = rankBySalary([
    { company: "Noodle Bar", salary: null },
    { company: "ECorp", salary: 3000 },
  ]);
  assert.deepEqual(ranked, ["ECorp"]);
});

// ── workableCompanies ───────────────────────────────────────────────────────
//
// setToCompanyWork refuses a company where the player holds no job.

test("workableCompanies keeps only targets where the player holds a job, in target order", () => {
  const jobs = { "Four Sigma": "Software Engineering Intern", ECorp: "Lead Software Developer" };
  assert.deepEqual(workableCompanies(["ECorp", "MegaCorp", "Four Sigma"], jobs), ["ECorp", "Four Sigma"]);
});

// ── promotionBlockers ───────────────────────────────────────────────────────
//
// The promotion is the player's: it needs the player's skills and the company's rep.
// Listing what falls short tells the user what to train.

const SKILLS = { hacking: 600, strength: 1, defense: 1, dexterity: 1, agility: 1, charisma: 400, intelligence: 0 };

test("promotionBlockers lists each skill and the rep that fall short", () => {
  const next = {
    requiredReputation: 400e3,
    requiredSkills: { ...SKILLS, hacking: 750, charisma: 500, strength: 0, defense: 0, dexterity: 0, agility: 0 },
  };
  assert.deepEqual(promotionBlockers(next, 100e3, SKILLS), [
    { stat: "rep", have: 100e3, need: 400e3 },
    { stat: "hacking", have: 600, need: 750 },
    { stat: "charisma", have: 400, need: 500 },
  ]);
});

test("promotionBlockers is empty when every requirement is met", () => {
  const next = { requiredReputation: 50e3, requiredSkills: { ...SKILLS, hacking: 250 } };
  assert.deepEqual(promotionBlockers(next, 60e3, SKILLS), []);
});

// ── companyJobField ─────────────────────────────────────────────────────────
//
// The player holds one job per company. faction-manager.js re-applies every cycle to pick
// up promotions; applying in another field swaps the job. It must re-apply in the field the
// player already holds, or it undoes sleeve-company.js's Business job with a Software one.

test("companyJobField keeps a Business job in Business", () => {
  assert.equal(companyJobField("Operations Manager"), "Business");
  assert.equal(companyJobField("Chief Executive Officer"), "Business");
});

test("companyJobField defaults to Software with no job or a Software job", () => {
  assert.equal(companyJobField(undefined), "Software");
  assert.equal(companyJobField("Head of Software"), "Software");
});
