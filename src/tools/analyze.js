import { getServerDetails } from "/src/lib/scanner.js";
import { calculateBatch, calculatePrepThreads, isServerPrepped } from "/src/lib/batch-calculator.js";
import { formatMoney, formatRAM, formatTime, formatPercent } from "/src/lib/utils.js";

/** @param {NS} ns */
export async function main(ns) {
  const target = ns.args[0];
  if (!target) {
    ns.tprint("Usage: run tools/analyze.js <hostname>");
    return;
  }

  const srv = getServerDetails(ns, target);
  const prepped = isServerPrepped(ns, target);

  ns.tprint(`\n=== Server Analysis: ${target} ===`);
  ns.tprint(`Organization: ${srv.org}`);
  ns.tprint(`Required Hacking: ${srv.requiredHackLevel}`);
  ns.tprint(`Root Access: ${srv.hasRoot ? "YES" : "NO"}`);
  ns.tprint(`Backdoor: ${srv.backdoor ? "YES" : "NO"}`);
  ns.tprint(`Ports: ${srv.portsOpen}/${srv.portsRequired} open`);
  ns.tprint(`RAM: ${formatRAM(srv.maxRAM)}`);
  ns.tprint("");
  ns.tprint(`--- Money ---`);
  ns.tprint(`Current: ${formatMoney(srv.currentMoney)} / ${formatMoney(srv.maxMoney)} (${formatPercent(srv.maxMoney > 0 ? srv.currentMoney / srv.maxMoney : 0)})`);
  ns.tprint(`--- Security ---`);
  ns.tprint(`Current: ${srv.currentSecurity.toFixed(2)} / Min: ${srv.minSecurity.toFixed(2)}`);
  ns.tprint(`Prepped: ${prepped ? "YES" : "NO"}`);

  if (!srv.hasRoot || srv.requiredHackLevel > ns.getHackingLevel()) {
    ns.tprint("\n[Cannot analyze further — need root access and sufficient hacking level]");
    return;
  }

  ns.tprint("");
  ns.tprint(`--- Hacking ---`);
  ns.tprint(`Hack Chance: ${formatPercent(ns.hackAnalyzeChance(target))}`);
  ns.tprint(`Hack Per Thread: ${formatPercent(ns.hackAnalyze(target))}`);
  ns.tprint(`Hack Time: ${formatTime(ns.getHackTime(target))}`);
  ns.tprint(`Grow Time: ${formatTime(ns.getGrowTime(target))}`);
  ns.tprint(`Weaken Time: ${formatTime(ns.getWeakenTime(target))}`);

  if (!prepped) {
    const prep = calculatePrepThreads(ns, srv);
    ns.tprint("");
    ns.tprint(`--- Prep Required ---`);
    ns.tprint(`Weaken Threads: ${prep.weakenThreads}`);
    ns.tprint(`Grow Threads: ${prep.growThreads}`);
    ns.tprint(`Post-Grow Weaken: ${prep.weakenAfterGrowThreads}`);
    ns.tprint(`Total Prep RAM: ${formatRAM(prep.totalRAM)}`);
  }

  for (const hackPct of [0.25, 0.5, 0.75]) {
    const batch = calculateBatch(ns, target, hackPct);
    const moneyPerBatch = srv.maxMoney * hackPct * ns.hackAnalyzeChance(target);
    const batchesPerSec = 1000 / batch.batchDuration;

    ns.tprint("");
    ns.tprint(`--- HWGW Batch @ ${formatPercent(hackPct)} ---`);
    ns.tprint(`H: ${batch.hackThreads} | W1: ${batch.weakenAfterHackThreads} | G: ${batch.growThreads} | W2: ${batch.weakenAfterGrowThreads}`);
    ns.tprint(`Total: ${batch.totalThreads} threads, ${formatRAM(batch.totalRAM)} RAM`);
    ns.tprint(`Duration: ${formatTime(batch.batchDuration)}`);
    ns.tprint(`$/batch: ${formatMoney(moneyPerBatch)} | $/sec (1 batch): ${formatMoney(moneyPerBatch * batchesPerSec)}`);
  }
}
