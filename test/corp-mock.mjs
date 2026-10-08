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

