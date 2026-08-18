import { DEFAULTS } from "/src/lib/constants.js";
import { formatMoney, formatRAM, tlog } from "/src/lib/utils.js";

// Buys home RAM. See docs/API-COVERAGE-AUDIT.md §5.3 — home RAM is the single gate on how
// many managers the suite can run at all (daemon.js refuses to launch any script that
// doesn't fit in free home RAM, then locks it), and nothing in the suite ever bought more.
//
//   run /src/tools/home-upgrader.js
//
// ONE-SHOT: exits when the budget runs out; the daemon re-runs it every ~5 min.
// Idempotent because upgradeHomeRam() simply returns false once the money is gone.
//
// No cost probe on purpose. getUpgradeHomeRamCost is 1.5 GB base — 24 GB at SF4.1 — and
// buys nothing, because upgradeHomeRam() already reports failure by returning false.
// Spend is tracked by watching the wallet instead:
//                                base    SF4.1    SF4.2   SF4.3
//   script base                   1.6     1.6      1.6     1.6
//   ns.getPlayer                  0.5     0.5      0.5     0.5
//   ns.getServerMaxRam            0.05    0.05     0.05    0.05
//   singularity.upgradeHomeRam    3      48       12       3
//                                     ─────────────────────────
//                                       50.15    14.15    5.15
//
// Cores are deliberately not bought here. Bitburner's static RAM analyzer charges for
// every literal `ns.<fn>` reference whether or not it executes, so guarding
// upgradeHomeCores behind a config flag would cost the full 48 GB at SF4.1 regardless —
// and cores only help grow/weaken threads that happen to run on home. RAM comes first;
// revisit once home is large enough that the extra 96 GB is affordable.

/** @param {NS} ns */
export async function main(ns) {
  const startMoney = ns.getPlayer().money;
  const startRAM = ns.getServerMaxRam("home");
  const budget = startMoney * DEFAULTS.homeUpgradeBudgetPercent;

  let upgrades = 0;
  while (startMoney - ns.getPlayer().money < budget) {
    if (!ns.singularity.upgradeHomeRam()) break;
    upgrades++;
  }

  if (upgrades === 0) {
    tlog(ns, `home-upgrader: no upgrade within budget (${formatMoney(budget)})`);
    return;
  }

  const spent = startMoney - ns.getPlayer().money;
  tlog(
    ns,
    `home-upgrader: ${upgrades} upgrade(s), ${formatRAM(startRAM)} → ` +
      `${formatRAM(ns.getServerMaxRam("home"))} for ${formatMoney(spent)}`
  );
}
