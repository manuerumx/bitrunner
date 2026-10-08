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

