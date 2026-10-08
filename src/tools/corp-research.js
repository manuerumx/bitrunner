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

