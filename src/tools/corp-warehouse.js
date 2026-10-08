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

