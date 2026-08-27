import { WORKER_RAM, DEFAULTS } from "/src/lib/constants.js";

/** @param {NS} ns */
export function calculatePrepThreads(ns, target) {
  const hostname = target.hostname;
  const currentSecurity = ns.getServerSecurityLevel(hostname);
  const minSecurity = ns.getServerMinSecurityLevel(hostname);
  const currentMoney = ns.getServerMoneyAvailable(hostname);
  const maxMoney = ns.getServerMaxMoney(hostname);

  const securityDiff = currentSecurity - minSecurity;
  const weakenThreads = Math.ceil(securityDiff / ns.weakenAnalyze(1));

  let growThreads = 0;
  if (currentMoney < maxMoney && currentMoney > 0) {
    const growthNeeded = maxMoney / currentMoney;
    growThreads = Math.ceil(ns.growthAnalyze(hostname, growthNeeded));
  } else if (currentMoney === 0) {
    growThreads = Math.ceil(ns.growthAnalyze(hostname, maxMoney));
  }

  const growSecurityIncrease = ns.growthAnalyzeSecurity(growThreads, hostname);
  const weakenAfterGrowThreads = Math.ceil(growSecurityIncrease / ns.weakenAnalyze(1));

  return {
    weakenThreads,
    growThreads,
    weakenAfterGrowThreads,
    totalRAM:
      weakenThreads * WORKER_RAM.WEAKEN +
      growThreads * WORKER_RAM.GROW +
      weakenAfterGrowThreads * WORKER_RAM.WEAKEN,
  };
}

/** @param {NS} ns */
export function calculateBatch(ns, hostname, hackPercent = DEFAULTS.hackPercent, spacing = DEFAULTS.batchSpacingMs) {
  const maxMoney = ns.getServerMaxMoney(hostname);
  const hackThreads = Math.max(1, Math.floor(ns.hackAnalyzeThreads(hostname, maxMoney * hackPercent)));

  const hackSecurityIncrease = ns.hackAnalyzeSecurity(hackThreads, hostname);
  const weakenAfterHackThreads = Math.ceil(hackSecurityIncrease / ns.weakenAnalyze(1));

  const moneyAfterHack = maxMoney * (1 - hackPercent);
  const growthNeeded = moneyAfterHack > 0 ? maxMoney / moneyAfterHack : 100;
  const growThreads = Math.ceil(ns.growthAnalyze(hostname, growthNeeded));

  const growSecurityIncrease = ns.growthAnalyzeSecurity(growThreads, hostname);
  const weakenAfterGrowThreads = Math.ceil(growSecurityIncrease / ns.weakenAnalyze(1));

  const hackTime = ns.getHackTime(hostname);
  const growTime = ns.getGrowTime(hostname);
  const weakenTime = ns.getWeakenTime(hostname);

  // HWGW landing order must be hack → weaken1 → grow → weaken2, each separated
  // by `spacing`. Landing time = delay + opTime, so we solve for each delay:
  //   hack lands at   weakenTime - spacing
  //   weaken1 lands at weakenTime
  //   grow lands at    weakenTime + spacing
  //   weaken2 lands at weakenTime + 2*spacing
  // weaken2 MUST land after grow so it cancels grow's security increase.
  const timings = {
    // Clamp to >=0: workers treat delay<=0 as "no sleep", so a negative delay (possible if an
    // op's time is unusually close to weakenTime) would otherwise land at the wrong moment.
    hackDelay: Math.max(0, weakenTime - hackTime - spacing),
    weaken1Delay: 0,
    growDelay: Math.max(0, weakenTime - growTime + spacing),
    weaken2Delay: spacing * 2,
  };

  const totalThreads = hackThreads + weakenAfterHackThreads + growThreads + weakenAfterGrowThreads;
  const totalRAM =
    hackThreads * WORKER_RAM.HACK +
    weakenAfterHackThreads * WORKER_RAM.WEAKEN +
    growThreads * WORKER_RAM.GROW +
    weakenAfterGrowThreads * WORKER_RAM.WEAKEN;

  const batchDuration = weakenTime + spacing * 3;

  return {
    hackThreads,
    weakenAfterHackThreads,
    growThreads,
    weakenAfterGrowThreads,
    totalThreads,
    totalRAM,
    timings,
    hackTime,
    growTime,
    weakenTime,
    batchDuration,
  };
}

/** @param {NS} ns */
export function isServerPrepped(ns, hostname) {
  const currentSecurity = ns.getServerSecurityLevel(hostname);
  const minSecurity = ns.getServerMinSecurityLevel(hostname);
  const currentMoney = ns.getServerMoneyAvailable(hostname);
  const maxMoney = ns.getServerMaxMoney(hostname);

  return currentSecurity <= minSecurity + 0.05 && currentMoney >= maxMoney * 0.99;
}

export function maxBatches(availableRAM, batchRAM) {
  return Math.floor(availableRAM / batchRAM);
}

// How many HWGW batches to dispatch for one target in a single cycle.
//
// Batches start every `spacing * 4` ms (one full hack→weaken→grow→weaken landing sequence is
// 4 * spacing wide), and each batch lives ~batchDuration. So `batchDuration / stride` batches are
// in flight once the pipeline is full — call that one "wave". Dispatching `waves` of them pushes the
// per-cycle income toward its ceiling (one batch's steal per stride): income/sec rises with depth
// but the cycle lengthens too, so `waves` trades responsiveness for throughput. `maxBatches` caps
// the result so a slow high-tier target can't stretch a single cycle into many minutes.
export function hwgwBatchDepth(
  batchDuration,
  waves = DEFAULTS.hwgwBatchWaves,
  maxBatchesPerTarget = DEFAULTS.hwgwMaxBatches,
  spacing = DEFAULTS.batchSpacingMs
) {
  const stride = spacing * 4;
  const pipelineDepth = Math.max(1, Math.ceil(batchDuration / stride));
  return Math.min(maxBatchesPerTarget, pipelineDepth * Math.max(1, waves));
}

// Size an HWGW batch to the RAM you actually have.
//
// calculateBatch's grow leg costs ln(1 / (1 - hackPercent)) threads — superlinear in the steal
// fraction — so on a high-money, LOW-GROWTH server a single 70% batch can need more RAM than the
// entire botnet owns. runHWGWBatch refuses to dispatch a batch it can't fund in full, so that
// target then dispatches NOTHING, forever: it is already prepped (so prep skips it) and it sits in
// the top-N target list (so the hack-income phase skips it too). The coordinator idles with a full
// pool. That is the "HWGW READY ... waiting for N TB to free up" stall.
//
// The fix is to stop treating hackPercent as a constant. RAM per unit of money stolen is
// ln(1 / (1 - p)) / p, which is *lowest* at small p — so a smaller steal is not just the fallback,
// it's the more RAM-efficient trade. Binary-search the largest p in [minPct, maxPct] whose batch
// fits in availableRAM. Monotonicity of totalRAM in p (asserted in the tests) is what makes the
// search valid.
//
// Returns { batch, hackPercent }, or null when even minPct doesn't fit — the caller needs that
// distinction: "too poor for even the smallest batch" means fall through to prep/hack-income,
// not sit and wait.
/** @param {NS} ns */
export function fitBatchToRAM(
  ns,
  hostname,
  availableRAM,
  maxPct = DEFAULTS.hackPercent,
  minPct = DEFAULTS.hwgwMinHackPercent,
  spacing = DEFAULTS.batchSpacingMs
) {
  if (!(availableRAM > 0)) return null;

  const hi0 = Math.min(0.99, Math.max(0.001, maxPct));
  const lo0 = Math.min(hi0, Math.max(0.001, minPct));

  const full = calculateBatch(ns, hostname, hi0, spacing);
  if (full.totalRAM <= availableRAM) return { batch: full, hackPercent: hi0 };

  const floor = calculateBatch(ns, hostname, lo0, spacing);
  if (floor.totalRAM > availableRAM) return null;

  // 14 halvings resolve the percent to ~0.004% — far finer than thread rounding.
  let lo = lo0;
  let hi = hi0;
  let best = { batch: floor, hackPercent: lo0 };
  for (let i = 0; i < 14; i++) {
    const mid = (lo + hi) / 2;
    const batch = calculateBatch(ns, hostname, mid, spacing);
    if (batch.totalRAM <= availableRAM) {
      best = { batch, hackPercent: mid };
      lo = mid;
    } else {
      hi = mid;
    }
  }
  return best;
}
