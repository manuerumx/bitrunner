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
export function calculateBatch(ns, hostname, hackPercent = DEFAULTS.hackPercent) {
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
  const spacing = DEFAULTS.batchSpacingMs;

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
