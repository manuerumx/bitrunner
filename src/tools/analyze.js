import { getServerDetails, scanNetwork } from "/src/lib/scanner.js";
import { calculateBatch, calculatePrepThreads, isServerPrepped, fitBatchToRAM } from "/src/lib/batch-calculator.js";
import { getConfig } from "/src/lib/config.js";
import { DEFAULTS } from "/src/lib/constants.js";
import { formatMoney, formatRAM, formatTime, formatPercent } from "/src/lib/utils.js";

// Free RAM the hack-coordinator would see right now — same accounting it uses (rooted servers plus
// home minus reservedHomeRAM), so the "what will actually run" section below matches its log lines.
/** @param {NS} ns */
function coordinatorPoolRAM(ns) {
  let total = Math.max(0, ns.getServerMaxRam("home") - ns.getServerUsedRam("home") - DEFAULTS.reservedHomeRAM);
  for (const hostname of scanNetwork(ns)) {
    if (!ns.hasRootAccess(hostname)) continue;
    total += Math.max(0, ns.getServerMaxRam(hostname) - ns.getServerUsedRam(hostname));
  }
  return total;
}

/** @param {NS} ns */
export async function main(ns) {
  const target = String(ns.args[0] ?? "");
  if (!target) {
    ns.tprint("Usage: run src/tools/analyze.js <hostname>");
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

  // What the coordinator will ACTUALLY dispatch. hackPercent is a ceiling: it shrinks the steal
  // until the batch fits poolFree / hwgwFitBatches (see lib/batch-calculator.fitBatchToRAM), so the
  // fixed-percent table below can show a batch that is far too big to ever run. Print the fitted
  // one first, or this tool contradicts the coordinator's own log.
  const cfg = getConfig(ns);
  const poolRAM = coordinatorPoolRAM(ns);
  const share = poolRAM / Math.max(1, cfg.hwgwFitBatches);
  const fit =
    fitBatchToRAM(ns, target, share, cfg.hackPercent, cfg.hwgwMinHackPercent, cfg.batchSpacingMs) ||
    fitBatchToRAM(ns, target, poolRAM, cfg.hackPercent, cfg.hwgwMinHackPercent, cfg.batchSpacingMs);

  ns.tprint("");
  ns.tprint(`--- What the coordinator will dispatch (pool: ${formatRAM(poolRAM)} free) ---`);
  if (!fit) {
    const smallest = calculateBatch(ns, target, cfg.hwgwMinHackPercent, cfg.batchSpacingMs);
    ns.tprint(`NO HWGW: even a ${formatPercent(cfg.hwgwMinHackPercent)} batch needs ${formatRAM(smallest.totalRAM)}.`);
    ns.tprint(`Buy RAM, or lower the floor: run src/tools/hwgw-tune.js min <fraction>`);
  } else {
    const fitted = Math.floor(poolRAM / fit.batch.totalRAM);
    const moneyPerBatch = srv.maxMoney * fit.hackPercent * ns.hackAnalyzeChance(target);
    ns.tprint(`Fitted steal: ${formatPercent(fit.hackPercent)} (ceiling ${formatPercent(cfg.hackPercent)})`);
    ns.tprint(`H: ${fit.batch.hackThreads} | W1: ${fit.batch.weakenAfterHackThreads} | G: ${fit.batch.growThreads} | W2: ${fit.batch.weakenAfterGrowThreads}`);
    ns.tprint(`Per batch: ${formatRAM(fit.batch.totalRAM)}, ${formatMoney(moneyPerBatch)} — ~${fitted} fit in the pool`);
    ns.tprint(`$/sec at that depth: ${formatMoney((fitted * moneyPerBatch) / (fit.batch.batchDuration / 1000))}`);
  }

  ns.tprint("");
  ns.tprint(`--- Fixed-percent reference (ignores available RAM) ---`);
  for (const hackPct of [0.25, 0.5, 0.75]) {
    const batch = calculateBatch(ns, target, hackPct, cfg.batchSpacingMs);
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
