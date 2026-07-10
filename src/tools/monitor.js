import { scanNetwork, getServerDetails } from "/src/lib/scanner.js";
import { selectTargets } from "/src/lib/target-selector.js";
import { getConfig } from "/src/lib/config.js";
import { formatMoney, formatRAM, formatPercent, formatTime } from "/src/lib/utils.js";

/** @param {NS} ns */
export async function main(ns) {
  ns.disableLog("ALL");
  ns.ui.openTail();

  let prevMoney = ns.getPlayer().money;
  let prevTime = Date.now();

  while (true) {
    const player = ns.getPlayer();
    const now = Date.now();
    const elapsed = (now - prevTime) / 1000;
    const moneyPerSec = elapsed > 0 ? (player.money - prevMoney) / elapsed : 0;
    prevMoney = player.money;
    prevTime = now;

    const hostnames = scanNetwork(ns);
    let rootedCount = 0, totalNetRAM = 0, usedNetRAM = 0;
    let xpThreads = 0, shareThreads = 0;
    const countSurplusWorkers = (h) => {
      for (const p of ns.ps(h)) {
        const base = p.filename.split("/").pop();
        if (base === "xp.js") xpThreads += p.threads;
        else if (base === "share.js") shareThreads += p.threads;
      }
    };
    countSurplusWorkers("home");
    for (const h of hostnames) {
      if (ns.hasRootAccess(h)) {
        rootedCount++;
        totalNetRAM += ns.getServerMaxRam(h);
        usedNetRAM += ns.getServerUsedRam(h);
        countSurplusWorkers(h);
      }
    }

    const homeMax = ns.getServerMaxRam("home");
    const homeUsed = ns.getServerUsedRam("home");
    const purchased = ns.cloud.getServerNames();
    const hacknetNodes = ns.hacknet.numNodes();
    let hacknetProd = 0;
    for (let i = 0; i < hacknetNodes; i++) {
      hacknetProd += ns.hacknet.getNodeStats(i).production;
    }

    const targets = selectTargets(ns, 5);

    ns.clearLog();
    ns.print("╔════════════════════════════════════════╗");
    ns.print("║         BITRUNNER MONITOR              ║");
    ns.print("╚════════════════════════════════════════╝");
    ns.print("");
    ns.print(`  Money:     ${formatMoney(player.money)}  (${formatMoney(moneyPerSec)}/s)`);
    ns.print(`  Hacking:   ${ns.getHackingLevel()}`);
    ns.print(`  Home RAM:  ${formatRAM(homeMax - homeUsed)} / ${formatRAM(homeMax)}`);
    ns.print("");
    ns.print("── Network ──");
    ns.print(`  Rooted:    ${rootedCount} / ${hostnames.length}`);
    ns.print(`  Botnet:    ${formatRAM(usedNetRAM)} / ${formatRAM(totalNetRAM)} (${formatPercent(totalNetRAM > 0 ? usedNetRAM / totalNetRAM : 0)})`);
    ns.print(`  Purchased: ${purchased.length} / 25`);
    ns.print(`  Hacknet:   ${hacknetNodes} nodes (${formatMoney(hacknetProd)}/s)`);

    if (purchased.length > 0) {
      const rams = purchased.map((h) => ns.getServerMaxRam(h)).sort((a, b) => a - b);
      ns.print(`  Purch RAM: ${formatRAM(rams[0])} - ${formatRAM(rams[rams.length - 1])}`);
    }

    // Surplus-RAM modes (config-overrides port): what the toggle says vs what's actually running.
    const cfg = getConfig(ns);
    ns.print("");
    ns.print("── Surplus RAM ──");
    ns.print(`  XP farm:   ${cfg.xpFarmRAM ? `▶ ON  (${xpThreads} threads)` : "· OFF"}`);
    const shareState = cfg.shareIdleRAM
      ? `▶ ON  (${shareThreads} threads, forced)`
      : shareThreads > 0
        ? `▶ ON  (${shareThreads} threads, faction grind)`
        : "· OFF";
    ns.print(`  Share:     ${shareState}`);

    ns.print("");
    ns.print("── Top Targets ──");
    ns.print("  Server              Money                Security        Hack");
    for (const t of targets) {
      const curMoney = ns.getServerMoneyAvailable(t.hostname);
      const curSec = ns.getServerSecurityLevel(t.hostname);
      const name = t.hostname.padEnd(20);
      const money = `${formatMoney(curMoney)}/${formatMoney(t.maxMoney)}`.padEnd(20);
      const sec = `${curSec.toFixed(1)}/${t.minSecurity.toFixed(1)}`.padEnd(14);
      const hack = formatTime(t.hackTime);
      ns.print(`  ${name} ${money} ${sec} ${hack}`);
    }

    ns.print("");
    ns.print("── Scripts ──");
    const scripts = ns.ps("home");
    const grouped = {};
    for (const s of scripts) {
      const base = s.filename.split("/").pop();
      if (!grouped[base]) grouped[base] = { count: 0, threads: 0, ram: 0 };
      grouped[base].count++;
      grouped[base].threads += s.threads;
      grouped[base].ram += ns.getScriptRam(s.filename) * s.threads;
    }
    for (const [name, info] of Object.entries(grouped)) {
      ns.print(`  ${name}: ${info.count} inst, ${info.threads} threads, ${formatRAM(info.ram)}`);
    }

    await ns.sleep(2000);
  }
}
