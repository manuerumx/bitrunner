# BN3 Corporation Rewrite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the broken `corp-manager.js` with six small one-shot corp tools that can take a BitNode 3 corporation from nothing to a producing Agriculture division, through four investment rounds, to going public and paying dividends.

**Architecture:** Every decision is a pure function in `src/lib/corp.js`, tested in `test/corp.test.js`. Each tool in `src/tools/corp-*.js` is a thin ONE-SHOT the daemon re-runs about three times every five minutes. Each handles one concern, is gated on the unlock its calls need, and takes `dry`. No corp script stays resident: every setting the tools make persists in the game (jobs, Smart Supply, sell orders, Market-TA.II), and boost materials aren't used up, so nothing needs doing every corp cycle. A shared in-memory mock (`test/corp-mock.mjs`) throws where the game would, so a missed gate fails a test.

**Tech Stack:** Bitburner NS2 JavaScript (ES modules, JSDoc types checked by `tsc`), `node:test`, game paths `/src/...` mapped by `test/loader-hooks.mjs`.

**Spec:** No separate spec file. The requirements are the 2026-10-08 audit of the old corp code against `NetscriptDefinitions.d.ts`, summarized under Background below.

## Background (the audit this plan implements)

The old `src/advanced/corp-manager.js` (and `src/tools/corp-boost.js`) could never produce anything. Every failure was swallowed by an empty `try {} catch {}`:

- `setAutoJobAssignment` is not a corporation function (the real one is `setJobAssignment`), so no employee ever got a job.
- `getProduct` and `sellProduct` were called without their `city` argument.
- Nothing bought the **Smart Supply**, **Warehouse API** or **Office API** unlocks. Without Smart Supply nothing buys Agriculture's Water and Chemicals. Without the APIs, every office and warehouse call throws.
- No `createCorporation` (BN3 offers seed money: `createCorporation(name, false)`), no `expandCity` (stuck in Sector-12), no `upgradeOfficeSize` (stuck at 3 employees).
- Market-TA.II is **research**, not an unlock, and was never acquired.
- Investment stopped at round 2. Nothing went public or paid dividends, so corp profit never reached the player.
- `corpBoostTargets` had Real Estate at 2,700 units. For Agriculture, Real Estate has the largest factor (0.72), and the optimal mix is computable (see `optimalBoostAmounts`).
- Resident RAM was about 280 GB, because corporation calls cost 10–20 GB each.

**Out of scope:** product industries (Tobacco etc.), exports between divisions, `hireAdVert`, and bribes. Bribing costs `bribeAmountPerReputation` ($1b/rep). Donating via `faction-donate.js` costs about $1m/rep at base, and BN3 allows donations from 75 favor, so donations come first.

## Global Constraints

- Work on branch `bn3-corp` (created from `main`). Don't touch `faction-donate` work.
- **Never wrap a corporation call in an empty `catch`.** Gate on `hasCorporation()` / `hasUnlock(...)` / `hasWarehouse(...)` instead, and let real game errors crash the one-shot where they can be seen. The only `try/catch` allowed is around `JSON.parse` of a file.
- Every helper that takes `ns` has a `/** @param {NS} ns */` JSDoc, so `tsc` checks API names and argument lists.
- Don't write `ns.corporation.<fn>` in comments: `test/corp-ram.test.js` counts that text as a call. Name functions bare (`getOffice`).
- Every corp tool is idempotent (the daemon runs it about 3 times per burst) and takes `dry` as `ns.args[0]`: print the plan with `tlog`, change nothing, write no files or ports.
- Logging: `tlog` (terminal) for milestones (corp created, unlock or city bought, round accepted, IPO, dividends) and for everything in `dry`. Use `log` (script log) for routine actions.
- No corp tool spends below `DEFAULTS.corpCashReserve`.
- Pure decision logic lives in `src/lib/corp.js`. Tools only read state, call the planners and act.
- Commits end with the trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. The pre-commit hook runs `tsc` and the full suite, so every commit must be green.
- Test commands: one file with `NODE_OPTIONS='--import ./test/setup.mjs' node --test test/<file>.test.js`, then everything with `npm test` and `npm run check`.

## Review Focus

1. **Corp funds at or below the reserve** (salaries keep draining them): nothing paid is bought. This is pinned by the "never spends the reserve" / "waits for money" tests in Tasks 2 and 4 and the `budget: -1e9` case in Task 5.
2. **A division created by hand in the UI under another name**: `corp-setup.js` must reuse it, not start a second Agriculture division. Pinned in Task 2.
3. **Only one of the two API unlocks owned**: each tool runs exactly the parts its unlock allows. Market-TA.II needs the Office API too, because checking research is an Office API call. Pinned in Tasks 5 and 6.
4. **Employees hired by hand sitting in Unassigned** (or Interns): `corp-office.js` reassigns them, cutting before raising. Pinned in Task 3.
5. **Missing or corrupt `/data/corp-invest.txt`**: treated as no record, never as a reason to accept. Pinned in Task 7.

---

### Task 1: API-name and RAM guard; retire corp-manager.js

**Files:**
- Create: `test/corp-ram.test.js`
- Delete: `src/advanced/corp-manager.js`
- Modify: `src/lib/constants.js` (MANAGERS roster), `src/lib/corp.js` (header comment)

**Interfaces:**
- Produces: `CORP_SCRIPTS` map in `test/corp-ram.test.js`. Every later task adds its script and RAM figure to it.

- [ ] **Step 1: Write the guard test**

Create `test/corp-ram.test.js`:

```js
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
```

- [ ] **Step 2: Run it and watch it catch the old bug**

Run: `NODE_OPTIONS='--import ./test/setup.mjs' node --test test/corp-ram.test.js`
Expected: FAIL. `src/advanced/corp-manager.js: ns.corporation.setAutoJobAssignment is not a corporation function`

- [ ] **Step 3: Retire the manager**

```bash
git rm src/advanced/corp-manager.js
```

In `src/lib/constants.js`, delete this roster line:

```js
  { id: "corp", script: "/src/advanced/corp-manager.js", name: "Corporation", priority: 11, phase: 6 },
```

In `src/lib/corp.js`, replace the header comment (lines 1–6) with:

```js
// Corporation decision logic, kept pure so it is testable without the (expensive) corp API.
//
// Corporation calls cost 10-20 GB each. test/corp-ram.test.js pins every corp script's RAM and
// rejects names that aren't corporation functions; run tools/ram-report.js api to see what
// the game actually charges.
```

- [ ] **Step 4: Run everything**

Run: `npm test && npm run check`
Expected: PASS (the old manager's only consumers were itself and the roster).

- [ ] **Step 5: Commit**

```bash
git add test/corp-ram.test.js src/lib/constants.js src/lib/corp.js
git commit -m "Retire corp-manager.js and guard corp API names and RAM

The manager could never produce: it called setAutoJobAssignment, which
doesn't exist, and an empty catch hid it. corp-ram.test.js now rejects
any ns.corporation name that isn't a real function and pins each corp
script's RAM.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: corp-setup.js: corporation, division, cities, unlocks

**Files:**
- Create: `src/tools/corp-setup.js`, `test/corp-mock.mjs`, `test/corp-setup.test.js`
- Modify: `src/lib/corp.js`, `test/corp.test.js`, `src/lib/constants.js`, `globals.d.ts`, `test/corp-ram.test.js`

**Interfaces:**
- Produces in `src/lib/corp.js`: `SETUP_UNLOCKS_FIRST: CorpUnlockName[]`, `SETUP_UNLOCKS_LAST: CorpUnlockName[]`, typedef `SetupStep = {kind: "unlock" | "city", name: string, cost: number}`, and `planSetup({unlocks, cities, allCities, unlockCosts, cityCost, funds, reserve}) → {buy: SetupStep[], waiting: SetupStep | null}`.
- Produces `test/corp-mock.mjs`: `makeCorpNs(options) → {ns, state}`, `makeDivision(over)`, `makeOffice(over)`, `makeWarehouse(over)`, `callsTo(state, name) → args[][]`, `AGRICULTURE`. It covers **every** corp call Tasks 2–7 use. Later tasks only consume it.
- Produces in DEFAULTS: `corpName`, `corpIndustry`, `corpDivisionName`, `corpCashReserve`.
- Produces globals: `CorpIndustryName`, `CorpUnlockName`.

- [ ] **Step 1: Write the planSetup tests**

In `test/corp.test.js`, add `planSetup` to the import from `/src/lib/corp.js`, then append:

```js
// ── planSetup ───────────────────────────────────────────────────────────────

const ALL_CITIES = ["Aevum", "Chongqing", "Sector-12", "New Tokyo", "Ishima", "Volhaven"];
const UNLOCK_COSTS = { "Smart Supply": 25e9, "Warehouse API": 50e9, "Office API": 50e9 };

function setup(over = {}) {
  return planSetup({
    unlocks: [],
    cities: ["Sector-12"],
    allCities: ALL_CITIES,
    unlockCosts: UNLOCK_COSTS,
    cityCost: 4e9,
    funds: 1e12,
    reserve: 1e9,
    ...over,
  });
}

const names = (plan) => plan.buy.map((step) => step.name);

test("planSetup buys Smart Supply, then the missing cities, then the API unlocks", () => {
  const plan = setup();
  assert.deepEqual(names(plan), [
    "Smart Supply", "Aevum", "Chongqing", "New Tokyo", "Ishima", "Volhaven", "Warehouse API", "Office API",
  ]);
  assert.equal(plan.waiting, null);
});

// A cheap later step must not spend money an earlier, more important one is waiting for.
test("planSetup stops at the first step it can't afford", () => {
  const plan = setup({ funds: 1e9 + 25e9 + 8e9 + 1 });
  assert.deepEqual(names(plan), ["Smart Supply", "Aevum", "Chongqing"]);
  assert.deepEqual(plan.waiting, { kind: "city", name: "New Tokyo", cost: 4e9 });
});

test("planSetup never spends the reserve", () => {
  const plan = setup({ funds: 25e9 + 1e9 - 1 });
  assert.deepEqual(plan.buy, []);
  assert.equal(plan.waiting?.name, "Smart Supply");
});

test("planSetup has nothing to do once everything is owned", () => {
  const plan = setup({ unlocks: ["Smart Supply", "Warehouse API", "Office API"], cities: ALL_CITIES });
  assert.deepEqual(plan, { buy: [], waiting: null });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `NODE_OPTIONS='--import ./test/setup.mjs' node --test test/corp.test.js`
Expected: FAIL with `SyntaxError: The requested module '/src/lib/corp.js' does not provide an export named 'planSetup'`

- [ ] **Step 3: Implement planSetup**

Append to `src/lib/corp.js`:

```js
// ── Setup ───────────────────────────────────────────────────────────────────

// One-time unlocks corp-setup.js buys, on either side of the city expansion. Smart Supply
// comes before the cities: without it nothing buys Agriculture's Water and Chemicals, so
// nothing is produced. The API unlocks come last: what they gate (hiring, warehouses, sell
// orders) can be done by hand in the UI for free, and they cost a large share of the seed money.
/** @type {CorpUnlockName[]} */
export const SETUP_UNLOCKS_FIRST = ["Smart Supply"];
/** @type {CorpUnlockName[]} */
export const SETUP_UNLOCKS_LAST = ["Warehouse API", "Office API"];

/** @typedef {{kind: "unlock" | "city", name: string, cost: number}} SetupStep */

/**
 * @param {"unlock" | "city"} kind
 * @param {string} name
 * @param {number} cost
 * @returns {SetupStep}
 */
const setupStep = (kind, name, cost) => ({ kind, name, cost });

/**
 * The setup purchases to make now, in order, and the first one still waiting for money.
 *
 * Order: SETUP_UNLOCKS_FIRST, the cities the division isn't in yet, SETUP_UNLOCKS_LAST. It is
 * strict: planning stops at the first step that doesn't fit in `funds - reserve`, so a cheap
 * later step never spends money an earlier, more important one is waiting for.
 *
 * Creating the corporation and the division come before this (corp-setup.js does them
 * directly): the city list only exists once there is a division.
 *
 * @param {{unlocks: string[], cities: string[], allCities: string[],
 *          unlockCosts: Record<string, number>, cityCost: number,
 *          funds: number, reserve: number}} input
 * @returns {{buy: SetupStep[], waiting: SetupStep | null}}
 */
export function planSetup({ unlocks, cities, allCities, unlockCosts, cityCost, funds, reserve }) {
  const missing = (/** @type {string[]} */ names) => names.filter((name) => !unlocks.includes(name));
  const steps = [
    ...missing(SETUP_UNLOCKS_FIRST).map((name) => setupStep("unlock", name, unlockCosts[name])),
    ...allCities.filter((city) => !cities.includes(city)).map((name) => setupStep("city", name, cityCost)),
    ...missing(SETUP_UNLOCKS_LAST).map((name) => setupStep("unlock", name, unlockCosts[name])),
  ];

  const buy = [];
  let budget = funds - reserve;
  for (const step of steps) {
    if (step.cost > budget) return { buy, waiting: step };
    buy.push(step);
    budget -= step.cost;
  }
  return { buy, waiting: null };
}
```

Add to `globals.d.ts`, directly under the `CorpMaterialName` line:

```ts
  type CorpIndustryName = Parameters<NS["corporation"]["expandIndustry"]>[0];
  type CorpUnlockName = Parameters<NS["corporation"]["purchaseUnlock"]>[0];
```

- [ ] **Step 4: Run the lib tests**

Run: `NODE_OPTIONS='--import ./test/setup.mjs' node --test test/corp.test.js`
Expected: PASS

- [ ] **Step 5: Create the corporation mock**

Create `test/corp-mock.mjs` (it isn't a `*.test.js`, so the runner doesn't run it on its own):

```js
// An in-memory corporation behind the ns.corporation calls the corp tools make. Every call that
// changes something is recorded in `state.calls` as [name, ...args]. Calls the game would reject
// (no corporation, a missing API unlock, too little money) throw here too, so a tool that skips
// a check fails its test instead of passing quietly.

// Warehouse space per unit (getMaterialData(name).size).
const MATERIAL_SIZES = { Hardware: 0.06, Robots: 0.5, "AI Cores": 0.1, "Real Estate": 0.005, Plants: 0.05, Food: 0.03 };

export const AGRICULTURE = {
  startingCost: 40e9,
  hardwareFactor: 0.2,
  robotFactor: 0.3,
  aiCoreFactor: 0.3,
  realEstateFactor: 0.72,
  producedMaterials: ["Plants", "Food"],
  makesProducts: false,
};

const CITY_ENUM = {
  Aevum: "Aevum",
  Chongqing: "Chongqing",
  Sector12: "Sector-12",
  NewTokyo: "New Tokyo",
  Ishima: "Ishima",
  Volhaven: "Volhaven",
};

const UNLOCK_COSTS = { "Smart Supply": 25e9, "Warehouse API": 50e9, "Office API": 50e9 };

export function makeOffice(over = {}) {
  return {
    size: 3,
    numEmployees: 0,
    avgEnergy: 100,
    maxEnergy: 100,
    avgMorale: 100,
    maxMorale: 100,
    ...over,
    employeeJobs: {
      Operations: 0,
      Engineer: 0,
      Business: 0,
      Management: 0,
      "Research & Development": 0,
      Intern: 0,
      Unassigned: 0,
      ...over.employeeJobs,
    },
  };
}

export function makeWarehouse(over = {}) {
  return { level: 1, size: 100, sizeUsed: 0, smartSupplyEnabled: false, ...over };
}

// One division. `cities` defaults to the keys of `offices`.
export function makeDivision(over = {}) {
  const offices = over.offices ?? { "Sector-12": makeOffice() };
  return {
    name: "Agri",
    industry: "Agriculture",
    researchPoints: 0,
    research: [],
    warehouses: { "Sector-12": makeWarehouse() },
    materials: {},
    ...over,
    offices,
    cities: over.cities ?? Object.keys(offices),
  };
}

export function makeCorpNs({
  args = [],
  hasCorp = true,
  canCreate = "Success",
  funds = 150e9,
  isPublic = false,
  dividendRate = 0,
  unlocks = [],
  divisions = [makeDivision()],
  offer = { funds: 0, shares: 0, round: 1 },
  files = {},
  upgradeCosts = {},
  researchCosts = {},
  prices = {},
} = {}) {
  const state = {
    hasCorp,
    funds,
    public: isPublic,
    dividendRate,
    unlocks: new Set(unlocks),
    divisions: Object.fromEntries(divisions.map((d) => [d.name, d])),
    offer,
    files: { ...files },
    ports: {},
    calls: [],
    output: [],
    log: [],
  };
  const record = (...call) => state.calls.push(call);
  const corp = () => {
    if (!state.hasCorp) throw new Error("You must own a corporation");
  };
  const needs = (unlock) => {
    corp();
    if (!state.unlocks.has(unlock)) throw new Error(`You do not have access to this API (${unlock})`);
  };
  const spend = (cost) => {
    if (cost > state.funds) throw new Error("Insufficient funds");
    state.funds -= cost;
  };
  const division = (name) => {
    const d = state.divisions[name];
    if (!d) throw new Error(`No division named ${name}`);
    return d;
  };
  const office = (div, city) => {
    const o = division(div).offices[city];
    if (!o) throw new Error(`No office in ${city}`);
    return o;
  };
  const warehouse = (div, city) => {
    const w = division(div).warehouses[city];
    if (!w) throw new Error(`No warehouse in ${city}`);
    return w;
  };
  const material = (div, city, name) => {
    const byCity = (division(div).materials[city] ??= {});
    return (byCity[name] ??= {
      name,
      stored: 0,
      marketPrice: prices[name] ?? 1000,
      desiredSellAmount: 0,
      desiredSellPrice: 0,
    });
  };

  const ns = {
    args,
    tprint: (msg) => state.output.push(String(msg)),
    print: (msg) => state.log.push(String(msg)),
    read: (file) => state.files[file] ?? "",
    write: (file, data) => {
      state.files[file] = data;
    },
    clearPort: (port) => {
      delete state.ports[port];
    },
    writePort: (port, data) => {
      state.ports[port] = data;
    },
    enums: { CityName: CITY_ENUM },
    corporation: {
      // ── corporation ──
      hasCorporation: () => state.hasCorp,
      canCreateCorporation: () => (state.hasCorp ? "CorporationExists" : canCreate),
      createCorporation: (name, selfFund) => {
        record("createCorporation", name, selfFund);
        state.hasCorp = true;
        return true;
      },
      getConstants: () => ({
        officeInitialCost: 4e9,
        warehouseInitialCost: 5e9,
        teaCostPerEmployee: 500e3,
        dividendMaxRate: 1,
      }),
      getCorporation: () => {
        corp();
        return {
          funds: state.funds,
          revenue: 2e6,
          expenses: 1e6,
          public: state.public,
          dividendRate: state.dividendRate,
          divisions: Object.keys(state.divisions),
        };
      },
      getDivision: (name) => {
        corp();
        const d = division(name);
        return { name: d.name, industry: d.industry, cities: [...d.cities], researchPoints: d.researchPoints };
      },
      getIndustryData: (industry) => {
        if (industry !== "Agriculture") throw new Error(`Mock has no data for ${industry}`);
        return AGRICULTURE;
      },
      expandIndustry: (industry, name) => {
        corp();
        record("expandIndustry", industry, name);
        spend(AGRICULTURE.startingCost);
        state.divisions[name] = makeDivision({ name, industry });
      },
      expandCity: (div, city) => {
        corp();
        record("expandCity", div, city);
        spend(4e9);
        division(div).cities.push(city);
        division(div).offices[city] = makeOffice();
      },
      hasUnlock: (name) => {
        corp();
        return state.unlocks.has(name);
      },
      getUnlockCost: (name) => {
        corp();
        return UNLOCK_COSTS[name];
      },
      purchaseUnlock: (name) => {
        corp();
        record("purchaseUnlock", name);
        if (state.unlocks.has(name)) throw new Error(`Already have ${name}`);
        spend(UNLOCK_COSTS[name]);
        state.unlocks.add(name);
      },
      getUpgradeLevelCost: (name) => {
        corp();
        return upgradeCosts[name] ?? 1e15;
      },
      levelUpgrade: (name) => {
        corp();
        record("levelUpgrade", name);
        spend(upgradeCosts[name] ?? 1e15);
      },
      getInvestmentOffer: () => {
        corp();
        return { ...state.offer };
      },
      acceptInvestmentOffer: () => {
        corp();
        record("acceptInvestmentOffer");
        state.funds += state.offer.funds;
        state.offer = { funds: 0, shares: 0, round: state.offer.round + 1 };
        return true;
      },
      goPublic: (shares) => {
        corp();
        record("goPublic", shares);
        if (state.public) throw new Error("Already public");
        state.public = true;
        return true;
      },
      issueDividends: (rate) => {
        corp();
        if (!state.public) throw new Error("Must be public");
        record("issueDividends", rate);
        state.dividendRate = rate;
      },

      // ── Office API ──
      getOffice: (div, city) => {
        needs("Office API");
        return structuredClone(office(div, city));
      },
      getOfficeSizeUpgradeCost: (div, city, size) => {
        needs("Office API");
        return 1e9 * size;
      },
      upgradeOfficeSize: (div, city, size) => {
        needs("Office API");
        record("upgradeOfficeSize", div, city, size);
        spend(1e9 * size);
        office(div, city).size += size;
      },
      hireEmployee: (div, city, position = "Unassigned") => {
        needs("Office API");
        record("hireEmployee", div, city);
        const o = office(div, city);
        if (o.numEmployees >= o.size) return false;
        o.numEmployees++;
        o.employeeJobs[position]++;
        return true;
      },
      setJobAssignment: (div, city, job, amount) => {
        needs("Office API");
        record("setJobAssignment", div, city, job, amount);
        const jobs = office(div, city).employeeJobs;
        const moved = Math.min(amount - jobs[job], jobs.Unassigned);
        jobs[job] += moved;
        jobs.Unassigned -= moved;
        return jobs[job] === amount;
      },
      buyTea: (div, city) => {
        needs("Office API");
        record("buyTea", div, city);
        const o = office(div, city);
        spend(500e3 * o.numEmployees);
        o.avgEnergy = o.maxEnergy;
        return true;
      },
      throwParty: (div, city, perEmployee) => {
        needs("Office API");
        record("throwParty", div, city, perEmployee);
        const o = office(div, city);
        spend(perEmployee * o.numEmployees);
        o.avgMorale = o.maxMorale;
        return 1;
      },
      hasResearched: (div, name) => {
        needs("Office API");
        return division(div).research.includes(name);
      },
      getResearchCost: (div, name) => {
        needs("Office API");
        return researchCosts[name] ?? 1e12;
      },
      research: (div, name) => {
        needs("Office API");
        record("research", div, name);
        const d = division(div);
        const cost = researchCosts[name] ?? 1e12;
        if (cost > d.researchPoints) throw new Error("Not enough research points");
        d.researchPoints -= cost;
        d.research.push(name);
      },

      // ── Warehouse API ──
      hasWarehouse: (div, city) => {
        needs("Warehouse API");
        return city in division(div).warehouses;
      },
      purchaseWarehouse: (div, city) => {
        needs("Warehouse API");
        record("purchaseWarehouse", div, city);
        if (city in division(div).warehouses) throw new Error(`Already have a warehouse in ${city}`);
        spend(5e9);
        division(div).warehouses[city] = makeWarehouse();
      },
      getWarehouse: (div, city) => {
        needs("Warehouse API");
        return { ...warehouse(div, city) };
      },
      getUpgradeWarehouseCost: (div, city, amt = 1) => {
        needs("Warehouse API");
        return 2e9 * amt;
      },
      upgradeWarehouse: (div, city, amt = 1) => {
        needs("Warehouse API");
        record("upgradeWarehouse", div, city, amt);
        spend(2e9 * amt);
        warehouse(div, city).level += amt;
        warehouse(div, city).size += 100 * amt;
      },
      setSmartSupply: (div, city, enabled) => {
        needs("Warehouse API");
        if (!state.unlocks.has("Smart Supply")) throw new Error("You don't have Smart Supply");
        record("setSmartSupply", div, city, enabled);
        warehouse(div, city).smartSupplyEnabled = enabled;
      },
      getMaterial: (div, city, name) => {
        needs("Warehouse API");
        return { ...material(div, city, name) };
      },
      sellMaterial: (div, city, name, amount, price) => {
        needs("Warehouse API");
        record("sellMaterial", div, city, name, amount, price);
        Object.assign(material(div, city, name), { desiredSellAmount: amount, desiredSellPrice: price });
      },
      bulkPurchase: (div, city, name, amount) => {
        needs("Warehouse API");
        record("bulkPurchase", div, city, name, amount);
        const m = material(div, city, name);
        spend(m.marketPrice * amount);
        m.stored += amount;
        warehouse(div, city).sizeUsed += amount * MATERIAL_SIZES[name];
      },
      setMaterialMarketTA2: (div, city, name, on) => {
        needs("Warehouse API");
        if (!division(div).research.includes("Market-TA.II")) throw new Error("Market-TA.II not researched");
        record("setMaterialMarketTA2", div, city, name, on);
      },
    },
  };
  return { ns, state };
}

// The calls named `name`, without the name.
export function callsTo(state, name) {
  return state.calls.filter((call) => call[0] === name).map((call) => call.slice(1));
}
```

- [ ] **Step 6: Write the tool tests**

Create `test/corp-setup.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { main } from "/src/tools/corp-setup.js";
import { callsTo, makeCorpNs, makeDivision } from "./corp-mock.mjs";

const EVERY_UNLOCK = ["Smart Supply", "Warehouse API", "Office API"];

// Seed money 150b: division 40b, Smart Supply 25b, five cities 20b and the Warehouse API 50b
// fit above the 1b reserve; the Office API (50b more) has to wait.
test("from nothing it creates the corp with seed money and buys in order until money runs out", async () => {
  const { ns, state } = makeCorpNs({ hasCorp: false, divisions: [] });
  await main(ns);
  assert.deepEqual(state.calls.map((call) => call[0]), [
    "createCorporation", "expandIndustry", "purchaseUnlock",
    "expandCity", "expandCity", "expandCity", "expandCity", "expandCity", "purchaseUnlock",
  ]);
  assert.deepEqual(callsTo(state, "createCorporation"), [["Bitrunner", false]]);
  assert.deepEqual(callsTo(state, "expandIndustry"), [["Agriculture", "Agri"]]);
  assert.deepEqual(callsTo(state, "purchaseUnlock"), [["Smart Supply"], ["Warehouse API"]]);
});

test("it does nothing where seed money isn't offered", async () => {
  const { ns, state } = makeCorpNs({ hasCorp: false, canCreate: "UseSeedMoneyOutsideBN3", divisions: [] });
  await main(ns);
  assert.deepEqual(state.calls, []);
});

// A division made by hand in the UI, under another name, must not be duplicated.
test("it uses an existing division of the industry whatever its name", async () => {
  const { ns, state } = makeCorpNs({ divisions: [makeDivision({ name: "Farm" })], unlocks: EVERY_UNLOCK, funds: 1e12 });
  await main(ns);
  assert.deepEqual(callsTo(state, "expandIndustry"), []);
  assert.equal(callsTo(state, "expandCity").length, 5);
  assert.ok(callsTo(state, "expandCity").every(([div]) => div === "Farm"));
});

test("it never spends the reserve", async () => {
  const { ns, state } = makeCorpNs({ funds: 25e9 + 1e9 - 1 });
  await main(ns);
  assert.deepEqual(state.calls, []);
});

test("a second run has nothing left to buy", async () => {
  const { ns, state } = makeCorpNs({ hasCorp: false, divisions: [], funds: 1e12 });
  await main(ns);
  const first = state.calls.length;
  await main(ns);
  assert.equal(state.calls.length, first);
});

test("dry reports the plan and buys nothing", async () => {
  const { ns, state } = makeCorpNs({ args: ["dry"], funds: 1e12 });
  await main(ns);
  assert.deepEqual(state.calls, []);
  assert.ok(state.output.some((line) => line.includes("would buy the Smart Supply unlock")));
});
```

- [ ] **Step 7: Run them to see them fail**

Run: `NODE_OPTIONS='--import ./test/setup.mjs' node --test test/corp-setup.test.js`
Expected: FAIL with `Cannot find module` for `/src/tools/corp-setup.js`

- [ ] **Step 8: Add the defaults and roster entry**

In `src/lib/constants.js` DEFAULTS, insert directly above the line `  // Boost materials multiply a division's production while held. Targets are per city and`:

```js
  // ── Corporation (tools/corp-*.js) ──
  corpName: "Bitrunner",
  corpIndustry: "Agriculture",
  // Name for the division corp-setup.js creates. An existing division of corpIndustry is used
  // whatever its name, so one made by hand in the UI is never duplicated.
  corpDivisionName: "Agri",
  // Corp funds no corp tool spends: salaries are paid every cycle.
  corpCashReserve: 1e9,
```

In MANAGERS, insert directly above the `corp-boost` line:

```js
  { id: "corp-setup", script: "/src/tools/corp-setup.js", name: "Corp Setup", priority: 11, phase: 6, oneShot: true },
```

- [ ] **Step 9: Implement the tool**

Create `src/tools/corp-setup.js`:

```js
import { planSetup, SETUP_UNLOCKS_FIRST, SETUP_UNLOCKS_LAST } from "/src/lib/corp.js";
import { DEFAULTS } from "/src/lib/constants.js";
import { formatMoney, log, tlog } from "/src/lib/utils.js";

// Takes the corporation from nothing to a division in all six cities, then buys the Warehouse
// API and Office API unlocks the other corp tools need.
//
//   run /src/tools/corp-setup.js        buy what is affordable now
//   run /src/tools/corp-setup.js dry    show the plan and its costs, buy nothing
//
// The corporation is created with the government's seed money, which only BitNode 3 offers.
// Elsewhere self-funding ($150b of your own money) is left to you.
//
// ONE-SHOT. The daemon runs it about three times every five minutes, so it is idempotent: each
// run buys the next steps it can afford, in planSetup's order, and stops at the first it can't.
// Game errors are not caught: a failed purchase should be seen, not skipped.

/** @param {SetupStep} step */
function describe(step) {
  return step.kind === "unlock" ? `the ${step.name} unlock` : `an office in ${step.name}`;
}
/** @typedef {import("/src/lib/corp.js").SetupStep} SetupStep */

/** @param {NS} ns */
export async function main(ns) {
  const dryRun = String(ns.args[0] ?? "").toLowerCase() === "dry";
  const say = (/** @type {string} */ msg) => (dryRun ? tlog(ns, msg) : log(ns, msg));

  if (!ns.corporation.hasCorporation()) {
    const check = ns.corporation.canCreateCorporation(false);
    if (check !== "Success") {
      say(`corp-setup: can't create a corporation with seed money (${check})`);
      return;
    }
    if (dryRun) {
      tlog(ns, `corp-setup: would create "${DEFAULTS.corpName}" with seed money`);
      return;
    }
    ns.corporation.createCorporation(DEFAULTS.corpName, false);
    tlog(ns, `corp-setup: created "${DEFAULTS.corpName}" with seed money`);
  }

  const corp = ns.corporation.getCorporation();
  const industry = /** @type {CorpIndustryName} */ (DEFAULTS.corpIndustry);
  let funds = corp.funds;

  // Found by industry, not name, so a division made by hand in the UI is used, not duplicated.
  let divName = corp.divisions.find((name) => ns.corporation.getDivision(name).industry === industry);
  if (!divName) {
    const cost = ns.corporation.getIndustryData(industry).startingCost;
    if (cost > funds - DEFAULTS.corpCashReserve) {
      say(`corp-setup: waiting for ${formatMoney(cost)} to start the ${industry} division`);
      return;
    }
    if (dryRun) {
      tlog(ns, `corp-setup: would start the ${industry} division for ${formatMoney(cost)}`);
      return;
    }
    ns.corporation.expandIndustry(industry, DEFAULTS.corpDivisionName);
    divName = DEFAULTS.corpDivisionName;
    funds -= cost;
    tlog(ns, `corp-setup: started the ${industry} division "${divName}" for ${formatMoney(cost)}`);
  }

  const allUnlocks = [...SETUP_UNLOCKS_FIRST, ...SETUP_UNLOCKS_LAST];
  const unlocks = allUnlocks.filter((name) => ns.corporation.hasUnlock(name));
  /** @type {Record<string, number>} */
  const unlockCosts = {};
  for (const name of allUnlocks) {
    if (!unlocks.includes(name)) unlockCosts[name] = ns.corporation.getUnlockCost(name);
  }

  const { buy, waiting } = planSetup({
    unlocks,
    cities: ns.corporation.getDivision(divName).cities,
    allCities: Object.values(ns.enums.CityName),
    unlockCosts,
    cityCost: ns.corporation.getConstants().officeInitialCost,
    funds,
    reserve: DEFAULTS.corpCashReserve,
  });

  for (const step of buy) {
    if (dryRun) {
      tlog(ns, `corp-setup: would buy ${describe(step)} for ${formatMoney(step.cost)}`);
      continue;
    }
    if (step.kind === "unlock") ns.corporation.purchaseUnlock(/** @type {CorpUnlockName} */ (step.name));
    else ns.corporation.expandCity(divName, /** @type {CorpCityName} */ (step.name));
    tlog(ns, `corp-setup: bought ${describe(step)} for ${formatMoney(step.cost)}`);
  }
  if (waiting) say(`corp-setup: next is ${describe(waiting)}, waiting for ${formatMoney(waiting.cost)}`);
}
```

In `test/corp-ram.test.js`, add to `CORP_SCRIPTS`:

```js
  "src/tools/corp-setup.js": 131.6,
```

- [ ] **Step 10: Run everything**

Run: `npm test && npm run check`
Expected: PASS

- [ ] **Step 11: Commit**

```bash
git add src/lib/corp.js src/lib/constants.js src/tools/corp-setup.js globals.d.ts test/corp.test.js test/corp-mock.mjs test/corp-setup.test.js test/corp-ram.test.js
git commit -m "Add corp-setup.js: seed-money corp, division, cities, unlocks

Buys in a strict order (Smart Supply, the five other cities, then the
Warehouse and Office API unlocks) and waits at the first step it can't
afford above the cash reserve. Reuses an existing division of the
industry so a hand-made one isn't duplicated.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: corp-office.js: grow, hire, assign, tea and parties

**Files:**
- Create: `src/tools/corp-office.js`, `test/corp-office.test.js`
- Modify: `src/lib/corp.js`, `test/corp.test.js`, `src/lib/constants.js`, `globals.d.ts`, `test/corp-ram.test.js`

**Interfaces:**
- Consumes: `test/corp-mock.mjs` (Task 2).
- Produces in `src/lib/corp.js`: `planJobs(size: number, weights: Record<string, number>) → Record<string, number>`, `orderJobAssignments(current, target) → Array<{job: string, count: number}>`, `wellbeingActions(office, floor) → {tea: boolean, party: boolean}`.
- Produces in DEFAULTS: `corpStructureSpend`, `corpOfficeSize`, `corpOfficeStep`, `corpJobWeights`, `corpWellbeingFloor`, `corpPartyCostPerEmployee`. Task 4 also uses `corpStructureSpend`.
- Produces global: `CorpJob`.

- [ ] **Step 1: Write the lib tests**

In `test/corp.test.js`, add `planJobs`, `orderJobAssignments`, `wellbeingActions` to the import, then append:

```js
// ── planJobs / orderJobAssignments / wellbeingActions ───────────────────────

const WEIGHTS = { Operations: 2, Engineer: 2, Business: 1, Management: 2, "Research & Development": 2 };

test("planJobs gives one of each job first, in key order", () => {
  assert.deepEqual(planJobs(3, WEIGHTS), {
    Operations: 1, Engineer: 1, Business: 1, Management: 0, "Research & Development": 0,
  });
});

test("planJobs splits a larger office by weight", () => {
  assert.deepEqual(planJobs(9, WEIGHTS), {
    Operations: 2, Engineer: 2, Business: 1, Management: 2, "Research & Development": 2,
  });
});

test("planJobs leaves an empty office empty", () => {
  assert.deepEqual(planJobs(0, WEIGHTS), {
    Operations: 0, Engineer: 0, Business: 0, Management: 0, "Research & Development": 0,
  });
});

test("planJobs never staffs a job with weight 0", () => {
  assert.deepEqual(planJobs(2, { Operations: 1, Engineer: 0 }), { Operations: 2 });
});

test("orderJobAssignments fills jobs from Unassigned", () => {
  const current = { Operations: 0, Engineer: 0, Business: 0, Unassigned: 3 };
  const target = { Operations: 1, Engineer: 1, Business: 1 };
  assert.deepEqual(orderJobAssignments(current, target), [
    { job: "Operations", count: 1 },
    { job: "Engineer", count: 1 },
    { job: "Business", count: 1 },
  ]);
});

// Raising a job draws from Unassigned, so the cuts have to run first.
test("orderJobAssignments makes every cut before any raise", () => {
  const current = { Operations: 0, Engineer: 3, Unassigned: 0 };
  const target = { Operations: 2, Engineer: 1 };
  assert.deepEqual(orderJobAssignments(current, target), [
    { job: "Engineer", count: 1 },
    { job: "Operations", count: 2 },
  ]);
});

test("orderJobAssignments cuts jobs the plan doesn't use, such as Intern", () => {
  const current = { Operations: 0, Intern: 2, Unassigned: 0 };
  assert.deepEqual(orderJobAssignments(current, { Operations: 2 }), [
    { job: "Intern", count: 0 },
    { job: "Operations", count: 2 },
  ]);
});

test("orderJobAssignments has nothing to do when the office matches", () => {
  assert.deepEqual(orderJobAssignments({ Operations: 2, Unassigned: 0 }, { Operations: 2 }), []);
});

test("wellbeingActions asks for tea and a party below the floor", () => {
  const office = { avgEnergy: 90, maxEnergy: 100, avgMorale: 99, maxMorale: 100 };
  assert.deepEqual(wellbeingActions(office, 0.95), { tea: true, party: false });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `NODE_OPTIONS='--import ./test/setup.mjs' node --test test/corp.test.js`
Expected: FAIL. `does not provide an export named 'orderJobAssignments'`

- [ ] **Step 3: Implement**

Append to `src/lib/corp.js`:

```js
// ── Offices ─────────────────────────────────────────────────────────────────

/**
 * How many employees each job gets in an office of `size`.
 *
 * One of each job first, in the key order of `weights`, so a 3-person office gets the first
 * three jobs. Every later hire goes to the job whose (count + 1) / weight is lowest, ties to
 * the earlier key. Jobs with weight 0 get nobody.
 *
 * @param {number} size
 * @param {Record<string, number>} weights
 * @returns {Record<string, number>}
 */
export function planJobs(size, weights) {
  const jobs = Object.keys(weights).filter((job) => weights[job] > 0);
  /** @type {Record<string, number>} */
  const counts = Object.fromEntries(jobs.map((job) => [job, 0]));
  for (let i = 0; i < size && jobs.length > 0; i++) {
    let pick = jobs[0];
    let best = Infinity;
    for (const job of jobs) {
      const score = counts[job] === 0 ? -1 : (counts[job] + 1) / weights[job];
      if (score < best) {
        best = score;
        pick = job;
      }
    }
    counts[pick]++;
  }
  return counts;
}

/**
 * The setJobAssignment calls that take an office from `current` to `target` head counts, in an
 * order that works: raising a job draws from Unassigned, so every cut comes first. Jobs not in
 * `target` (Intern, say) are cut to zero. Unassigned itself is never set.
 *
 * @param {Record<string, number>} current employeeJobs from getOffice
 * @param {Record<string, number>} target from planJobs
 * @returns {Array<{job: string, count: number}>}
 */
export function orderJobAssignments(current, target) {
  const cuts = [];
  const raises = [];
  for (const job of new Set([...Object.keys(current), ...Object.keys(target)])) {
    if (job === "Unassigned") continue;
    const have = current[job] ?? 0;
    const want = target[job] ?? 0;
    if (want < have) cuts.push({ job, count: want });
    else if (want > have) raises.push({ job, count: want });
  }
  return [...cuts, ...raises];
}

/**
 * Whether an office needs tea (energy) or a party (morale): either below `floor` of its max.
 *
 * @param {{avgEnergy: number, maxEnergy: number, avgMorale: number, maxMorale: number}} office
 * @param {number} floor
 * @returns {{tea: boolean, party: boolean}}
 */
export function wellbeingActions(office, floor) {
  return {
    tea: office.avgEnergy < office.maxEnergy * floor,
    party: office.avgMorale < office.maxMorale * floor,
  };
}
```

Add to `globals.d.ts` under the `CorpUnlockName` line:

```ts
  type CorpJob = Parameters<NS["corporation"]["setJobAssignment"]>[2];
```

- [ ] **Step 4: Run the lib tests**

Run: `NODE_OPTIONS='--import ./test/setup.mjs' node --test test/corp.test.js`
Expected: PASS

- [ ] **Step 5: Write the tool tests**

Create `test/corp-office.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { main } from "/src/tools/corp-office.js";
import { callsTo, makeCorpNs, makeDivision, makeOffice } from "./corp-mock.mjs";

function corpWith(office, over = {}) {
  return makeCorpNs({
    unlocks: ["Office API"],
    divisions: [makeDivision({ offices: { "Sector-12": office } })],
    ...over,
  });
}

const jobsOf = (state) => state.divisions.Agri.offices["Sector-12"].employeeJobs;

test("it does nothing without the Office API", async () => {
  const { ns, state } = makeCorpNs({ unlocks: [] });
  await main(ns);
  assert.deepEqual(state.calls, []);
});

test("it grows an office, fills it and assigns every job", async () => {
  const { ns, state } = corpWith(makeOffice(), { funds: 1e12 });
  await main(ns);
  assert.deepEqual(callsTo(state, "upgradeOfficeSize"), [["Agri", "Sector-12", 3]]);
  assert.equal(callsTo(state, "hireEmployee").length, 6);
  assert.deepEqual(jobsOf(state), {
    Operations: 2, Engineer: 1, Business: 1, Management: 1, "Research & Development": 1, Intern: 0, Unassigned: 0,
  });
});

// (2b - 1b reserve) × 0.25 = 0.25b, short of the 3b growth step. Hiring is free.
test("it hires and assigns without growing when growth costs too much", async () => {
  const { ns, state } = corpWith(makeOffice(), { funds: 2e9 });
  await main(ns);
  assert.deepEqual(callsTo(state, "upgradeOfficeSize"), []);
  assert.deepEqual(jobsOf(state), {
    Operations: 1, Engineer: 1, Business: 1, Management: 0, "Research & Development": 0, Intern: 0, Unassigned: 0,
  });
});

// Employees hired by hand in the UI start Unassigned and produce nothing.
test("it assigns employees hired by hand", async () => {
  const office = makeOffice({ numEmployees: 3, employeeJobs: { Unassigned: 3 } });
  const { ns, state } = corpWith(office, { funds: 2e9 });
  await main(ns);
  assert.deepEqual(callsTo(state, "hireEmployee"), []);
  assert.equal(jobsOf(state).Unassigned, 0);
  assert.equal(jobsOf(state).Operations, 1);
});

test("it buys tea and throws a party when energy and morale slip", async () => {
  const office = makeOffice({ numEmployees: 3, avgEnergy: 50, avgMorale: 50, employeeJobs: { Operations: 1, Engineer: 1, Business: 1 } });
  const { ns, state } = corpWith(office, { funds: 2e9 });
  await main(ns);
  assert.deepEqual(callsTo(state, "buyTea"), [["Agri", "Sector-12"]]);
  assert.deepEqual(callsTo(state, "throwParty"), [["Agri", "Sector-12", 500e3]]);
});

test("it leaves a content office alone", async () => {
  const office = makeOffice({ size: 9, numEmployees: 9, employeeJobs: { Operations: 2, Engineer: 2, Business: 1, Management: 2, "Research & Development": 2 } });
  const { ns, state } = corpWith(office, { funds: 1e12 });
  await main(ns);
  assert.deepEqual(state.calls, []);
});

test("dry changes nothing", async () => {
  const { ns, state } = corpWith(makeOffice(), { args: ["dry"], funds: 1e12 });
  await main(ns);
  assert.deepEqual(state.calls, []);
  assert.ok(state.output.some((line) => line.includes("office +3")));
});
```

Run: `NODE_OPTIONS='--import ./test/setup.mjs' node --test test/corp-office.test.js`
Expected: FAIL, `Cannot find module` for `/src/tools/corp-office.js`

- [ ] **Step 6: Add the defaults and roster entry**

In DEFAULTS, directly under `  corpCashReserve: 1e9,`:

```js
  // Most of the money above the reserve one office or warehouse growth step may take.
  // Buying a city's first warehouse ignores it: without one the city produces nothing.
  corpStructureSpend: 0.25,
  // Offices grow toward this many employees per city, corpOfficeStep at a time.
  corpOfficeSize: 9,
  corpOfficeStep: 3,
  // Share of each office's staff per job (see planJobs). Every job gets one person before
  // any gets a second, in this key order, so a 3-person office is Operations, Engineer, Business.
  corpJobWeights: { Operations: 2, Engineer: 2, Business: 1, Management: 2, "Research & Development": 2 },
  // Tea / a party once average energy / morale falls below this fraction of its max.
  corpWellbeingFloor: 0.95,
  corpPartyCostPerEmployee: 500e3,
```

In MANAGERS, under the `corp-setup` line:

```js
  { id: "corp-office", script: "/src/tools/corp-office.js", name: "Corp Offices", priority: 11.2, phase: 6, oneShot: true },
```

- [ ] **Step 7: Implement the tool**

Create `src/tools/corp-office.js`:

```js
import { orderJobAssignments, planJobs, wellbeingActions } from "/src/lib/corp.js";
import { DEFAULTS } from "/src/lib/constants.js";
import { formatMoney, log, tlog } from "/src/lib/utils.js";

// Staffs every office: grows it toward DEFAULTS.corpOfficeSize, hires up to its size, sets
// each job's head count from DEFAULTS.corpJobWeights, and buys tea or throws a party when
// energy or morale slips.
//
//   run /src/tools/corp-office.js        grow, hire, assign
//   run /src/tools/corp-office.js dry    report the plan, change nothing
//
// Growing an office may use DEFAULTS.corpStructureSpend of the money above
// DEFAULTS.corpCashReserve. Hiring and assigning are free.
//
// Needs the Office API unlock (corp-setup.js buys it). Until then it does nothing; hire and
// assign by hand in the UI. Employees hired there are reassigned to the plan once it runs.
//
// ONE-SHOT and idempotent: the daemon runs it about three times every five minutes.

/**
 * @param {NS} ns
 * @param {string} divName
 * @param {CorpCityName} city
 * @param {number} budget money above the reserve
 * @param {number} teaCost per employee
 * @param {boolean} dryRun
 * @param {(msg: string) => void} say
 * @returns {number} money spent
 */
function staffOffice(ns, divName, city, budget, teaCost, dryRun, say) {
  let spent = 0;
  let office = ns.corporation.getOffice(divName, city);
  const where = `${divName}/${city}`;

  let size = office.size;
  const grow = Math.min(DEFAULTS.corpOfficeStep, DEFAULTS.corpOfficeSize - size);
  if (grow > 0) {
    const cost = ns.corporation.getOfficeSizeUpgradeCost(divName, city, grow);
    if (cost <= budget * DEFAULTS.corpStructureSpend) {
      say(`corp-office: ${where} office +${grow} for ${formatMoney(cost)}`);
      if (!dryRun) ns.corporation.upgradeOfficeSize(divName, city, grow);
      spent += cost;
      size += grow;
    }
  }

  const hires = size - office.numEmployees;
  if (hires > 0) {
    say(`corp-office: ${where} hiring ${hires}`);
    if (!dryRun) for (let i = 0; i < hires; i++) ns.corporation.hireEmployee(divName, city);
  }

  if (dryRun) {
    say(`corp-office: ${where} jobs ${JSON.stringify(planJobs(size, DEFAULTS.corpJobWeights))}`);
    return spent;
  }

  office = ns.corporation.getOffice(divName, city);
  const target = planJobs(office.numEmployees, DEFAULTS.corpJobWeights);
  for (const { job, count } of orderJobAssignments(office.employeeJobs, target)) {
    ns.corporation.setJobAssignment(divName, city, /** @type {CorpJob} */ (job), count);
  }

  if (office.numEmployees === 0) return spent;
  const { tea, party } = wellbeingActions(office, DEFAULTS.corpWellbeingFloor);
  const teaBill = teaCost * office.numEmployees;
  if (tea && teaBill <= budget - spent) {
    say(`corp-office: ${where} tea for ${formatMoney(teaBill)}`);
    ns.corporation.buyTea(divName, city);
    spent += teaBill;
  }
  const partyBill = DEFAULTS.corpPartyCostPerEmployee * office.numEmployees;
  if (party && partyBill <= budget - spent) {
    say(`corp-office: ${where} party for ${formatMoney(partyBill)}`);
    ns.corporation.throwParty(divName, city, DEFAULTS.corpPartyCostPerEmployee);
    spent += partyBill;
  }
  return spent;
}

/** @param {NS} ns */
export async function main(ns) {
  const dryRun = String(ns.args[0] ?? "").toLowerCase() === "dry";
  const say = (/** @type {string} */ msg) => (dryRun ? tlog(ns, msg) : log(ns, msg));

  if (!ns.corporation.hasCorporation()) return;
  if (!ns.corporation.hasUnlock("Office API")) {
    say("corp-office: needs the Office API unlock; staff offices in the UI until corp-setup.js buys it");
    return;
  }

  const corp = ns.corporation.getCorporation();
  const teaCost = ns.corporation.getConstants().teaCostPerEmployee;
  let budget = corp.funds - DEFAULTS.corpCashReserve;

  for (const divName of corp.divisions) {
    for (const city of ns.corporation.getDivision(divName).cities) {
      budget -= staffOffice(ns, divName, city, budget, teaCost, dryRun, say);
    }
  }
}
```

Add to `CORP_SCRIPTS` in `test/corp-ram.test.js`:

```js
  "src/tools/corp-office.js": 151.6,
```

- [ ] **Step 8: Run everything**

Run: `npm test && npm run check`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add src/lib/corp.js src/lib/constants.js src/tools/corp-office.js globals.d.ts test/corp.test.js test/corp-office.test.js test/corp-ram.test.js
git commit -m "Add corp-office.js: grow offices, hire, assign jobs, keep morale

Hires into Unassigned, then sets each job's head count from
corpJobWeights, cutting before raising so the moves always have people
to draw from. Hand-hired employees get reassigned. Needs the Office API.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: corp-warehouse.js: warehouses, Smart Supply, growth

**Files:**
- Create: `src/tools/corp-warehouse.js`, `test/corp-warehouse.test.js`
- Modify: `src/lib/constants.js`, `test/corp-ram.test.js`

**Interfaces:**
- Consumes: `test/corp-mock.mjs` (Task 2), `DEFAULTS.corpStructureSpend` (Task 3).
- Produces in DEFAULTS: `corpWarehouseUpgradeAt`.

- [ ] **Step 1: Write the tool tests**

Create `test/corp-warehouse.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { main } from "/src/tools/corp-warehouse.js";
import { callsTo, makeCorpNs, makeDivision, makeOffice, makeWarehouse } from "./corp-mock.mjs";

function twoCities(warehouses, over = {}) {
  return makeCorpNs({
    unlocks: ["Warehouse API", "Smart Supply"],
    funds: 1e12,
    divisions: [makeDivision({ offices: { "Sector-12": makeOffice(), Aevum: makeOffice() }, warehouses })],
    ...over,
  });
}

test("it does nothing without the Warehouse API", async () => {
  const { ns, state } = makeCorpNs({ unlocks: ["Smart Supply"] });
  await main(ns);
  assert.deepEqual(state.calls, []);
});

test("it buys a missing warehouse and turns Smart Supply on everywhere", async () => {
  const { ns, state } = twoCities({ "Sector-12": makeWarehouse() });
  await main(ns);
  assert.deepEqual(callsTo(state, "purchaseWarehouse"), [["Agri", "Aevum"]]);
  assert.deepEqual(callsTo(state, "setSmartSupply"), [
    ["Agri", "Sector-12", true],
    ["Agri", "Aevum", true],
  ]);
});

test("it leaves Smart Supply alone until the unlock is bought", async () => {
  const { ns, state } = twoCities({ "Sector-12": makeWarehouse() }, { unlocks: ["Warehouse API"] });
  await main(ns);
  assert.deepEqual(callsTo(state, "setSmartSupply"), []);
});

test("it grows a warehouse once it is 80% full", async () => {
  const { ns, state } = twoCities({
    "Sector-12": makeWarehouse({ sizeUsed: 85, smartSupplyEnabled: true }),
    Aevum: makeWarehouse({ sizeUsed: 50, smartSupplyEnabled: true }),
  });
  await main(ns);
  assert.deepEqual(callsTo(state, "upgradeWarehouse"), [["Agri", "Sector-12", 1]]);
});

test("it waits for money above the reserve to buy a warehouse", async () => {
  const { ns, state } = twoCities({ "Sector-12": makeWarehouse({ smartSupplyEnabled: true }) }, { funds: 5e9 });
  await main(ns);
  assert.deepEqual(callsTo(state, "purchaseWarehouse"), []);
});

test("dry changes nothing", async () => {
  const { ns, state } = twoCities({ "Sector-12": makeWarehouse() }, { args: ["dry"] });
  await main(ns);
  assert.deepEqual(state.calls, []);
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `NODE_OPTIONS='--import ./test/setup.mjs' node --test test/corp-warehouse.test.js`
Expected: FAIL, `Cannot find module` for `/src/tools/corp-warehouse.js`

- [ ] **Step 3: Add the default and roster entry**

In DEFAULTS, directly under `  corpPartyCostPerEmployee: 500e3,`:

```js
  // A warehouse grows one level once it is this full.
  corpWarehouseUpgradeAt: 0.8,
```

In MANAGERS, between the `corp-setup` and `corp-office` lines:

```js
  { id: "corp-warehouse", script: "/src/tools/corp-warehouse.js", name: "Corp Warehouses", priority: 11.1, phase: 6, oneShot: true },
```

- [ ] **Step 4: Implement the tool**

Create `src/tools/corp-warehouse.js`:

```js
import { DEFAULTS } from "/src/lib/constants.js";
import { formatMoney, log, tlog } from "/src/lib/utils.js";

// Gives every city of every division a warehouse, turns Smart Supply on in each, and grows a
// warehouse one level once it is DEFAULTS.corpWarehouseUpgradeAt full.
//
//   run /src/tools/corp-warehouse.js        buy and switch on what is missing
//   run /src/tools/corp-warehouse.js dry    report the plan, buy nothing
//
// A city without a warehouse produces nothing, so buying one may use all the money above
// DEFAULTS.corpCashReserve. Growing one may use DEFAULTS.corpStructureSpend of it.
//
// Needs the Warehouse API unlock (corp-setup.js buys it). Until then it does nothing; buy
// warehouses and tick Smart Supply by hand in the UI.
//
// ONE-SHOT and idempotent: the daemon runs it about three times every five minutes.

/** @param {NS} ns */
export async function main(ns) {
  const dryRun = String(ns.args[0] ?? "").toLowerCase() === "dry";
  const say = (/** @type {string} */ msg) => (dryRun ? tlog(ns, msg) : log(ns, msg));

  if (!ns.corporation.hasCorporation()) return;
  if (!ns.corporation.hasUnlock("Warehouse API")) {
    say("corp-warehouse: needs the Warehouse API unlock; manage warehouses in the UI until corp-setup.js buys it");
    return;
  }

  const smartSupply = ns.corporation.hasUnlock("Smart Supply");
  const corp = ns.corporation.getCorporation();
  const warehouseCost = ns.corporation.getConstants().warehouseInitialCost;
  let budget = corp.funds - DEFAULTS.corpCashReserve;

  for (const divName of corp.divisions) {
    for (const city of ns.corporation.getDivision(divName).cities) {
      if (!ns.corporation.hasWarehouse(divName, city)) {
        if (warehouseCost > budget) {
          say(`corp-warehouse: ${divName}/${city} needs a warehouse, waiting for ${formatMoney(warehouseCost)}`);
          continue;
        }
        say(`corp-warehouse: ${divName}/${city} warehouse for ${formatMoney(warehouseCost)}`);
        budget -= warehouseCost;
        if (dryRun) continue;
        ns.corporation.purchaseWarehouse(divName, city);
      }

      const warehouse = ns.corporation.getWarehouse(divName, city);
      if (smartSupply && !warehouse.smartSupplyEnabled) {
        say(`corp-warehouse: ${divName}/${city} Smart Supply on`);
        if (!dryRun) ns.corporation.setSmartSupply(divName, city, true);
      }
      if (warehouse.sizeUsed >= warehouse.size * DEFAULTS.corpWarehouseUpgradeAt) {
        const cost = ns.corporation.getUpgradeWarehouseCost(divName, city, 1);
        if (cost <= budget * DEFAULTS.corpStructureSpend) {
          say(`corp-warehouse: ${divName}/${city} warehouse +1 level for ${formatMoney(cost)}`);
          budget -= cost;
          if (!dryRun) ns.corporation.upgradeWarehouse(divName, city, 1);
        }
      }
    }
  }
}
```

Add to `CORP_SCRIPTS`:

```js
  "src/tools/corp-warehouse.js": 121.6,
```

- [ ] **Step 5: Run everything**

Run: `npm test && npm run check`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/lib/constants.js src/tools/corp-warehouse.js test/corp-warehouse.test.js test/corp-ram.test.js
git commit -m "Add corp-warehouse.js: warehouses, Smart Supply, growth

Buys a missing warehouse with anything above the reserve (a city
without one produces nothing), switches Smart Supply on once unlocked,
and grows a warehouse a level at 80% full. Needs the Warehouse API.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: corp-boost.js rewrite: optimal boost mix, sell orders, Market-TA.II

**Files:**
- Modify: `src/lib/corp.js`, `test/corp.test.js`, `src/tools/corp-boost.js` (full rewrite), `src/lib/constants.js`, `test/corp-ram.test.js`
- Create: `test/corp-boost.test.js`

**Interfaces:**
- Consumes: `test/corp-mock.mjs` (Task 2).
- Produces in `src/lib/corp.js`: `BOOST_SIZES: Record<string, number>`, `boostFactors(industryData) → Record<string, number>`, `optimalBoostAmounts(factors, sizes, space) → Record<string, number>`, and a **new signature** `planBoostPurchases({targets, stored, sizes, prices, freeSpace, budget}) → Array<{name, amount}>`.
- Removes: `selectMaterialsToSell`, `TRACKED_MATERIALS` (the old manager and old corp-boost were the only users), and `DEFAULTS.corpBoostTargets`.

- [ ] **Step 1: Replace the boost tests**

In `test/corp.test.js`:
- Delete the `mat` helper, the whole `// ── selectMaterialsToSell` section, and the old `// ── planBoostPurchases` section.
- Change the import to drop `BOOST_MATERIALS` and `selectMaterialsToSell` and add `BOOST_SIZES`, `boostFactors`, `optimalBoostAmounts` (keep `planBoostPurchases`).
- Append:

```js
// ── boostFactors / optimalBoostAmounts ──────────────────────────────────────

const AGRI_FACTORS = { Hardware: 0.2, Robots: 0.3, "AI Cores": 0.3, "Real Estate": 0.72 };

test("boostFactors maps an industry's factors to material names, 0 when missing", () => {
  assert.deepEqual(boostFactors({ hardwareFactor: 0.2, realEstateFactor: 0.72 }), {
    Hardware: 0.2, Robots: 0, "AI Cores": 0, "Real Estate": 0.72,
  });
});

test("optimalBoostAmounts buys nothing without space", () => {
  assert.deepEqual(optimalBoostAmounts(AGRI_FACTORS, BOOST_SIZES, 0), {
    Hardware: 0, Robots: 0, "AI Cores": 0, "Real Estate": 0,
  });
});

// In a small warehouse only the material with the best factor per unit of space is worth it.
test("optimalBoostAmounts spends a small space on Real Estate alone for Agriculture", () => {
  assert.deepEqual(optimalBoostAmounts(AGRI_FACTORS, BOOST_SIZES, 100), {
    Hardware: 0, Robots: 0, "AI Cores": 0, "Real Estate": 20000,
  });
});

test("optimalBoostAmounts never buys a material the industry doesn't use", () => {
  assert.deepEqual(optimalBoostAmounts({ Hardware: 0.5 }, BOOST_SIZES, 6), {
    Hardware: 100, Robots: 0, "AI Cores": 0, "Real Estate": 0,
  });
});

// At the optimum every material bought adds the same production per unit of space:
// d/dx [c·ln(1 + 0.002x)] / s = 0.002c / ((1 + 0.002x)·s).
test("optimalBoostAmounts fills the space with equal marginal value per unit of space", () => {
  const space = 10000;
  const amounts = optimalBoostAmounts(AGRI_FACTORS, BOOST_SIZES, space);
  const used = Object.entries(amounts).reduce((t, [name, x]) => t + x * BOOST_SIZES[name], 0);
  assert.ok(used <= space && used > space - 1, `used ${used} of ${space}`);

  const marginal = Object.keys(amounts).map(
    (name) => (0.002 * AGRI_FACTORS[name]) / ((1 + 0.002 * amounts[name]) * BOOST_SIZES[name]),
  );
  for (const m of marginal) assert.ok(Math.abs(m / marginal[0] - 1) < 0.01, `marginals ${marginal}`);
});

// ── planBoostPurchases ──────────────────────────────────────────────────────

const SIZES = { Hardware: 0.25, Robots: 0.5 };
const PRICES = { Hardware: 1000, Robots: 1000 };

function boost(over = {}) {
  return planBoostPurchases({
    targets: { Hardware: 500 },
    stored: {},
    sizes: SIZES,
    prices: PRICES,
    freeSpace: 1e6,
    budget: 1e12,
    ...over,
  });
}

test("planBoostPurchases buys the shortfall against the target", () => {
  assert.deepEqual(boost({ stored: { Hardware: 200 } }), [{ name: "Hardware", amount: 300 }]);
});

test("planBoostPurchases buys nothing once the target is met", () => {
  assert.deepEqual(boost({ stored: { Hardware: 500 } }), []);
});

test("planBoostPurchases treats a missing stock entry as zero", () => {
  assert.deepEqual(boost({ targets: { Robots: 50 } }), [{ name: "Robots", amount: 50 }]);
});

// Shortfall space is 400·0.25 + 400·0.5 = 300; half of it is free, so both halve.
test("planBoostPurchases scales every purchase down together when space is short", () => {
  assert.deepEqual(boost({ targets: { Hardware: 400, Robots: 400 }, freeSpace: 150 }), [
    { name: "Hardware", amount: 200 },
    { name: "Robots", amount: 200 },
  ]);
});

test("planBoostPurchases scales every purchase down together when money is short", () => {
  assert.deepEqual(boost({ targets: { Hardware: 400, Robots: 400 }, budget: 200e3 }), [
    { name: "Hardware", amount: 100 },
    { name: "Robots", amount: 100 },
  ]);
});

test("planBoostPurchases buys nothing in a full warehouse or with no money", () => {
  assert.deepEqual(boost({ freeSpace: 0 }), []);
  assert.deepEqual(boost({ freeSpace: -5 }), []);
  assert.deepEqual(boost({ budget: -1e9 }), []);
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `NODE_OPTIONS='--import ./test/setup.mjs' node --test test/corp.test.js`
Expected: FAIL. `does not provide an export named 'BOOST_SIZES'`

- [ ] **Step 3: Implement**

In `src/lib/corp.js`:
- Replace the `BOOST_MATERIALS` comment and everything from there down to the end of the old `planBoostPurchases` (that is: `BOOST_MATERIALS`, `TRACKED_MATERIALS`, `BOOST_NAMES`, `selectMaterialsToSell`, old `planBoostPurchases`) with the following, placed **directly under the header comment**, above `// ── Setup`:

```js
// Materials that multiply a division's production while they are HELD in the warehouse.
// They are inputs to the production multiplier, never output to be sold: liquidating them
// liquidates the multiplier.
/** @type {CorpMaterialName[]} */
export const BOOST_MATERIALS = ["Hardware", "Robots", "AI Cores", "Real Estate"];

// Warehouse space per unit of each boost material (getMaterialData(name).size). Hardcoded to
// keep getMaterialData's 10 GB out of corp-boost.js.
/** @type {Record<string, number>} */
export const BOOST_SIZES = { Hardware: 0.06, Robots: 0.5, "AI Cores": 0.1, "Real Estate": 0.005 };
```

- Append, after the Offices section:

```js
// ── Boost materials ─────────────────────────────────────────────────────────

/**
 * An industry's boost factors keyed by material name.
 *
 * @param {{hardwareFactor?: number, robotFactor?: number, aiCoreFactor?: number, realEstateFactor?: number}} data
 *   getIndustryData's result
 * @returns {Record<string, number>}
 */
export function boostFactors(data) {
  return {
    Hardware: data.hardwareFactor ?? 0,
    Robots: data.robotFactor ?? 0,
    "AI Cores": data.aiCoreFactor ?? 0,
    "Real Estate": data.realEstateFactor ?? 0,
  };
}

/**
 * The boost-material mix that maximizes a division's production for `space` units of room.
 *
 * The game's multiplier is (Π (1 + 0.002·xᵢ)^cᵢ)^0.73, xᵢ the amount held and cᵢ the industry's
 * factor. Maximizing Σ cᵢ·ln(1 + 0.002·xᵢ) subject to Σ sᵢ·xᵢ = space (sᵢ the size per unit)
 * gives, by Lagrange multipliers:
 *
 *     xᵢ = cᵢ·(space + 500·Σsⱼ) / (sᵢ·Σcⱼ) − 500
 *
 * A negative xᵢ means the material isn't worth its room at this budget. The one with the
 * lowest cᵢ/sᵢ is dropped and the rest re-solved, until every amount is positive.
 *
 * @param {Record<string, number>} factors per material; 0 or missing means unused
 * @param {Record<string, number>} sizes space per unit
 * @param {number} space
 * @returns {Record<string, number>} whole units of each material in `sizes`
 */
export function optimalBoostAmounts(factors, sizes, space) {
  /** @type {Record<string, number>} */
  const result = Object.fromEntries(Object.keys(sizes).map((name) => [name, 0]));
  if (space <= 0) return result;

  let active = Object.keys(sizes).filter((name) => (factors[name] ?? 0) > 0);
  while (active.length > 0) {
    const sumC = active.reduce((total, name) => total + factors[name], 0);
    const sumS = active.reduce((total, name) => total + sizes[name], 0);
    const amount = (/** @type {string} */ name) => (factors[name] * (space + 500 * sumS)) / (sizes[name] * sumC) - 500;

    const negative = active.filter((name) => amount(name) < 0);
    if (negative.length === 0) {
      // The epsilon keeps float error (20499.999...) from flooring a whole unit away.
      for (const name of active) result[name] = Math.floor(amount(name) + 1e-6);
      return result;
    }
    const value = (/** @type {string} */ name) => factors[name] / sizes[name];
    const worst = negative.reduce((a, b) => (value(a) <= value(b) ? a : b));
    active = active.filter((name) => name !== worst);
  }
  return result;
}

/**
 * How much of each boost material to buy toward its target.
 *
 * Free warehouse space and money are both limits. When either runs short, every purchase is
 * scaled down by the same fraction, so a tight budget keeps the optimal mix rather than
 * filling up on whichever material happens to come first.
 *
 * @param {{targets: Record<string, number>, stored: Record<string, number>,
 *          sizes: Record<string, number>, prices: Record<string, number>,
 *          freeSpace: number, budget: number}} input
 * @returns {Array<{name: string, amount: number}>}
 */
export function planBoostPurchases({ targets, stored, sizes, prices, freeSpace, budget }) {
  const wanted = Object.entries(targets)
    .map(([name, target]) => ({ name, amount: target - (stored[name] ?? 0) }))
    .filter((want) => want.amount > 0);
  if (wanted.length === 0) return [];

  const space = wanted.reduce((total, want) => total + want.amount * sizes[want.name], 0);
  const cost = wanted.reduce((total, want) => total + want.amount * prices[want.name], 0);
  const scale = Math.min(1, Math.max(0, freeSpace) / space, Math.max(0, budget) / cost);

  return wanted
    .map((want) => ({ name: want.name, amount: Math.floor(want.amount * scale) }))
    .filter((buy) => buy.amount > 0);
}
```

- [ ] **Step 4: Run the lib tests**

Run: `NODE_OPTIONS='--import ./test/setup.mjs' node --test test/corp.test.js`
Expected: PASS

- [ ] **Step 5: Write the tool tests**

Create `test/corp-boost.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { main } from "/src/tools/corp-boost.js";
import { BOOST_SIZES, boostFactors, optimalBoostAmounts } from "/src/lib/corp.js";
import { AGRICULTURE, callsTo, makeCorpNs, makeDivision, makeWarehouse } from "./corp-mock.mjs";

function boostCorp(over = {}) {
  return makeCorpNs({
    unlocks: ["Warehouse API"],
    funds: 1e12,
    divisions: [makeDivision({ warehouses: { "Sector-12": makeWarehouse({ size: 1000 }) } })],
    ...over,
  });
}

test("it does nothing without the Warehouse API", async () => {
  const { ns, state } = makeCorpNs({ unlocks: [] });
  await main(ns);
  assert.deepEqual(state.calls, []);
});

// 1000 space less 40% headroom leaves 600 for boost materials.
test("it buys the optimal boost mix for the industry", async () => {
  const { ns, state } = boostCorp();
  await main(ns);
  const expected = optimalBoostAmounts(boostFactors(AGRICULTURE), BOOST_SIZES, 600);
  const bought = Object.fromEntries(callsTo(state, "bulkPurchase").map(([, , name, amount]) => [name, amount]));
  for (const [name, amount] of Object.entries(expected)) assert.equal(bought[name] ?? 0, amount, name);
});

test("a second run buys no more boost materials", async () => {
  const { ns, state } = boostCorp();
  await main(ns);
  const first = callsTo(state, "bulkPurchase").length;
  await main(ns);
  assert.equal(callsTo(state, "bulkPurchase").length, first);
});

test("it puts the industry's output on sale once", async () => {
  const { ns, state } = boostCorp();
  await main(ns);
  await main(ns);
  assert.deepEqual(callsTo(state, "sellMaterial"), [
    ["Agri", "Sector-12", "Plants", "MAX", "MP"],
    ["Agri", "Sector-12", "Food", "MAX", "MP"],
  ]);
});

test("it turns on Market-TA.II once researched", async () => {
  const { ns, state } = boostCorp({
    unlocks: ["Warehouse API", "Office API"],
    divisions: [makeDivision({ research: ["Market-TA.II"] })],
  });
  await main(ns);
  assert.deepEqual(callsTo(state, "setMaterialMarketTA2"), [
    ["Agri", "Sector-12", "Plants", true],
    ["Agri", "Sector-12", "Food", true],
  ]);
});

// Checking research is an Office API call; the mock throws if it's made without the unlock.
test("it skips Market-TA.II without the Office API", async () => {
  const { ns, state } = boostCorp({ divisions: [makeDivision({ research: ["Market-TA.II"] })] });
  await main(ns);
  assert.deepEqual(callsTo(state, "setMaterialMarketTA2"), []);
});

test("it skips a city with no warehouse", async () => {
  const { ns, state } = boostCorp({ divisions: [makeDivision({ warehouses: {} })] });
  await main(ns);
  assert.deepEqual(state.calls, []);
});

test("dry changes nothing", async () => {
  const { ns, state } = boostCorp({ args: ["dry"] });
  await main(ns);
  assert.deepEqual(state.calls, []);
});
```

Run: `NODE_OPTIONS='--import ./test/setup.mjs' node --test test/corp-boost.test.js`
Expected: FAIL. The old corp-boost.js imports `TRACKED_MATERIALS`, which no longer exists.

- [ ] **Step 6: Update the defaults and roster**

In DEFAULTS, replace the old block (from `  // Boost materials multiply a division's production while held. Targets are per city and` through `  corpWarehouseHeadroom: 0.4,`, including the `corpBoostTargets` line) with:

```js
  // Fraction of each warehouse corp-boost.js leaves free of boost materials, for inputs and output.
  corpWarehouseHeadroom: 0.4,
```

In MANAGERS, change the `corp-boost` line's `priority: 11.5` to `priority: 11.3`.

- [ ] **Step 7: Rewrite the tool**

Replace all of `src/tools/corp-boost.js` with:

```js
import { BOOST_MATERIALS, BOOST_SIZES, boostFactors, optimalBoostAmounts, planBoostPurchases } from "/src/lib/corp.js";
import { DEFAULTS } from "/src/lib/constants.js";
import { formatMoney, log, tlog } from "/src/lib/utils.js";

// Stocks each warehouse with the boost-material mix that maximizes production, puts the
// division's output on sale, and turns on Market-TA.II pricing once it is researched.
//
//   run /src/tools/corp-boost.js          buy, set sell orders, enable Market-TA.II
//   run /src/tools/corp-boost.js dry      report the plan, change nothing
//
// Boost materials (Hardware, Robots, AI Cores, Real Estate) multiply production while HELD and
// are never sold. The mix is optimalBoostAmounts for the division's industry, over the room
// left after DEFAULTS.corpWarehouseHeadroom is kept free for inputs and output.
//
// bulkPurchase, not buyMaterial: buyMaterial sets a per-second buy RATE that keeps running
// after this script exits, which would overfill the warehouse and stall production.
//
// Sell orders persist in the game, so one is only placed where none is set; orders you set by
// hand are left alone.
//
// Needs the Warehouse API unlock. Market-TA.II also needs the Office API, because checking
// research is an Office API call.
//
// ONE-SHOT and idempotent: the daemon runs it about three times every five minutes.

/** @param {NS} ns */
export async function main(ns) {
  const dryRun = String(ns.args[0] ?? "").toLowerCase() === "dry";
  const say = (/** @type {string} */ msg) => (dryRun ? tlog(ns, msg) : log(ns, msg));

  if (!ns.corporation.hasCorporation()) return;
  if (!ns.corporation.hasUnlock("Warehouse API")) {
    say("corp-boost: needs the Warehouse API unlock");
    return;
  }

  const officeApi = ns.corporation.hasUnlock("Office API");
  const corp = ns.corporation.getCorporation();
  let budget = corp.funds - DEFAULTS.corpCashReserve;

  for (const divName of corp.divisions) {
    const div = ns.corporation.getDivision(divName);
    const industry = ns.corporation.getIndustryData(div.industry);
    const factors = boostFactors(industry);
    const output = industry.producedMaterials ?? [];
    const marketTA2 = officeApi && ns.corporation.hasResearched(divName, "Market-TA.II");

    for (const city of div.cities) {
      if (!ns.corporation.hasWarehouse(divName, city)) continue;
      const where = `${divName}/${city}`;
      const warehouse = ns.corporation.getWarehouse(divName, city);
      const boostSpace = warehouse.size * (1 - DEFAULTS.corpWarehouseHeadroom);

      /** @type {Record<string, number>} */
      const stored = {};
      /** @type {Record<string, number>} */
      const prices = {};
      for (const name of BOOST_MATERIALS) {
        const material = ns.corporation.getMaterial(divName, city, name);
        stored[name] = material.stored;
        prices[name] = material.marketPrice;
      }

      const plan = planBoostPurchases({
        targets: optimalBoostAmounts(factors, BOOST_SIZES, boostSpace),
        stored,
        sizes: BOOST_SIZES,
        prices,
        freeSpace: boostSpace - warehouse.sizeUsed,
        budget,
      });
      for (const { name, amount } of plan) {
        const cost = amount * prices[name];
        say(`corp-boost: ${where} ${amount} ${name} for ${formatMoney(cost)}`);
        budget -= cost;
        if (!dryRun) ns.corporation.bulkPurchase(divName, city, /** @type {CorpMaterialName} */ (name), amount);
      }

      for (const name of output) {
        if (!ns.corporation.getMaterial(divName, city, name).desiredSellAmount) {
          say(`corp-boost: ${where} selling ${name} (MAX at MP)`);
          if (!dryRun) ns.corporation.sellMaterial(divName, city, name, "MAX", "MP");
        }
        if (marketTA2 && !dryRun) ns.corporation.setMaterialMarketTA2(divName, city, name, true);
      }
    }
  }
}
```

In `CORP_SCRIPTS`, change `"src/tools/corp-boost.js": 81.6` to:

```js
  "src/tools/corp-boost.js": 141.6,
```

- [ ] **Step 8: Run everything**

Run: `npm test && npm run check`
Expected: PASS. Check that nothing still references the removed names: `grep -rn "corpBoostTargets\|selectMaterialsToSell\|TRACKED_MATERIALS" src test` should print nothing.

- [ ] **Step 9: Commit**

```bash
git add src/lib/corp.js src/lib/constants.js src/tools/corp-boost.js test/corp.test.js test/corp-boost.test.js test/corp-ram.test.js
git commit -m "Rewrite corp-boost.js: optimal boost mix, sell orders, Market-TA.II

Boost targets come from the Lagrange optimum of the production
multiplier for the division's industry instead of fixed counts (Real
Estate was 2,700; for Agriculture it dominates). Purchases scale down
together when space or money is short, and are sized in warehouse units
rather than counts. Places MAX/MP sell orders for the industry's output
where none is set, and enables Market-TA.II, which is research, not an
unlock, once owned.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: corp-research.js: upgrades and research

**Files:**
- Create: `src/tools/corp-research.js`, `test/corp-research.test.js`
- Modify: `src/lib/corp.js`, `test/corp.test.js`, `src/lib/constants.js`, `globals.d.ts`, `test/corp-ram.test.js`

**Interfaces:**
- Consumes: `test/corp-mock.mjs` (Task 2).
- Produces in `src/lib/corp.js`: `planUpgrades(costs: Record<string, number>, budget: number) → string[]`, `nextResearch(priority: string[], owned: string[], costOf: (name) => number, points: number, spend: number) → {name, cost} | null`.
- Produces in DEFAULTS: `corpUpgrades`, `corpUpgradeSpend`, `corpResearch`, `corpResearchSpend`.
- Produces globals: `CorpUpgradeName`, `CorpResearchName`.

- [ ] **Step 1: Write the lib tests**

Add `planUpgrades`, `nextResearch` to the import in `test/corp.test.js`, then append:

```js
// ── planUpgrades / nextResearch ─────────────────────────────────────────────

test("planUpgrades levels the cheapest upgrades the budget covers", () => {
  const costs = { "Smart Factories": 2e9, "Smart Storage": 1e9, FocusWires: 5e9 };
  assert.deepEqual(planUpgrades(costs, 4e9), ["Smart Storage", "Smart Factories"]);
});

test("planUpgrades buys nothing on an empty or negative budget", () => {
  assert.deepEqual(planUpgrades({ "Smart Storage": 1e9 }, 0), []);
  assert.deepEqual(planUpgrades({ "Smart Storage": 1e9 }, -5e9), []);
});

const RESEARCH = ["Hi-Tech R&D Laboratory", "Market-TA.I", "Market-TA.II"];
const RESEARCH_COST = { "Hi-Tech R&D Laboratory": 5000, "Market-TA.I": 20000, "Market-TA.II": 50000 };
const costOf = (name) => RESEARCH_COST[name];

test("nextResearch picks the first unowned research it can afford", () => {
  assert.deepEqual(nextResearch(RESEARCH, [], costOf, 10000, 0.5), { name: "Hi-Tech R&D Laboratory", cost: 5000 });
  assert.deepEqual(nextResearch(RESEARCH, ["Hi-Tech R&D Laboratory"], costOf, 40000, 0.5), {
    name: "Market-TA.I",
    cost: 20000,
  });
});

test("nextResearch waits for points rather than skipping ahead", () => {
  assert.equal(nextResearch(RESEARCH, ["Hi-Tech R&D Laboratory"], costOf, 39999, 0.5), null);
});

test("nextResearch has nothing left once everything is owned", () => {
  assert.equal(nextResearch(RESEARCH, RESEARCH, costOf, 1e9, 1), null);
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `NODE_OPTIONS='--import ./test/setup.mjs' node --test test/corp.test.js`
Expected: FAIL. `does not provide an export named 'nextResearch'`

- [ ] **Step 3: Implement**

Append to `src/lib/corp.js`:

```js
// ── Upgrades and research ───────────────────────────────────────────────────

/**
 * Corp-wide upgrades to level now: one level each, cheapest first, while `budget` lasts.
 *
 * @param {Record<string, number>} costs next-level cost per upgrade
 * @param {number} budget
 * @returns {string[]}
 */
export function planUpgrades(costs, budget) {
  const plan = [];
  let left = budget;
  for (const [name, cost] of Object.entries(costs).sort((a, b) => a[1] - b[1])) {
    if (cost > left) break;
    plan.push(name);
    left -= cost;
  }
  return plan;
}

/**
 * The next research to buy: the first in `priority` not yet owned, if it costs at most
 * `spend` of the division's research points. Strict order, so points build up for the
 * important ones, and prerequisites are bought first if `priority` lists them first.
 *
 * @param {string[]} priority
 * @param {string[]} owned
 * @param {(name: string) => number} costOf
 * @param {number} points
 * @param {number} spend fraction of points one research may take
 * @returns {{name: string, cost: number} | null}
 */
export function nextResearch(priority, owned, costOf, points, spend) {
  const name = priority.find((n) => !owned.includes(n));
  if (name === undefined) return null;
  const cost = costOf(name);
  return cost <= points * spend ? { name, cost } : null;
}
```

Add to `globals.d.ts` under the `CorpJob` line:

```ts
  type CorpUpgradeName = Parameters<NS["corporation"]["levelUpgrade"]>[0];
  type CorpResearchName = Parameters<NS["corporation"]["research"]>[1];
```

- [ ] **Step 4: Run the lib tests**

Run: `NODE_OPTIONS='--import ./test/setup.mjs' node --test test/corp.test.js`
Expected: PASS

- [ ] **Step 5: Write the tool tests**

Create `test/corp-research.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { main } from "/src/tools/corp-research.js";
import { callsTo, makeCorpNs, makeDivision } from "./corp-mock.mjs";

// (101b - 1b reserve) × 0.05 = 5b: Smart Storage and Smart Factories fit, FocusWires doesn't.
const UPGRADE_COSTS = { "Smart Storage": 1e9, "Smart Factories": 2e9, FocusWires: 1e12 };

test("it levels the cheapest upgrades within its budget", async () => {
  const { ns, state } = makeCorpNs({ funds: 101e9, upgradeCosts: UPGRADE_COSTS });
  await main(ns);
  assert.deepEqual(callsTo(state, "levelUpgrade"), [["Smart Storage"], ["Smart Factories"]]);
});

test("it researches in order while points last", async () => {
  const { ns, state } = makeCorpNs({
    unlocks: ["Office API"],
    divisions: [makeDivision({ researchPoints: 30000 })],
    researchCosts: { "Hi-Tech R&D Laboratory": 5000, "Market-TA.I": 20000 },
  });
  await main(ns);
  assert.deepEqual(callsTo(state, "research"), [["Agri", "Hi-Tech R&D Laboratory"]]);
});

test("it researches nothing without the Office API", async () => {
  const { ns, state } = makeCorpNs({
    divisions: [makeDivision({ researchPoints: 1e9 })],
    researchCosts: { "Hi-Tech R&D Laboratory": 5000 },
  });
  await main(ns);
  assert.deepEqual(callsTo(state, "research"), []);
});

test("dry changes nothing", async () => {
  const { ns, state } = makeCorpNs({
    args: ["dry"],
    funds: 101e9,
    upgradeCosts: UPGRADE_COSTS,
    unlocks: ["Office API"],
    divisions: [makeDivision({ researchPoints: 30000 })],
    researchCosts: { "Hi-Tech R&D Laboratory": 5000 },
  });
  await main(ns);
  assert.deepEqual(state.calls, []);
});
```

Run: `NODE_OPTIONS='--import ./test/setup.mjs' node --test test/corp-research.test.js`
Expected: FAIL, `Cannot find module` for `/src/tools/corp-research.js`

- [ ] **Step 6: Add the defaults and roster entry**

In DEFAULTS, directly under `  corpWarehouseHeadroom: 0.4,`:

```js
  // Corp-wide upgrades corp-research.js levels, cheapest first, within corpUpgradeSpend of the
  // money above the reserve per run.
  corpUpgrades: [
    "Smart Storage", "Smart Factories", "FocusWires", "Neural Accelerators", "Speech Processor Implants",
    "Nuoptimal Nootropic Injector Implants", "ABC SalesBots", "Wilson Analytics", "Project Insight",
  ],
  corpUpgradeSpend: 0.05,
  // Research per division, bought strictly in this order; prerequisites come first. One
  // research may take at most corpResearchSpend of the division's points.
  corpResearch: [
    "Hi-Tech R&D Laboratory", "Market-TA.I", "Market-TA.II", "AutoBrew", "AutoPartyManager",
    "Overclock", "Sti.mu", "Automatic Drug Administration", "Go-Juice", "CPH4 Injections",
  ],
  corpResearchSpend: 0.5,
```

In MANAGERS, under the `corp-boost` line:

```js
  { id: "corp-research", script: "/src/tools/corp-research.js", name: "Corp Research", priority: 11.4, phase: 6, oneShot: true },
```

- [ ] **Step 7: Implement the tool**

Create `src/tools/corp-research.js`:

```js
import { nextResearch, planUpgrades } from "/src/lib/corp.js";
import { DEFAULTS } from "/src/lib/constants.js";
import { formatMoney, log, tlog } from "/src/lib/utils.js";

// Levels corp-wide upgrades and buys research.
//
//   run /src/tools/corp-research.js        buy
//   run /src/tools/corp-research.js dry    report the plan, buy nothing
//
// Upgrades: DEFAULTS.corpUpgrades, one level each per run, cheapest first, within
// DEFAULTS.corpUpgradeSpend of the money above DEFAULTS.corpCashReserve. The daemon's
// three runs every five minutes pace the spending.
//
// Research: DEFAULTS.corpResearch in order, per division, each once it costs at most
// DEFAULTS.corpResearchSpend of that division's research points. Research needs the
// Office API unlock; upgrades don't.
//
// ONE-SHOT and idempotent.

/** @param {NS} ns */
export async function main(ns) {
  const dryRun = String(ns.args[0] ?? "").toLowerCase() === "dry";
  const say = (/** @type {string} */ msg) => (dryRun ? tlog(ns, msg) : log(ns, msg));

  if (!ns.corporation.hasCorporation()) return;
  const corp = ns.corporation.getCorporation();

  /** @type {Record<string, number>} */
  const costs = {};
  for (const name of DEFAULTS.corpUpgrades) {
    costs[name] = ns.corporation.getUpgradeLevelCost(/** @type {CorpUpgradeName} */ (name));
  }
  const budget = (corp.funds - DEFAULTS.corpCashReserve) * DEFAULTS.corpUpgradeSpend;
  for (const name of planUpgrades(costs, budget)) {
    say(`corp-research: upgrade ${name} for ${formatMoney(costs[name])}`);
    if (!dryRun) ns.corporation.levelUpgrade(/** @type {CorpUpgradeName} */ (name));
  }

  if (!ns.corporation.hasUnlock("Office API")) return;
  for (const divName of corp.divisions) {
    let points = ns.corporation.getDivision(divName).researchPoints;
    const owned = DEFAULTS.corpResearch.filter((name) =>
      ns.corporation.hasResearched(divName, /** @type {CorpResearchName} */ (name)),
    );
    const costOf = (/** @type {string} */ name) =>
      ns.corporation.getResearchCost(divName, /** @type {CorpResearchName} */ (name));

    let next;
    while ((next = nextResearch(DEFAULTS.corpResearch, owned, costOf, points, DEFAULTS.corpResearchSpend))) {
      say(`corp-research: ${divName} researching ${next.name} for ${next.cost} points`);
      if (!dryRun) ns.corporation.research(divName, /** @type {CorpResearchName} */ (next.name));
      points -= next.cost;
      owned.push(next.name);
    }
  }
}
```

Add to `CORP_SCRIPTS`:

```js
  "src/tools/corp-research.js": 101.6,
```

- [ ] **Step 8: Run everything**

Run: `npm test && npm run check`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add src/lib/corp.js src/lib/constants.js src/tools/corp-research.js globals.d.ts test/corp.test.js test/corp-research.test.js test/corp-ram.test.js
git commit -m "Add corp-research.js: corp upgrades and research

Levels upgrades one each per run, cheapest first, within 5% of the money
above the reserve. Researches corpResearch strictly in order, each once
it costs at most half the division's points. Research needs the Office
API; upgrades don't.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: corp-invest.js: funding rounds, IPO, dividends

**Files:**
- Create: `src/tools/corp-invest.js`, `test/corp-invest.test.js`
- Modify: `src/lib/corp.js`, `test/corp.test.js`, `src/lib/constants.js`, `test/corp-ram.test.js`

**Interfaces:**
- Consumes: `test/corp-mock.mjs` (Task 2), `writePortData` and `PORTS.CORP_STATUS` (existing), the `CorpStatus` global (existing).
- Produces in `src/lib/corp.js`: typedef `OfferTrack = {round, best, mark, markAt}`, `trackOffer(track: OfferTrack | null, offer: {round, funds}, now: number, minGrowth: number) → OfferTrack`, `shouldAcceptOffer(track, offer: {funds}, now, {plateauMs, dip}) → boolean`.
- Produces in DEFAULTS: `corpInvestRounds`, `corpInvestPlateauMs`, `corpInvestMinGrowth`, `corpInvestDip`, `corpDividendRate`.
- File: `/data/corp-invest.txt` holds the current round's `OfferTrack` as JSON (empty after an acceptance).

- [ ] **Step 1: Write the lib tests**

Add `trackOffer`, `shouldAcceptOffer` to the import in `test/corp.test.js`, then append:

```js
// ── trackOffer / shouldAcceptOffer ──────────────────────────────────────────

test("trackOffer starts a record on the first offer of a round", () => {
  assert.deepEqual(trackOffer(null, { round: 1, funds: 100 }, 5, 0.02), { round: 1, best: 100, mark: 100, markAt: 5 });
  const old = { round: 1, best: 500, mark: 500, markAt: 0 };
  assert.deepEqual(trackOffer(old, { round: 2, funds: 100 }, 5, 0.02), { round: 2, best: 100, mark: 100, markAt: 5 });
});

test("trackOffer moves the mark only on growth of at least minGrowth", () => {
  const track = { round: 1, best: 100, mark: 100, markAt: 0 };
  assert.deepEqual(trackOffer(track, { round: 1, funds: 101 }, 5, 0.02), { round: 1, best: 101, mark: 100, markAt: 0 });
  assert.deepEqual(trackOffer(track, { round: 1, funds: 110 }, 5, 0.02), { round: 1, best: 110, mark: 110, markAt: 5 });
});

test("trackOffer keeps the best offer when the offer drops", () => {
  const track = { round: 1, best: 100, mark: 100, markAt: 0 };
  assert.deepEqual(trackOffer(track, { round: 1, funds: 90 }, 5, 0.02), track);
});

const RULE = { plateauMs: 1000, dip: 0.05 };

test("shouldAcceptOffer waits until the offer has stopped growing", () => {
  const track = { round: 1, best: 100, mark: 100, markAt: 0 };
  assert.equal(shouldAcceptOffer(track, { funds: 100 }, 999, RULE), false);
  assert.equal(shouldAcceptOffer(track, { funds: 100 }, 1000, RULE), true);
});

test("shouldAcceptOffer doesn't sign at a dip", () => {
  const track = { round: 1, best: 100, mark: 100, markAt: 0 };
  assert.equal(shouldAcceptOffer(track, { funds: 95 }, 5000, RULE), true);
  assert.equal(shouldAcceptOffer(track, { funds: 94 }, 5000, RULE), false);
});

test("shouldAcceptOffer never accepts an empty offer", () => {
  assert.equal(shouldAcceptOffer({ round: 1, best: 0, mark: 0, markAt: 0 }, { funds: 0 }, 5000, RULE), false);
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `NODE_OPTIONS='--import ./test/setup.mjs' node --test test/corp.test.js`
Expected: FAIL. `does not provide an export named 'shouldAcceptOffer'`

- [ ] **Step 3: Implement**

Append to `src/lib/corp.js`:

```js
// ── Investment ──────────────────────────────────────────────────────────────

/** @typedef {{round: number, best: number, mark: number, markAt: number}} OfferTrack */

/**
 * Update the record of this funding round's offers. `best` is the highest offer seen. `mark`
 * and `markAt` are the last offer that beat the previous mark by at least `minGrowth`, and
 * when it came. A new round starts a new record.
 *
 * @param {OfferTrack | null} track
 * @param {{round: number, funds: number}} offer
 * @param {number} now ms
 * @param {number} minGrowth 0.02 = 2%
 * @returns {OfferTrack}
 */
export function trackOffer(track, offer, now, minGrowth) {
  if (!track || track.round !== offer.round) {
    return { round: offer.round, best: offer.funds, mark: offer.funds, markAt: now };
  }
  const best = Math.max(track.best, offer.funds);
  if (offer.funds > track.mark * (1 + minGrowth)) {
    return { round: offer.round, best, mark: offer.funds, markAt: now };
  }
  return { ...track, best };
}

/**
 * Accept once the offers have stopped growing: no `minGrowth` jump for `plateauMs`, and the
 * current offer within `dip` of the best seen. Offers swing with the corp's cycle, so this
 * avoids signing at a low.
 *
 * @param {OfferTrack} track
 * @param {{funds: number}} offer
 * @param {number} now ms
 * @param {{plateauMs: number, dip: number}} rule
 * @returns {boolean}
 */
export function shouldAcceptOffer(track, offer, now, { plateauMs, dip }) {
  return offer.funds > 0 && now - track.markAt >= plateauMs && offer.funds >= track.best * (1 - dip);
}
```

- [ ] **Step 4: Run the lib tests**

Run: `NODE_OPTIONS='--import ./test/setup.mjs' node --test test/corp.test.js`
Expected: PASS

- [ ] **Step 5: Write the tool tests**

Create `test/corp-invest.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { main } from "/src/tools/corp-invest.js";
import { PORTS } from "/src/lib/constants.js";
import { callsTo, makeCorpNs } from "./corp-mock.mjs";

const TRACK_FILE = "/data/corp-invest.txt";
// A record whose last growth was at the epoch: the 15-minute plateau has long passed.
const stale = (best) => JSON.stringify({ round: 1, best, mark: best, markAt: 0 });

test("the first look at an offer records it and accepts nothing", async () => {
  const { ns, state } = makeCorpNs({ offer: { round: 1, funds: 100e9, shares: 1e8 } });
  await main(ns);
  assert.deepEqual(callsTo(state, "acceptInvestmentOffer"), []);
  assert.equal(JSON.parse(state.files[TRACK_FILE]).best, 100e9);
});

test("it accepts an offer that has stopped growing", async () => {
  const { ns, state } = makeCorpNs({
    offer: { round: 1, funds: 99e9, shares: 1e8 },
    files: { [TRACK_FILE]: stale(100e9) },
  });
  await main(ns);
  assert.equal(callsTo(state, "acceptInvestmentOffer").length, 1);
  assert.equal(state.files[TRACK_FILE], "");
});

test("it doesn't accept an offer that has dipped below the best", async () => {
  const { ns, state } = makeCorpNs({
    offer: { round: 1, funds: 90e9, shares: 1e8 },
    files: { [TRACK_FILE]: stale(100e9) },
  });
  await main(ns);
  assert.deepEqual(callsTo(state, "acceptInvestmentOffer"), []);
});

test("it treats an unreadable record as no record", async () => {
  const { ns, state } = makeCorpNs({
    offer: { round: 1, funds: 100e9, shares: 1e8 },
    files: { [TRACK_FILE]: "not json" },
  });
  await main(ns);
  assert.deepEqual(callsTo(state, "acceptInvestmentOffer"), []);
  assert.equal(JSON.parse(state.files[TRACK_FILE]).best, 100e9);
});

test("after the last round it goes public without issuing shares", async () => {
  const { ns, state } = makeCorpNs({ offer: { round: 5, funds: 0, shares: 0 } });
  await main(ns);
  assert.deepEqual(callsTo(state, "goPublic"), [[0]]);
});

test("once public it sets the dividend rate, once", async () => {
  const { ns, state } = makeCorpNs({ isPublic: true });
  await main(ns);
  await main(ns);
  assert.deepEqual(callsTo(state, "issueDividends"), [[0.1]]);
});

test("it publishes the corp's status", async () => {
  const { ns, state } = makeCorpNs({ funds: 7e9 });
  await main(ns);
  assert.deepEqual(JSON.parse(state.ports[PORTS.CORP_STATUS]), {
    revenue: 2e6, expenses: 1e6, profit: 1e6, funds: 7e9, divisions: 1,
  });
});

test("dry changes nothing and writes nothing", async () => {
  const { ns, state } = makeCorpNs({
    args: ["dry"],
    offer: { round: 1, funds: 99e9, shares: 1e8 },
    files: { [TRACK_FILE]: stale(100e9) },
  });
  await main(ns);
  assert.deepEqual(state.calls, []);
  assert.equal(state.files[TRACK_FILE], stale(100e9));
  assert.deepEqual(state.ports, {});
});
```

Run: `NODE_OPTIONS='--import ./test/setup.mjs' node --test test/corp-invest.test.js`
Expected: FAIL, `Cannot find module` for `/src/tools/corp-invest.js`

- [ ] **Step 6: Add the defaults and roster entry**

In DEFAULTS, directly under `  corpResearchSpend: 0.5,`:

```js
  // Funding rounds corp-invest.js takes before going public. Each is accepted once the offer
  // has grown less than corpInvestMinGrowth for corpInvestPlateauMs and is within
  // corpInvestDip of the best offer seen in that round.
  corpInvestRounds: 4,
  corpInvestPlateauMs: 15 * 60 * 1000,
  corpInvestMinGrowth: 0.02,
  corpInvestDip: 0.05,
  // Share of profit paid to shareholders (you) once public. Capped at the game's dividendMaxRate.
  corpDividendRate: 0.1,
```

In MANAGERS, under the `corp-research` line:

```js
  { id: "corp-invest", script: "/src/tools/corp-invest.js", name: "Corp Investment", priority: 11.5, phase: 6, oneShot: true },
```

- [ ] **Step 7: Implement the tool**

Create `src/tools/corp-invest.js`:

```js
import { shouldAcceptOffer, trackOffer } from "/src/lib/corp.js";
import { DEFAULTS, PORTS } from "/src/lib/constants.js";
import { writePortData } from "/src/lib/port-registry.js";
import { formatMoney, log, tlog } from "/src/lib/utils.js";

// Takes the investment rounds, then goes public and pays dividends.
//
//   run /src/tools/corp-invest.js        act
//   run /src/tools/corp-invest.js dry    report what it would do
//
// Rounds 1 to DEFAULTS.corpInvestRounds are each accepted once the offer stops growing (see
// shouldAcceptOffer). The offers seen so far this round are kept in TRACK_FILE between runs.
// After the last round the corporation goes public issuing no new shares, which keeps your
// ownership, and then pays DEFAULTS.corpDividendRate of profit as dividends. Dividends are the
// only way corporation profit reaches your own money.
//
// Also publishes CorpStatus on PORTS.CORP_STATUS.
//
// ONE-SHOT and idempotent: the daemon runs it about three times every five minutes.

const TRACK_FILE = "/data/corp-invest.txt";

/**
 * @param {NS} ns
 * @returns {OfferTrack | null}
 */
function readTrack(ns) {
  try {
    return JSON.parse(ns.read(TRACK_FILE));
  } catch {
    return null; // no file yet, or one written by hand
  }
}
/** @typedef {import("/src/lib/corp.js").OfferTrack} OfferTrack */

/** @param {NS} ns */
export async function main(ns) {
  const dryRun = String(ns.args[0] ?? "").toLowerCase() === "dry";
  const say = (/** @type {string} */ msg) => (dryRun ? tlog(ns, msg) : log(ns, msg));

  if (!ns.corporation.hasCorporation()) return;
  const corp = ns.corporation.getCorporation();

  /** @type {CorpStatus} */
  const status = {
    revenue: corp.revenue,
    expenses: corp.expenses,
    profit: corp.revenue - corp.expenses,
    funds: corp.funds,
    divisions: corp.divisions.length,
  };
  if (!dryRun) writePortData(ns, PORTS.CORP_STATUS, status);

  if (corp.public) {
    const rate = Math.min(DEFAULTS.corpDividendRate, ns.corporation.getConstants().dividendMaxRate);
    if (corp.dividendRate !== rate) {
      tlog(ns, `corp-invest: ${dryRun ? "would pay" : "paying"} ${rate * 100}% of profit as dividends`);
      if (!dryRun) ns.corporation.issueDividends(rate);
    }
    return;
  }

  const offer = ns.corporation.getInvestmentOffer();
  if (offer.round > DEFAULTS.corpInvestRounds) {
    tlog(ns, `corp-invest: ${dryRun ? "would go" : "going"} public, issuing no new shares`);
    if (!dryRun) ns.corporation.goPublic(0);
    return;
  }

  const now = Date.now();
  const track = trackOffer(readTrack(ns), offer, now, DEFAULTS.corpInvestMinGrowth);
  const rule = { plateauMs: DEFAULTS.corpInvestPlateauMs, dip: DEFAULTS.corpInvestDip };
  if (shouldAcceptOffer(track, offer, now, rule)) {
    tlog(ns, `corp-invest: ${dryRun ? "would accept" : "accepting"} round ${offer.round}: ${formatMoney(offer.funds)} for ${offer.shares} shares`);
    if (dryRun) return;
    ns.corporation.acceptInvestmentOffer();
    ns.write(TRACK_FILE, "", "w");
    return;
  }

  say(`corp-invest: round ${offer.round} offer ${formatMoney(offer.funds)}, best ${formatMoney(track.best)}; waiting for it to level off`);
  if (!dryRun) ns.write(TRACK_FILE, JSON.stringify(track), "w");
}
```

Add to `CORP_SCRIPTS`:

```js
  "src/tools/corp-invest.js": 81.6,
```

- [ ] **Step 8: Run everything**

Run: `npm test && npm run check`
Expected: PASS (about 549 tests)

- [ ] **Step 9: Commit**

```bash
git add src/lib/corp.js src/lib/constants.js src/tools/corp-invest.js test/corp.test.js test/corp-invest.test.js test/corp-ram.test.js
git commit -m "Add corp-invest.js: funding rounds, IPO, dividends

Accepts rounds 1-4 once the offer stops growing (under 2% in 15 min)
and sits within 5% of the round's best, keeping the record in
/data/corp-invest.txt. Then goes public with no new shares and pays 10%
dividends, the only way corp profit reaches the player. Publishes
CorpStatus on PORTS.CORP_STATUS.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Docs, including the BN3 day-one guide

**Files:**
- Modify: `BITRUNNER-GUIDE.md`, `README.md`, `docs/ARCHITECTURE-AND-AUDIT.md`, `docs/API-COVERAGE-AUDIT.md`, `src/tools/ram-report.js` (comment only)

- [ ] **Step 1: BITRUNNER-GUIDE.md: replace the corp-manager section**

Replace the whole `#### \`advanced/corp-manager.js\` — Corporation Management` section (heading through its "RAM, unresolved" bullet) with:

```markdown
#### Corporation (BitNode 3) — `tools/corp-*.js`
- **Requires**: BitNode 3, or Source-File 3 elsewhere. Seed money only exists in BN3; elsewhere create the corporation yourself (self-funded, $150b).
- **How it runs**: six one-shots that the daemon launches like the other buyers, about three runs every five minutes. Nothing stays resident: every setting they make (jobs, Smart Supply, sell orders, Market-TA.II) persists in the game, and boost materials aren't used up, so nothing needs doing every corp cycle. Each takes `dry` to print its plan and change nothing.

| Script | Does | Needs | RAM |
|---|---|---|---|
| `corp-setup.js` | Creates the corp with seed money, starts the Agriculture division, then buys Smart Supply, offices in the other five cities, and the Warehouse API and Office API unlocks, strictly in that order. Waits at the first step it can't afford. | — | 131.6 GB |
| `corp-warehouse.js` | Buys missing warehouses, turns Smart Supply on, grows a warehouse a level at 80% full | Warehouse API | 121.6 GB |
| `corp-office.js` | Grows offices toward `corpOfficeSize` (9), hires to fill them, sets each job's head count from `corpJobWeights`, buys tea and throws parties | Office API | 151.6 GB |
| `corp-boost.js` | Stocks the boost-material mix that maximizes production, sells the output (MAX at market price), turns Market-TA.II on once researched | Warehouse API (Market-TA.II also needs the Office API) | 141.6 GB |
| `corp-research.js` | Levels corp upgrades cheapest first within 5% of funds per run; researches `corpResearch` in order | — (research needs the Office API) | 101.6 GB |
| `corp-invest.js` | Accepts funding rounds 1–4 once each offer stops growing, then goes public with no new shares and pays 10% dividends | — | 81.6 GB |

- **Money**: nothing spends below `DEFAULTS.corpCashReserve` ($1b; salaries are paid every cycle). Growing an office or warehouse may take `corpStructureSpend` (25%) of the rest. A city's first warehouse may take all of it, since a city without one produces nothing.
- **Boost materials** (Hardware, Robots, AI Cores, Real Estate) multiply production while held and are never sold. `optimalBoostAmounts` in `lib/corp.js` solves for the best mix over the 60% of each warehouse not kept free (`corpWarehouseHeadroom`). The derivation is in its comment. For Agriculture, Real Estate dominates: a small warehouse gets Real Estate alone. When money or space runs short, every purchase shrinks by the same fraction, so the mix stays optimal.
- **Investment**: offers grow with valuation and swing with the corp cycle. A round is accepted once the offer hasn't grown 2% in 15 minutes and is within 5% of the best seen that round (`corpInvest*`). The record is kept in `/data/corp-invest.txt`. Lower `corpInvestRounds` to go public sooner.
- **Dividends are the only way corp profit reaches your money.** `corpDividendRate` (10%) is a trade-off: a higher rate pays you more now but leaves less for the corp to grow with. Spend the money on augmentations, or on rep with `faction-donate.js`: BN3 allows donations from 75 favor, and a donation costs about $1m per rep point against a bribe's $1b.
- **Errors are not swallowed.** The old `corp-manager.js` wrapped every call in `try {} catch {}`. It called a function that doesn't exist (`setAutoJobAssignment`), passed the wrong arguments to `getProduct` and `sellProduct`, and never bought the unlocks its calls needed. All of that failed silently, so it never produced anything. `test/corp-ram.test.js` now rejects any `ns.corporation` name that isn't a real function and pins each script's RAM.
- **Not covered**: product industries (Tobacco and the like), exports between divisions, advertising, bribes.

##### BN3 day one
1. **Look before buying**: `run src/tools/corp-setup.js dry` lists the real costs. The two API unlocks are bought last because what they gate is free to do by hand.
2. **Create the corporation**: let `corp-setup.js` do it once home has about 132 GB free, or do it at City Hall → Create Corporation → seed money. Either way it then starts the division, buys Smart Supply and opens the other five cities as money allows.
3. **Until both API unlocks are owned**, do by hand in the corporation UI, for every city: buy a warehouse, hire 3 employees and put one each on Operations, Engineer and Business, tick Smart Supply, and set Plants and Food to sell `MAX` at `MP`. The tools take over (and reassign hand-hired staff) once the unlocks land.
4. **Leave investment to `corp-invest.js`**, or check its view with `run src/tools/corp-invest.js dry`.
```

- [ ] **Step 2: BITRUNNER-GUIDE.md: the other mentions**

- File tree: `│   ├── sleeve-manager.js, corp-manager.js` → `│   ├── sleeve-manager.js`. Replace `    ├── market-access.js, corp-boost.js           ← one-shot buyers (WSE ladder, corp boosters)` with:
  ```
      ├── market-access.js                          ← one-shot buyer (WSE ladder)
      ├── corp-setup.js, corp-warehouse.js          ← corporation one-shots (BN3)
      ├── corp-office.js, corp-boost.js
      ├── corp-research.js, corp-invest.js
  ```
- manager-toggle ids sentence: replace `` `bladeburner`, `corp`. `` with `` `bladeburner`, and the corp one-shots `corp-setup`, `corp-warehouse`, `corp-office`, `corp-boost`, `corp-research`, `corp-invest`. ``
- ram-report paragraph: replace `It exists to settle one open question: the definitions file prices every \`ns.corporation.*\` call at 20 GB, which would put \`corp-manager.js\` near 400 GB.` with `Use it to check the corporation figures pinned in \`test/corp-ram.test.js\` against what the game charges.`
- One-shot buyers heading: `` `program-buyer.js`, `home-upgrader.js`, `market-access.js`, `corp-boost.js` `` → `` `program-buyer.js`, `home-upgrader.js`, `market-access.js`, `corp-*.js` ``. Replace the `**\`corp-boost.js\`** (SF-3) — …` bullet with: `- **\`corp-*.js\`** (BN3 / SF-3) — six corporation one-shots; see *Corporation (BitNode 3)* above.`
- Startup order list (`7. Market Access *(one-shot)*, … Corporation, Corp Boost *(one-shot)*`): replace `Corporation, Corp Boost *(one-shot)*` with `the corporation one-shots *(setup, warehouses, offices, boost, research, investment)*`.

- [ ] **Step 3: README.md**

- Replace the `run src/tools/corp-boost.js dry` row with:
  ```
  | `run src/tools/corp-setup.js dry` | `dry` | BN3 / SF-3 | The corporation setup plan with live costs: division, Smart Supply, cities, API unlocks. Buys nothing. Run it on BN3 day one. |
  | `run src/tools/corp-<tool>.js dry` | `dry` | BN3 / SF-3 | Any corp tool (`warehouse`, `office`, `boost`, `research`, `invest`) reports what it would do and changes nothing. |
  ```
- ram-report `api` row: replace `Settles whether corporation calls really cost 20 GB each.` with `Checks the corporation figures pinned in \`test/corp-ram.test.js\`.`
- Managers bullet: drop `, \`corp-manager.js\``. One-shot buyers bullet: `` `market-access.js`, `corp-boost.js` `` → `` `market-access.js`, and the six `corp-*.js` tools ``.
- Requirements table: delete the `corp-manager.js` row, and replace the `corp-boost.js` row with `` | `corp-*.js` (auto) | BitNode 3, or SF-3 elsewhere (outside BN3, create the corporation yourself) | ``.

- [ ] **Step 4: The audit docs and ram-report comment**

- `docs/ARCHITECTURE-AND-AUDIT.md` Advanced row: remove `, [\`corp-manager.js\`](../src/advanced/corp-manager.js)`.
- `docs/API-COVERAGE-AUDIT.md`: directly under the `### 5.5 — P1 · Corporation production levers` heading, add:
  ```markdown
  > **Superseded 2026-10-08.** `corp-manager.js` was retired and replaced by six one-shots
  > (`src/tools/corp-*.js`); see *Corporation (BitNode 3)* in `BITRUNNER-GUIDE.md`. RAM is now
  > pinned per script in `test/corp-ram.test.js` (10–20 GB per corporation call, not a flat 20).
  ```
- `src/tools/ram-report.js` lines 15–17: replace the sentence about corp-manager with:
  ```js
  // It also checks the corporation figures pinned in test/corp-ram.test.js: `api` mode asks the
  // game directly instead of trusting the definitions file.
  ```

- [ ] **Step 5: Check nothing stale remains, then run everything**

Run: `grep -rn "corp-manager\|corpBoostTargets" --include=*.md --include=*.js . | grep -v node_modules | grep -v "docs/superpowers\|API-COVERAGE-AUDIT"`
Expected: no output (the audit doc keeps its history).

Run: `npm test && npm run check`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add BITRUNNER-GUIDE.md README.md docs/ARCHITECTURE-AND-AUDIT.md docs/API-COVERAGE-AUDIT.md src/tools/ram-report.js
git commit -m "Document the corp one-shots and the BN3 day-one steps

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: BN3 day one, checked in the game (manual, after entering BitNode 3)

This can't run before BN3: the corporation API needs BitNode 3 or SF-3. Record each answer in `.remember/` or a memory note so the next session can tune DEFAULTS.

- [ ] **Step 1: Check RAM against the table.** Run `run src/tools/ram-report.js api` and compare the corporation rows with `CORP_RAM` in `test/corp-ram.test.js`. If any differ, fix the table and the figures in the guide.
- [ ] **Step 2: Read the real costs.** Run `run src/tools/corp-setup.js dry` (or create the corporation by hand at City Hall with seed money if home RAM is short). Note the division, Smart Supply, office, Warehouse API and Office API costs. If the APIs eat most of the seed money, the setup order in `planSetup` stands, and the manual steps in the guide cover the gap.
- [ ] **Step 3: Check what a new division comes with.** Does Agriculture start with a Sector-12 warehouse? Does a city opened with `expandCity` start with an empty office of size 3? `corp-warehouse.js` handles both cases; this just confirms it.
- [ ] **Step 4: Check the sell-order guard.** Before anything sets an order, what is a material's `desiredSellAmount` (`0`, `""`)? `corp-boost.js` only places an order where it is falsy. If the default is truthy, change the check.
- [ ] **Step 5: Check the boost formula.** Note the division's production multiplier in the UI, let `corp-boost.js` buy, then note it again. It should rise. Also run a one-line script printing `getMaterialData` sizes for the four boost materials and compare them with `BOOST_SIZES`.
- [ ] **Step 6: Check investment and the IPO.** Watch `/data/corp-invest.txt` through round 1. After round 4, confirm `getInvestmentOffer().round` reads 5 (that's what triggers going public) and that `goPublic(0)` is accepted.
