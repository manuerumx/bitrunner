import { scanNetwork } from "/src/lib/scanner.js";
import { selectTargets, selectXPTarget } from "/src/lib/target-selector.js";
import { WORKER_RAM, DEFAULTS, PORTS } from "/src/lib/constants.js";
import { deployWorkers } from "/src/lib/deployer.js";
import { readPortData } from "/src/lib/port-registry.js";
import { getConfig } from "/src/lib/config.js";
import { calculateBatch, isServerPrepped, hwgwBatchDepth, fitBatchToRAM } from "/src/lib/batch-calculator.js";
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

  // Spread work across the WHOLE botnet instead of packing the biggest hosts first.
  // Small rooted network servers are drained first; home is forced to the very end so it is
  // used only as last-resort overflow (home is the most contended host — every manager runs
  // there — and carries the reservedHomeRAM block).
  //
  // This is the fix for "workers only ever run on home + purchased servers": the old
  // descending sort let home + the large purchased servers absorb every per-operation
  // allocation before allocateThreads ever reached the small servers. Bitburner imposes no
  // co-location requirement (one op's threads can be split across many hosts and still land
  // correctly), so spreading is free — it just makes the small servers actually carry load.
  servers.sort((a, b) => {
    if (a.hostname === "home") return 1;
    if (b.hostname === "home") return -1;
    return a.freeRAM - b.freeRAM;
  });
  return servers;
}

function poolFreeRAM(workerServers) {
  return workerServers.reduce((sum, s) => sum + s.freeRAM, 0);
}

// Total RAM the botnet could EVER give us, ignoring what's busy right now. Used only to tell a
// transient shortage ("everything is running prep, wait for it") apart from a permanent one
// ("this target's smallest batch is bigger than the whole botnet"). Those need opposite
// responses, and conflating them is what let one target stall the whole coordinator.
function poolCapacityRAM(ns) {
  let total = Math.max(0, ns.getServerMaxRam("home") - DEFAULTS.reservedHomeRAM);
  for (const hostname of scanNetwork(ns)) {
    if (!ns.hasRootAccess(hostname)) continue;
    total += ns.getServerMaxRam(hostname);
  }
  return total;
}

function execWorker(ns, script, host, threads, target, delay = 0) {
  if (threads <= 0) return 0;
  let pid = ns.exec(script, host, threads, target, delay);
  if (pid === 0 && host !== "home") {
    // exec returned 0: most often the worker file isn't on this host yet (the rooter hasn't
    // reached it, or it was rooted by nuke-all/another tool). Don't depend on the rooter —
    // deploy the workers ourselves and retry once. This closes the fresh-start race where the
    // coordinator (5s cycle) runs before the rooter (30s cycle) has scp'd a newly-rooted host.
    deployWorkers(ns, host);
    pid = ns.exec(script, host, threads, target, delay);
  }
  if (pid === 0) {
    // Still failed → genuine RAM contention (e.g. home, where managers also run). Surface it
    // instead of silently dropping the threads, which is what hid dead hosts before.
    log(ns, `exec failed: ${script} x${threads} on ${host} (RAM contended or undeployable)`);
    return 0;
  }
  return threads;
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

// Dispatch one batch of a PRE-SIZED shape. The steal fraction is chosen once per target by
// fitBatchToRAM (see Phase 1) rather than re-derived here, so every batch in a target's pipeline is
// identical and depthCap is computed for the batch we actually send.
//
// Leg order is grow/weaken FIRST, hack LAST, deliberately. Each worker carries its own delay, so
// exec order has no effect on landing order — which makes the order free to spend on failure
// handling. If the pool runs dry mid-batch, the leg we want to lose is the hack: a hack that lands
// without its matching grow drains the target below max money and de-preps it, and on a low-growth
// server re-prepping costs far more than the steal was worth. Coming up short on grow/weaken just
// over-restores a server that's already full, which is harmless.
function runHWGWBatch(ns, hostname, workerServers, batchId, batch, spacing) {
  if (poolFreeRAM(workerServers) < batch.totalRAM) {
    return { dispatched: false, starved: false, threads: 0 };
  }

  const offset = batchId * spacing * 4;

  const w1 = allocateThreads(ns, workerServers, "/src/weaken.js", batch.weakenAfterHackThreads, hostname, batch.timings.weaken1Delay + offset);
  const g = allocateThreads(ns, workerServers, "/src/grow.js", batch.growThreads, hostname, batch.timings.growDelay + offset);
  const w2 = allocateThreads(ns, workerServers, "/src/weaken.js", batch.weakenAfterGrowThreads, hostname, batch.timings.weaken2Delay + offset);
  const h = allocateThreads(ns, workerServers, "/src/hack.js", batch.hackThreads, hostname, batch.timings.hackDelay + offset);

  // A batch only counts as dispatched when EVERY leg got its full thread count. Partial batches
  // used to count (the old check was an OR over the four legs), which quietly let a hack land
  // without its grow.
  const complete =
    h === batch.hackThreads &&
    w1 === batch.weakenAfterHackThreads &&
    g === batch.growThreads &&
    w2 === batch.weakenAfterGrowThreads;

  return { dispatched: complete, starved: !complete, threads: h + w1 + g + w2 };
}

// --- MAIN LOOP ---

/** @param {NS} ns */
export async function main(ns) {
  ns.disableLog("ALL");

  while (true) {
    const cfg = getConfig(ns);

    // Reclaim RAM held by the previous cycle's share() fillers (they loop forever) so the
    // income phases get first claim on the whole botnet again before we re-fill with share.
    // share.js and xp.js both loop forever to soak surplus RAM (Phase 4); reclaim both so the
    // income phases get first claim on the whole botnet again before we re-fill.
    for (const h of ["home", ...scanNetwork(ns)]) {
      if (!ns.hasRootAccess(h)) continue;
      ns.scriptKill("/src/share.js", h);
      ns.scriptKill("/src/xp.js", h);
    }

    const workerServers = getAllWorkerServers(ns);
    const totalFreeRAM = poolFreeRAM(workerServers);

    if (totalFreeRAM < WORKER_RAM.WEAKEN) {
      log(ns, "No free RAM. Waiting for scripts to finish...");
      await ns.sleep(DEFAULTS.managerCycleMs);
      continue;
    }

    // Select investment targets (top by maxMoney potential)
    // Scale targets with the pool, capped at 10 — more parallel income streams (and more of
    // the botnet working) when RAM is plentiful.
    const targetCount = Math.max(3, Math.min(10, Math.floor(totalFreeRAM / 256)));
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
    //
    //   cfg.hackPercent is a CEILING, not a fixed
    //   steal. fitBatchToRAM picks the largest steal
    //   whose batch actually fits the pool — without
    //   that, a high-money low-growth target (whose
    //   70% batch needs more RAM than the botnet
    //   owns) dispatches nothing at all, forever.
    // ──────────────────────────────────────────────
    const blocked = [];    // prepped, starved right now — the pool is busy, waiting helps
    const infeasible = []; // prepped, but no batch fits the botnet at all — waiting NEVER helps
    let capacityRAM = -1;  // lazily computed; only the failure path needs it

    for (const target of preppedTargets) {
      const freeNow = poolFreeRAM(workerServers);

      // Size to a share of the pool rather than all of it, so one target leaves room for a short
      // pipeline and for the other prepped targets. RAM per dollar stolen is ln(1/(1-p))/p, which
      // is lowest at small p, so several small batches out-earn one maximal batch on the same RAM.
      // Fall back to the whole free pool when that share is too small for even the minimum steal.
      const share = freeNow / Math.max(1, cfg.hwgwFitBatches);
      let fit = fitBatchToRAM(ns, target.hostname, share, cfg.hackPercent, cfg.hwgwMinHackPercent, cfg.batchSpacingMs);
      if (!fit) {
        fit = fitBatchToRAM(ns, target.hostname, freeNow, cfg.hackPercent, cfg.hwgwMinHackPercent, cfg.batchSpacingMs);
      }

      if (!fit) {
        // Nothing fits in the free pool. WHY matters: a busy botnet will free up and prep would
        // only make it worse, but a botnet that's simply too small for this target never frees up
        // — treating the second case like the first is what left the coordinator idling on a full
        // pool with "HWGW READY ... waiting for 5.0 TB".
        if (capacityRAM < 0) capacityRAM = poolCapacityRAM(ns);
        const smallest = calculateBatch(ns, target.hostname, cfg.hwgwMinHackPercent, cfg.batchSpacingMs);
        const entry = { hostname: target.hostname, needRAM: smallest.totalRAM, freeRAM: freeNow };
        if (smallest.totalRAM <= capacityRAM) blocked.push(entry);
        else infeasible.push(entry);
        continue;
      }

      // Self-size the pipeline to this target's batch timing instead of a flat 100. Slow high-tier
      // targets get a deeper pipeline (the long weakenTime needs more batches to stay full); fast
      // targets get a shallower one (and a shorter, more responsive cycle). RAM is still the hard
      // limiter below — depthCap only bounds how far we *try* to go this cycle.
      const depthCap = hwgwBatchDepth(fit.batch.batchDuration, cfg.hwgwBatchWaves, cfg.hwgwMaxBatches, cfg.batchSpacingMs);

      let batchCount = 0;
      let starved = false;
      for (let i = 0; i < depthCap; i++) {
        const result = runHWGWBatch(ns, target.hostname, workerServers, i, fit.batch, cfg.batchSpacingMs);
        totalThreads += result.threads;
        if (result.starved) starved = true;
        if (!result.dispatched) break;
        batchCount++;
      }

      if (starved) {
        log(ns, `partial HWGW batch on ${target.hostname} — pool ran dry mid-batch (hack leg dropped first)`);
      }

      if (batchCount > 0) {
        const pct = (fit.hackPercent * 100).toFixed(fit.hackPercent < 0.1 ? 1 : 0);
        summary.push(`${target.hostname}(${batchCount}×HWGW@${pct}%)`);
        const lastOffset = (batchCount - 1) * cfg.batchSpacingMs * 4;
        hwgwCompletionTime = Math.max(hwgwCompletionTime, lastOffset + fit.batch.batchDuration);
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
    // Only a TRANSIENT shortage suppresses prep — a prepped target will get its RAM back when the
    // running scripts land, and piling on more prep would delay that. An infeasible target must not
    // suppress anything: its batch will never fit, so blocking prep on it stalls the suite outright.
    const hwgwBlocked = blocked.length > 0;

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
    // Phase 4: Soak ALL leftover RAM. HWGW against a
    //   handful of targets can't consume a large
    //   botnet, so this is what keeps the surplus
    //   productive. Two mutually-exclusive uses:
    //
    //   xpFarmRAM (toggle: tools/xp-farm.js) → hacking
    //     EXP via xp.js weaken-spam on the best EXP/sec
    //     target. Use this when levelling is the goal.
    //
    //   else share() → faction reputation, but ONLY
    //     while actively grinding a faction (share does
    //     nothing otherwise). shareIdleRAM forces it on.
    //
    //   xpFarmRAM WINS when both could apply: share()
    //   earns ZERO hacking EXP, so it's the thing that
    //   stalls levelling on a big botnet.
    //
    //   We read faction-manager's status port instead
    //   of calling Singularity here (keeps this hot
    //   manager's RAM low). Both workers loop forever,
    //   so they're killed at the top of each cycle and
    //   re-filled here on whatever the income phases
    //   left free.
    // ──────────────────────────────────────────────
    let shareThreads = 0;
    let xpThreads = 0;
    if (cfg.xpFarmRAM) {
      const xpTarget = selectXPTarget(ns);
      if (xpTarget) {
        const xpRam = ns.getScriptRam("/src/xp.js") || WORKER_RAM.GROW;
        for (const server of workerServers) {
          if (server.freeRAM < xpRam) continue;
          if (!ns.fileExists("/src/xp.js", server.hostname)) deployWorkers(ns, server.hostname);
          const threads = Math.floor(server.freeRAM / xpRam);
          if (threads <= 0) continue;
          const pid = ns.exec("/src/xp.js", server.hostname, threads, xpTarget.hostname);
          if (pid > 0) {
            server.freeRAM -= threads * xpRam;
            xpThreads += threads;
          }
        }
        if (xpThreads > 0) summary.push(`xp:${xpThreads}t->${xpTarget.hostname}`);
      }
    } else {
      const factionStatus = /** @type {FactionStatus | null} */ (readPortData(ns, PORTS.FACTION_STATUS));
      const grindingFaction = !!(factionStatus && factionStatus.currentFaction && factionStatus.rep < factionStatus.targetRep);
      // shareIdleRAM (config override, toggle with tools/share-idle.js) forces share() to soak
      // surplus RAM even when the (possibly locked) faction-manager reports no active grind.
      const shareIdle = cfg.shareIdleRAM;
      if (grindingFaction || shareIdle) {
        const shareRam = ns.getScriptRam("/src/share.js") || WORKER_RAM.WEAKEN;
        for (const server of workerServers) {
          if (server.freeRAM < shareRam) continue;
          if (!ns.fileExists("/src/share.js", server.hostname)) deployWorkers(ns, server.hostname);
          const threads = Math.floor(server.freeRAM / shareRam);
          if (threads <= 0) continue;
          const pid = ns.exec("/src/share.js", server.hostname, threads);
          if (pid > 0) {
            server.freeRAM -= threads * shareRam;
            shareThreads += threads;
          }
        }
        if (shareThreads > 0) summary.push(`share:${shareThreads}t`);
      }
    }

    // ──────────────────────────────────────────────
    // Logging
    // ──────────────────────────────────────────────
    if (totalThreads > 0 || shareThreads > 0 || xpThreads > 0) {
      const usedRAM = totalFreeRAM - poolFreeRAM(workerServers);
      const pct = totalFreeRAM > 0 ? ((usedRAM / totalFreeRAM) * 100).toFixed(0) : "0";
      log(ns, `${totalThreads}t -> ${summary.join(", ")} | ${formatRAM(usedRAM)}/${formatRAM(totalFreeRAM)} (${pct}%)`);
    }
    // Report what a batch NEEDS against what's there. The old line printed the free pool as if it
    // were the requirement ("waiting for 5.0 TB to free up" while 5.0 TB sat free), which made a
    // permanent stall look like ordinary contention.
    for (const b of blocked) {
      log(ns, `HWGW WAITING: ${b.hostname} — smallest batch needs ${formatRAM(b.needRAM)}, only ${formatRAM(b.freeRAM)} free; waiting on running scripts`);
    }
    for (const b of infeasible) {
      log(ns, `HWGW INFEASIBLE: ${b.hostname} — smallest batch needs ${formatRAM(b.needRAM)} but the whole botnet is ${formatRAM(capacityRAM)}; prepping/hacking instead (buy RAM, or lower hwgwMinHackPercent)`);
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

    // If only the surplus-soak workers (share/xp) ran this cycle, sleep longer so we don't churn
    // kill+redispatch every few seconds (they keep running during the sleep regardless).
    if ((shareThreads > 0 || xpThreads > 0) && hwgwCompletionTime === 0 && prepWeakenTime === 0) {
      sleepTime = Math.max(sleepTime, 30000);
    }

    await ns.sleep(sleepTime);
  }
}
