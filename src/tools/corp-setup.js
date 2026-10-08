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

