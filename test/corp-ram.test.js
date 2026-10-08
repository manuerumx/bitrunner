import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SRC = join(ROOT, "src");

// RAM cost of every ns.corporation function, copied from the game's NetscriptDefinitions.d.ts
// (gitignored, so the table lives here). It does two jobs:
//   1. A name missing from it isn't a corporation function. The old corp-manager.js called
//      setAutoJobAssignment, which doesn't exist; a try/catch hid the error, so no employee
//      ever got a job. That now fails here instead of in the game.
//   2. Corporation calls cost 10-20 GB each, so every corp script's RAM is pinned below.
const CORP_RAM = {
  hireEmployee: 20, upgradeOfficeSize: 20, throwParty: 20, buyTea: 20, hireAdVert: 20, research: 20,
  getOffice: 10, getHireAdVertCost: 10, getHireAdVertCount: 10, getResearchCost: 10, hasResearched: 10,
  setJobAssignment: 20, getOfficeSizeUpgradeCost: 10, sellMaterial: 20, sellProduct: 20,
  discontinueProduct: 20, setSmartSupply: 20, setSmartSupplyOption: 20, buyMaterial: 20,
  bulkPurchase: 20, getWarehouse: 10, getProduct: 10, getMaterial: 10, setMaterialMarketTA1: 20,
  setMaterialMarketTA2: 20, setProductMarketTA1: 20, setProductMarketTA2: 20, exportMaterial: 20,
  cancelExportMaterial: 20, purchaseWarehouse: 20, upgradeWarehouse: 20, makeProduct: 20,
  limitMaterialProduction: 20, limitProductProduction: 20, getUpgradeWarehouseCost: 10,
  hasWarehouse: 10, hasCorporation: 0, canCreateCorporation: 0, createCorporation: 20, hasUnlock: 10,
  getUnlockCost: 10, getUpgradeLevel: 10, getUpgradeLevelCost: 10, getInvestmentOffer: 10,
  getConstants: 0, getIndustryData: 10, getMaterialData: 10, acceptInvestmentOffer: 20, goPublic: 20,
  bribe: 20, getCorporation: 10, getDivision: 10, expandIndustry: 20, expandCity: 20,
  purchaseUnlock: 20, levelUpgrade: 20, issueDividends: 20, issueNewShares: 20, buyBackShares: 20,
  sellShares: 20, getBonusTime: 0, nextUpdate: 0, sellDivision: 20,
};

const BASE_RAM = 1.6;

// Static RAM of each corp script: the 1.6 GB base plus every distinct corporation function it
// names. The other ns calls these scripts make (tprint, print, read, write, enums, ports) are
// 0 GB. Keep `ns.corporation.<fn>` out of comments: this count can't tell them from code.
const CORP_SCRIPTS = {
  "src/tools/corp-boost.js": 81.6,
};

function walk(dir) {
  const files = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) files.push(...walk(full));
    else if (entry.endsWith(".js")) files.push(full);
  }
  return files;
}

function corpFunctions(source) {
  return [...new Set([...source.matchAll(/ns\.corporation\.([A-Za-z0-9]+)/g)].map((m) => m[1]))];
}

test("every ns.corporation call names a real corporation function", () => {
  for (const file of walk(SRC)) {
    for (const fn of corpFunctions(readFileSync(file, "utf8"))) {
      assert.ok(fn in CORP_RAM, `${relative(ROOT, file)}: ns.corporation.${fn} is not a corporation function`);
    }
  }
});

for (const [script, expected] of Object.entries(CORP_SCRIPTS)) {
  test(`${script} needs ${expected} GB`, () => {
    const fns = corpFunctions(readFileSync(join(ROOT, script), "utf8"));
    const ram = BASE_RAM + fns.reduce((total, fn) => total + CORP_RAM[fn], 0);
    assert.equal(Math.round(ram * 10) / 10, expected);
  });
}
