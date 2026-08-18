import { selectGraftTargets } from "/src/lib/grafting.js";
import { formatMoney, formatTime, tlog } from "/src/lib/utils.js";

// Grafts augmentations at VitaLife in New Tokyo. See docs/API-COVERAGE-AUDIT.md §5.11.
//
//   run /src/tools/grafting.js              list what you can afford to graft
//   run /src/tools/grafting.js graft        graft the cheapest affordable augmentation
//   run /src/tools/grafting.js graft <name> graft a specific augmentation (exact name)
//
// MANUAL ON PURPOSE — this is not a daemon manager, for the same reason
// augmentation-buyer.js isn't: grafting takes over the player.
//
//   * graftAugmentation() cancels whatever you are currently doing.
//   * faction-manager.js calls workForFaction() every 30 s, which would cancel the graft
//     right back. It now leaves an in-progress graft alone (it checks getCurrentWork() for
//     type "GRAFTING"), so the two no longer fight — but if you have disabled that guard or
//     are running some other work loop, stop it first:
//         run /src/tools/manager-toggle.js disable faction
//
// Why it matters: grafting buys an augmentation for money alone, with no faction
// reputation required. That is the exact constraint faction-manager.js spends its whole
// cycle grinding against.
//
// RAM (only travelToCity carries the Singularity ×16/×4/×1 multiplier):
//                                        base   SF4.1   SF4.2  SF4.3
//   script base                           1.6     1.6     1.6    1.6
//   grafting.getGraftableAugmentations    5       5       5      5
//   grafting.getAugmentationGraftPrice    3.75    3.75    3.75   3.75
//   grafting.getAugmentationGraftTime     3.75    3.75    3.75   3.75
//   grafting.graftAugmentation            7.5     7.5     7.5    7.5
//   grafting.waitForOngoingGrafting       0       0       0      0
//   ns.getPlayer                          0.5     0.5     0.5    0.5
//   singularity.travelToCity              2      32       8      2
//                                             ────────────────────────
//                                              54.1    30.1   24.1

const VITALIFE_CITY = "New Tokyo";

/** @param {NS} ns */
function hasGraftingAPI(ns) {
  try {
    ns.grafting.getGraftableAugmentations();
    return true;
  } catch {
    return false;
  }
}

/** @param {NS} ns */
export async function main(ns) {
  if (!hasGraftingAPI(ns)) {
    ns.tprint("Grafting API required (Source-File 10) — the same SF that unlocks sleeves.");
    return;
  }

  const args = ns.args.map(String);
  const doGraft = args[0]?.toLowerCase() === "graft";
  const wanted = doGraft ? args.slice(1).join(" ") : "";

  const money = ns.getPlayer().money;

  // getGraftableAugmentations() already filters out augmentations you own. It does NOT
  // filter on money or prerequisites — selectGraftTargets handles money, and an unmet
  // prerequisite just makes graftAugmentation() return false.
  const candidates = ns.grafting.getGraftableAugmentations().map((name) => ({
    name,
    price: ns.grafting.getAugmentationGraftPrice(name),
    time: ns.grafting.getAugmentationGraftTime(name),
  }));

  const affordable = selectGraftTargets(candidates, { money });

  if (!doGraft) {
    ns.tprint(`\n=== Graftable now — ${formatMoney(money)} available ===`);
    if (affordable.length === 0) {
      const cheapest = candidates.sort((a, b) => a.price - b.price)[0];
      ns.tprint("  Nothing affordable yet.");
      if (cheapest) ns.tprint(`  Cheapest: ${cheapest.name} at ${formatMoney(cheapest.price)}`);
      return;
    }
    for (const c of affordable) {
      ns.tprint(`  ${c.name} — ${formatMoney(c.price)}, ${formatTime(c.time)}`);
    }
    ns.tprint(`\n${affordable.length} affordable. Graft the cheapest with:`);
    ns.tprint("  run /src/tools/grafting.js graft");
    ns.tprint("Grafting needs no faction reputation — only money and time.");
    return;
  }

  const target = wanted
    ? candidates.find((c) => c.name.toLowerCase() === wanted.toLowerCase())
    : affordable[0];

  if (!target) {
    ns.tprint(wanted ? `No graftable augmentation named "${wanted}".` : "Nothing affordable to graft.");
    return;
  }
  if (target.price > money) {
    ns.tprint(`${target.name} costs ${formatMoney(target.price)}; you have ${formatMoney(money)}.`);
    return;
  }

  // graftAugmentation throws outright if you are not in New Tokyo.
  if (!ns.singularity.travelToCity(VITALIFE_CITY)) {
    ns.tprint(`Could not travel to ${VITALIFE_CITY} (need $200k for the flight).`);
    return;
  }

  if (!ns.grafting.graftAugmentation(target.name, true)) {
    ns.tprint(`Grafting ${target.name} was refused — usually an unmet prerequisite augmentation.`);
    return;
  }

  tlog(ns, `Grafting ${target.name} (${formatMoney(target.price)}, ~${formatTime(target.time)})`);
  ns.tprint("Leave this running — cancelling the script does not cancel the graft, but");
  ns.tprint("starting other work will. The faction manager knows to leave it alone.");

  // 0 GB, and it accounts for intelligence and focus bonuses that getAugmentationGraftTime
  // does not — so this is the only accurate way to know when the graft actually finished.
  await ns.grafting.waitForOngoingGrafting();
  tlog(ns, `Grafting finished: ${target.name}`);
}
