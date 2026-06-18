import { log, formatMoney } from "/src/lib/utils.js";
import { PORTS } from "/src/lib/constants.js";
import { writePortData } from "/src/lib/port-registry.js";

const EMPLOYEE_ROLES = ["Operations", "Engineer", "Business", "Management", "Research & Development"];

function hasCorpAPI(ns) {
  try {
    ns.corporation.getCorporation();
    return true;
  } catch {
    return false;
  }
}

function manageDivision(ns, divName) {
  const div = ns.corporation.getDivision(divName);
  const funds = ns.corporation.getCorporation().funds;

  for (const city of div.cities) {
    const office = ns.corporation.getOffice(divName, city);

    while (office.numEmployees < office.size) {
      try {
        ns.corporation.hireEmployee(divName, city);
        office.numEmployees++;
      } catch {
        break;
      }
    }

    if (office.numEmployees > 0) {
      const perRole = Math.floor(office.numEmployees / EMPLOYEE_ROLES.length);
      const remainder = office.numEmployees % EMPLOYEE_ROLES.length;

      for (let i = 0; i < EMPLOYEE_ROLES.length; i++) {
        const count = perRole + (i < remainder ? 1 : 0);
        try {
          ns.corporation.setAutoJobAssignment(divName, city, EMPLOYEE_ROLES[i], count);
        } catch {}
      }
    }

    try {
      if (ns.corporation.hasWarehouse(divName, city)) {
        const warehouse = ns.corporation.getWarehouse(divName, city);
        if (warehouse.sizeUsed > warehouse.size * 0.9) {
          const upgradeCost = ns.corporation.getUpgradeWarehouseCost(divName, city);
          if (upgradeCost < funds * 0.1) {
            ns.corporation.upgradeWarehouse(divName, city);
          }
        }
        ns.corporation.setSmartSupply(divName, city, true);
      }
    } catch {}
  }

  if (div.makesProducts) {
    const products = div.products;

    for (const prodName of products) {
      try {
        const product = ns.corporation.getProduct(divName, prodName);
        if (product.developmentProgress >= 100) {
          ns.corporation.sellProduct(divName, prodName, "MAX", "MP", true);
        }
      } catch {}
    }

    if (products.length < 3) {
      try {
        // Pick the lowest unused index so product names never collide (the old Date.now()-based
        // name could repeat within a tick, and makeProduct rejects duplicate names).
        const used = new Set(products);
        let idx = 0;
        while (used.has(`${divName}-P${idx}`)) idx++;
        const name = `${divName}-P${idx}`;
        ns.corporation.makeProduct(divName, div.cities[0], name, 1e9, 1e9);
        log(ns, `Corp: developing product ${name}`);
      } catch {}
    }
  }

  for (const city of div.cities) {
    try {
      const materials = ["Food", "Plants", "Hardware", "Robots", "AI Cores", "Real Estate"];
      for (const mat of materials) {
        const material = ns.corporation.getMaterial(divName, city, mat);
        if (material.stored > 0 && material.productionAmount > 0) {
          ns.corporation.sellMaterial(divName, city, mat, "MAX", "MP");
        }
      }
    } catch {}
  }
}

function buyUpgrades(ns) {
  const upgrades = [
    "Smart Factories", "Smart Storage", "DreamSense",
    "Wilson Analytics", "Nuoptimal Nootropic Injector Implants",
    "Speech Processor Implants", "Neural Accelerators",
    "FocusWires", "ABC SalesBots", "Project Insight",
  ];

  const funds = ns.corporation.getCorporation().funds;

  for (const upgrade of upgrades) {
    try {
      const cost = ns.corporation.getUpgradeLevelCost(upgrade);
      if (cost < funds * 0.05) {
        ns.corporation.levelUpgrade(upgrade);
      }
    } catch {}
  }
}

/** @param {NS} ns */
export async function main(ns) {
  ns.disableLog("ALL");

  if (!hasCorpAPI(ns)) {
    ns.print("ERROR: Corporation API required (Source-File 3 or BitNode 3)");
    return;
  }

  log(ns, "Corporation Manager started");

  while (true) {
    const corp = ns.corporation.getCorporation();

    for (const divName of corp.divisions) {
      manageDivision(ns, divName);
    }

    buyUpgrades(ns);

    if (corp.divisions.length === 0) {
      try {
        ns.corporation.expandIndustry("Agriculture", "Agri");
        log(ns, "Corp: expanded into Agriculture");
      } catch {}
    }

    const investOffer = ns.corporation.getInvestmentOffer();
    if (investOffer && investOffer.round <= 2 && investOffer.funds > 0) {
      // Accept the early (bootstrap) funding rounds when the injection is material — at least
      // the corp's current funds. The equity dilution is worth the capital this early. Rounds
      // beyond 2 are left for manual judgement, since dilution compounds and is irreversible.
      if (investOffer.funds >= corp.funds) {
        try {
          ns.corporation.acceptInvestmentOffer();
          log(ns, `Corp: ACCEPTED investment round ${investOffer.round} for ${formatMoney(investOffer.funds)}`);
        } catch {}
      } else {
        log(ns, `Corp: investment offer round ${investOffer.round}: ${formatMoney(investOffer.funds)} (below threshold, holding)`);
      }
    }

    /** @type {CorpStatus} */
    const status = {
      revenue: corp.revenue,
      expenses: corp.expenses,
      profit: corp.revenue - corp.expenses,
      funds: corp.funds,
      divisions: corp.divisions.length,
    };
    writePortData(ns, PORTS.CORP_STATUS, status);

    await ns.sleep(10000);
  }
}
