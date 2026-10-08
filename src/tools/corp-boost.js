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

