import { scanNetwork } from "/src/lib/scanner.js";
import { selectTargets } from "/src/lib/target-selector.js";
import { WORKER_RAM, DEFAULTS } from "/src/lib/constants.js";
import { calculateBatch, isServerPrepped } from "/src/lib/batch-calculator.js";
import { log, formatMoney, formatTime, formatRAM } from "/src/lib/utils.js";

function getAvailableRAM(ns, hostname) {
  const max = ns.getServerMaxRam(hostname);
  const used = ns.getServerUsedRam(hostname);
  if (hostname === "home") {
    return Math.max(0, max - used - DEFAULTS.reservedHomeRAM);
  }
  return Math.max(0, max - used);
}

function getAllWorkerServers(ns) {
  const servers = [];
  const hostnames = scanNetwork(ns);

  for (const hostname of hostnames) {
    if (!ns.hasRootAccess(hostname)) continue;
    const freeRAM = getAvailableRAM(ns, hostname);
    if (freeRAM < WORKER_RAM.WEAKEN) continue;
    servers.push({ hostname, freeRAM });
  }

  const homeFree = getAvailableRAM(ns, "home");
  if (homeFree >= WORKER_RAM.WEAKEN) {
    servers.push({ hostname: "home", freeRAM: homeFree });
  }

  servers.sort((a, b) => b.freeRAM - a.freeRAM);
  return servers;
}

function poolFreeRAM(workerServers) {
  return workerServers.reduce((sum, s) => sum + s.freeRAM, 0);
}

function execWorker(ns, script, host, threads, target, delay = 0) {
  if (threads <= 0) return 0;
  const pid = ns.exec(script, host, threads, target, delay);
  return pid > 0 ? threads : 0;
}

// --- THREAD ALLOCATION ---

function allocateThreads(ns, workerServers, script, threadsNeeded, target, delay = 0) {
  let remaining = threadsNeeded;
  let allocated = 0;
  const ram = script === "/src/hack.js" ? WORKER_RAM.HACK
    : script === "/src/grow.js" ? WORKER_RAM.GROW
    : WORKER_RAM.WEAKEN;

  for (const server of workerServers) {
    if (remaining <= 0) break;
    if (server.freeRAM < ram) continue;

    const canRun = Math.floor(server.freeRAM / ram);
    const toRun = Math.min(canRun, remaining);
    const used = execWorker(ns, script, server.hostname, toRun, target, delay);
    if (used > 0) {
      allocated += used;
      remaining -= used;
      server.freeRAM -= used * ram;
    }
  }

  return allocated;
}

// --- SMART PREP (weaken-first, exact thread counts) ---
//
// grow is INEFFECTIVE at high security — the game's growth formula
// penalizes security above minimum. So we weaken to min FIRST,
// then grow in the next cycle once security is low.

function prepTarget(ns, hostname, workerServers) {
  const currentSecurity = ns.getServerSecurityLevel(hostname);
  const minSecurity = ns.getServerMinSecurityLevel(hostname);
  const currentMoney = ns.getServerMoneyAvailable(hostname);
  const maxMoney = ns.getServerMaxMoney(hostname);

  let threadsUsed = 0;
  const secDiff = currentSecurity - minSecurity;

  if (secDiff > 0.5) {
    // Security too high — weaken only, don't waste grow threads.
    const weakenNeeded = Math.ceil(secDiff / ns.weakenAnalyze(1));
    threadsUsed += allocateThreads(ns, workerServers, "/src/weaken.js", weakenNeeded, hostname);
  } else if (currentMoney < maxMoney * 0.99) {
    // Security at minimum — grow money + compensating weaken.
    let growNeeded = 0;
    if (currentMoney > 0) {
      growNeeded = Math.ceil(ns.growthAnalyze(hostname, maxMoney / currentMoney));
    } else {
      growNeeded = Math.ceil(ns.growthAnalyze(hostname, Math.min(maxMoney, 1e6)));
    }
    if (growNeeded > 0 && isFinite(growNeeded)) {
      const actualGrow = allocateThreads(ns, workerServers, "/src/grow.js", growNeeded, hostname);
      threadsUsed += actualGrow;
      if (actualGrow > 0) {
        const growSecIncrease = ns.growthAnalyzeSecurity(actualGrow, hostname);
        const weakenForGrow = Math.ceil(growSecIncrease / ns.weakenAnalyze(1));
        threadsUsed += allocateThreads(ns, workerServers, "/src/weaken.js", weakenForGrow, hostname);
      }
    }
  }

  return threadsUsed;
}

// --- HWGW BATCH (precision-timed hack cycle) ---

function runHWGWBatch(ns, target, workerServers, batchId) {
  const hostname = target.hostname;
  const batch = calculateBatch(ns, hostname, DEFAULTS.hackPercent);

  if (poolFreeRAM(workerServers) < batch.totalRAM) return { dispatched: false, batch };

  const offset = batchId * DEFAULTS.batchSpacingMs * 4;

  const h = allocateThreads(ns, workerServers, "/src/hack.js", batch.hackThreads, hostname, batch.timings.hackDelay + offset);
  const w1 = allocateThreads(ns, workerServers, "/src/weaken.js", batch.weakenAfterHackThreads, hostname, batch.timings.weaken1Delay + offset);
  const g = allocateThreads(ns, workerServers, "/src/grow.js", batch.growThreads, hostname, batch.timings.growDelay + offset);
  const w2 = allocateThreads(ns, workerServers, "/src/weaken.js", batch.weakenAfterGrowThreads, hostname, batch.timings.weaken2Delay + offset);

  return {
    dispatched: h > 0 || w1 > 0 || g > 0 || w2 > 0,
    threads: h + w1 + g + w2,
    batch,
  };
}

// --- MAIN LOOP ---

/** @param {NS} ns */
export async function main(ns) {
  ns.disableLog("ALL");

  while (true) {
    const workerServers = getAllWorkerServers(ns);
    const totalFreeRAM = poolFreeRAM(workerServers);

    if (totalFreeRAM < WORKER_RAM.WEAKEN) {
      log(ns, "No free RAM. Waiting for scripts to finish...");
      await ns.sleep(DEFAULTS.managerCycleMs);
      continue;
    }

    // Select investment targets (top by maxMoney potential)
    const targetCount = Math.max(3, Math.min(6, Math.floor(totalFreeRAM / 256) || 3));
    const targets = selectTargets(ns, targetCount);

    if (targets.length === 0) {
      log(ns, "No valid targets found. Waiting...");
      await ns.sleep(DEFAULTS.managerCycleMs);
      continue;
    }

    // Categorize
    const preppedTargets = [];
    const unprepTargets = [];
    for (const t of targets) {
      if (isServerPrepped(ns, t.hostname)) preppedTargets.push(t);
      else unprepTargets.push(t);
    }

    let totalThreads = 0;
    const summary = [];
    let hwgwCompletionTime = 0;
    let prepWeakenTime = 0;
    let didHackIncome = false;

    // ──────────────────────────────────────────────
    // Phase 1: HWGW batches on ALL prepped targets
    // ──────────────────────────────────────────────
    for (const target of preppedTargets) {
      let batchCount = 0;
      let lastBatch = null;

      for (let i = 0; i < 100; i++) {
        const result = runHWGWBatch(ns, target, workerServers, i);
        if (!result.dispatched) break;
        batchCount++;
        lastBatch = result.batch;
        totalThreads += result.threads;
        if (poolFreeRAM(workerServers) < result.batch.totalRAM) break;
      }

      if (batchCount > 0) {
        summary.push(`${target.hostname}(${batchCount}×HWGW)`);
        const lastOffset = (batchCount - 1) * DEFAULTS.batchSpacingMs * 4;
        hwgwCompletionTime = Math.max(hwgwCompletionTime, lastOffset + lastBatch.batchDuration);
      }
    }

    // ──────────────────────────────────────────────
    // Phase 2: Smart prep — but ONLY if no prepped
    //   target is starved for HWGW RAM.
    //
    //   If a target is prepped but HWGW couldn't
    //   dispatch (RAM full from prior prep scripts),
    //   DON'T dispatch more prep — it makes it worse.
    //   Wait for running scripts to finish instead.
    // ──────────────────────────────────────────────
    const hwgwBlocked = preppedTargets.length > 0 && hwgwCompletionTime === 0;

    if (!hwgwBlocked && unprepTargets.length > 0) {
      const ramBeforePrep = poolFreeRAM(workerServers);
      const prepBudget = ramBeforePrep * 0.5; // save 50% for Phase 3

      for (const target of unprepTargets) {
        const remaining = poolFreeRAM(workerServers);
        if (remaining < WORKER_RAM.WEAKEN) break;
        if (ramBeforePrep - remaining >= prepBudget) break;

        const used = prepTarget(ns, target.hostname, workerServers);
        if (used > 0) {
          totalThreads += used;
          summary.push(`${target.hostname}(prep:${used}t)`);
          prepWeakenTime = Math.max(prepWeakenTime, target.weakenTime);
        }
      }
    }

    // ──────────────────────────────────────────────
    // Phase 3: Hack income — scan ALL rooted servers
    //   for money + low security. This generates
    //   income while investment targets are prepped.
    //
    //   Excludes targets being prepped/HWGW'd.
    // ──────────────────────────────────────────────
    if (poolFreeRAM(workerServers) >= WORKER_RAM.HACK) {
      const busySet = new Set(targets.map(t => t.hostname));
      const allHostnames = scanNetwork(ns);

      const hackable = [];
      for (const hostname of allHostnames) {
        if (busySet.has(hostname)) continue;
        if (!ns.hasRootAccess(hostname)) continue;

        const maxMoney = ns.getServerMaxMoney(hostname);
        if (maxMoney <= 0) continue;

        const currentMoney = ns.getServerMoneyAvailable(hostname);
        if (currentMoney < maxMoney * 0.1) continue;

        const currentSec = ns.getServerSecurityLevel(hostname);
        const minSec = ns.getServerMinSecurityLevel(hostname);
        if (currentSec > minSec + 5) continue;

        hackable.push({ hostname, currentMoney });
      }
      hackable.sort((a, b) => b.currentMoney - a.currentMoney);

      for (const { hostname, currentMoney } of hackable) {
        if (poolFreeRAM(workerServers) < WORKER_RAM.HACK) break;

        const hackThreads = Math.floor(ns.hackAnalyzeThreads(hostname, currentMoney * 0.5));
        if (hackThreads <= 0 || !isFinite(hackThreads)) continue;

        const hacked = allocateThreads(ns, workerServers, "/src/hack.js", hackThreads, hostname);
        if (hacked > 0) {
          const hackSecIncrease = ns.hackAnalyzeSecurity(hacked, hostname);
          const weakenForHack = Math.ceil(hackSecIncrease / ns.weakenAnalyze(1));
          allocateThreads(ns, workerServers, "/src/weaken.js", weakenForHack, hostname);

          totalThreads += hacked;
          didHackIncome = true;
          summary.push(`${hostname}(${formatMoney(currentMoney * 0.5)})`);
        }
      }
    }

    // ──────────────────────────────────────────────
    // Logging
    // ──────────────────────────────────────────────
    if (totalThreads > 0 || hwgwBlocked) {
      const usedRAM = totalFreeRAM - poolFreeRAM(workerServers);
      const pct = totalFreeRAM > 0 ? ((usedRAM / totalFreeRAM) * 100).toFixed(0) : "0";
      if (hwgwBlocked && totalThreads === 0) {
        log(ns, `HWGW READY: ${preppedTargets.map(t => t.hostname).join(", ")} — waiting for ${formatRAM(totalFreeRAM)} to free up`);
      } else {
        log(ns, `${totalThreads}t -> ${summary.join(", ")} | ${formatRAM(usedRAM)}/${formatRAM(totalFreeRAM)} (${pct}%)`);
      }
    }

    // ──────────────────────────────────────────────
    // Sleep: CRITICAL — match script duration to
    //   prevent RAM stacking.
    //
    //   Old bug: sleeping 5s while scripts run 50s
    //   meant 10 batches stacked before the first
    //   finished → 93%+ RAM consumed by prep → no
    //   room for HWGW or hack income.
    // ──────────────────────────────────────────────
    let sleepTime;
    if (hwgwCompletionTime > 0) {
      // HWGW dispatched — wait for all batches to land
      sleepTime = hwgwCompletionTime + 500;
    } else if (prepWeakenTime > 0) {
      // Prep dispatched — wait for scripts to complete before dispatching more.
      // Cap at 60s so we don't sleep forever on high-tier targets.
      sleepTime = Math.min(prepWeakenTime + 500, 60000);
    } else if (hwgwBlocked) {
      // Prepped target waiting for RAM — check back in 15s
      sleepTime = 15000;
    } else if (didHackIncome) {
      // Only hack income — short cycle to re-hack when money regenerates
      sleepTime = DEFAULTS.managerCycleMs;
    } else {
      sleepTime = DEFAULTS.managerCycleMs;
    }

    await ns.sleep(sleepTime);
  }
}
