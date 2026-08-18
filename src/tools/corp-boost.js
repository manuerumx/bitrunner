import { BOOST_MATERIALS, planBoostPurchases, TRACKED_MATERIALS } from "/src/lib/corp.js";
import { DEFAULTS } from "/src/lib/constants.js";
import { tlog } from "/src/lib/utils.js";

// Output goods — the ones corp-manager.js puts on sale, and therefore the ones worth
// pricing automatically. Boost materials are held, never sold, so they get no pricing.
const SELLABLE_MATERIALS = TRACKED_MATERIALS.filter((m) => !BOOST_MATERIALS.includes(m));

// Stocks boost materials and turns on automatic pricing — the two production levers
// corp-manager.js never touched. See docs/API-COVERAGE-AUDIT.md §5.5.
//
//   run /src/tools/corp-boost.js          stock boosters, enable MarketTA2
//   run /src/tools/corp-boost.js dry      report the plan, buy nothing
//
// ONE-SHOT, and deliberately separate from corp-manager.js. Every ns.corporation.*
// function is documented at 20 GB, so folding these six calls into the always-on manager
// would add ~120 GB to a script that must stay resident. As a one-shot the cost is
// transient, and the daemon simply skips it while home is busy.
//
// ⚠ UNVERIFIED RAM. The 20 GB/function figure comes from NetscriptDefinitions.d.ts, and
// corp-manager.js already references 20 corp functions — which would put it near 400 GB
// and mean it has never launched. Run `run /src/tools/ram-report.js api` to see what the
// game actually charges before trusting either number.
//
// bulkPurchase, not buyMaterial: buyMaterial sets a per-second buy RATE that keeps running
// after this script exits, which would overfill the warehouse and stall production.
// bulkPurchase buys once, bounded by the plan, and leaves no state behind.

/** @param {NS} ns */
function hasCorpAPI(ns) {
  try {
    ns.corporation.getCorporation();
    return true;
  } catch {
    return false;
  }
}

/** @param {NS} ns */
export async function main(ns) {
  const dryRun = String(ns.args[0] ?? "").toLowerCase() === "dry";

  if (!hasCorpAPI(ns)) {
    ns.print("ERROR: Corporation API required (Source-File 3 or BitNode 3)");
    return;
  }

  const corp = ns.corporation.getCorporation();
  if (corp.divisions.length === 0) {
    tlog(ns, "corp-boost: no divisions yet — corp-manager.js expands first");
    return;
  }

  /** @type {CorpMaterialName[]} */
  const targetNames = /** @type {CorpMaterialName[]} */ (Object.keys(DEFAULTS.corpBoostTargets));
  let bought = 0;
  let priced = 0;

  for (const divName of corp.divisions) {
    const div = ns.corporation.getDivision(divName);

    for (const city of div.cities) {
      let warehouse;
      try {
        warehouse = ns.corporation.getWarehouse(divName, city);
      } catch {
        continue; // no warehouse in this city yet
      }

      // Leave headroom for output goods: a warehouse with no room stalls production
      // outright, which costs more than the boost is worth.
      const usable = warehouse.size * (1 - DEFAULTS.corpWarehouseHeadroom);
      const freeSpace = Math.max(0, usable - warehouse.sizeUsed);

      /** @type {Record<string, number>} */
      const stored = {};
      for (const name of targetNames) {
        stored[name] = ns.corporation.getMaterial(divName, city, name).stored;
      }

      const plan = planBoostPurchases({
        targets: DEFAULTS.corpBoostTargets,
        stored,
        freeSpace,
      });

      for (const item of plan) {
        const name = /** @type {CorpMaterialName} */ (item.name);
        if (dryRun) {
          ns.tprint(`    ${divName}/${city}: buy ${item.amount.toFixed(0)} ${name}`);
          continue;
        }
        try {
          ns.corporation.bulkPurchase(divName, city, name, item.amount);
          bought++;
        } catch {
          // insufficient funds, or the material isn't valid for this industry
        }
      }

      // MarketTA2 prices output at the highest the market will bear, automatically. It is
      // the single biggest revenue lever available, and it replaces the flat "MP" price
      // corp-manager.js sells at. Needs its unlock bought — try/catch is 20 GB cheaper
      // than probing with hasUnlock().
      if (!dryRun) {
        for (const name of SELLABLE_MATERIALS) {
          try {
            ns.corporation.setMaterialMarketTA2(divName, city, name, true);
            priced++;
          } catch {
            // MarketTA2 unlock not purchased yet, or this division doesn't make it
          }
        }
      }
    }
  }

  if (dryRun) {
    tlog(ns, "corp-boost: dry run complete");
    return;
  }
  tlog(ns, `corp-boost: ${bought} bulk purchase(s), MarketTA2 on for ${priced} material(s)`);
}
