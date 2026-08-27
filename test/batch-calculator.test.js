import { test } from "node:test";
import assert from "node:assert/strict";
import {
  calculateBatch,
  calculatePrepThreads,
  isServerPrepped,
  maxBatches,
  hwgwBatchDepth,
  fitBatchToRAM,
} from "/src/lib/batch-calculator.js";

// Minimal deterministic stand-in for the parts of `ns` these functions touch.
function makeNs(overrides = {}) {
  return {
    getServerSecurityLevel: () => 10,
    getServerMinSecurityLevel: () => 10,
    getServerMoneyAvailable: () => 1_000_000,
    getServerMaxMoney: () => 1_000_000,
    weakenAnalyze: (threads) => 0.05 * threads, // 1 thread removes 0.05 security
    growthAnalyze: () => 100,
    growthAnalyzeSecurity: () => 4, // -> 80 weaken threads after grow at 0.05 each
    hackAnalyzeThreads: () => 50,
    hackAnalyzeSecurity: () => 1, // -> 20 weaken threads after hack
    getHackTime: () => 250,
    getGrowTime: () => 800,
    getWeakenTime: () => 1000,
    ...overrides,
  };
}

test("maxBatches floors the division", () => {
  assert.equal(maxBatches(100, 30), 3);
  assert.equal(maxBatches(90, 30), 3);
  assert.equal(maxBatches(29, 30), 0);
});

test("isServerPrepped requires min security and ~full money", () => {
  assert.equal(isServerPrepped(makeNs(), "x"), true);
  assert.equal(
    isServerPrepped(makeNs({ getServerSecurityLevel: () => 20 }), "x"),
    false
  );
  assert.equal(
    isServerPrepped(makeNs({ getServerMoneyAvailable: () => 500_000 }), "x"),
    false
  );
  // Within tolerance: 0.04 above min and 99% money still counts as prepped.
  assert.equal(
    isServerPrepped(
      makeNs({ getServerSecurityLevel: () => 10.04, getServerMoneyAvailable: () => 990_000 }),
      "x"
    ),
    true
  );
});

test("calculateBatch produces HWGW timings that land in order", () => {
  const b = calculateBatch(makeNs(), "x", 0.7);

  // Thread math from the mock.
  assert.equal(b.hackThreads, 50);
  assert.equal(b.weakenAfterHackThreads, 20); // 1 / 0.05
  assert.equal(b.weakenAfterGrowThreads, 80); // 4 / 0.05

  // Landing order: hack < weaken1 < grow < weaken2, each separated by spacing (200ms).
  const land = {
    hack: b.timings.hackDelay + b.hackTime,
    weaken1: b.timings.weaken1Delay + b.weakenTime,
    grow: b.timings.growDelay + b.growTime,
    weaken2: b.timings.weaken2Delay + b.weakenTime,
  };
  assert.ok(land.hack < land.weaken1, "hack lands before weaken1");
  assert.ok(land.weaken1 < land.grow, "weaken1 lands before grow");
  assert.ok(land.grow < land.weaken2, "grow lands before weaken2");
  assert.equal(land.weaken1, 1000);
  assert.equal(land.weaken2 - land.weaken1, 400); // 2 * spacing

  // totalRAM is the sum of each op's threads * per-thread RAM.
  const expectedRAM =
    b.hackThreads * 1.7 +
    b.weakenAfterHackThreads * 1.75 +
    b.growThreads * 1.75 +
    b.weakenAfterGrowThreads * 1.75;
  assert.ok(Math.abs(b.totalRAM - expectedRAM) < 1e-9);
});

test("hwgwBatchDepth scales depth with batch duration and waves", () => {
  // stride = spacing * 4 = 800ms. One "wave" = ceil(batchDuration / stride).
  // Fast target (1600ms): pipelineDepth = 2 -> 4 waves = 8 batches.
  assert.equal(hwgwBatchDepth(1600, 4, 500, 200), 8);
  // Slow high-tier target (80s): pipelineDepth = 100 -> 4 waves = 400 batches.
  assert.equal(hwgwBatchDepth(80000, 4, 500, 200), 400);
  // maxBatches caps the depth so one cycle can't run for many minutes.
  assert.equal(hwgwBatchDepth(80000, 10, 500, 200), 500);
  // Depth and waves both floor at 1 (a target always gets at least one batch).
  assert.equal(hwgwBatchDepth(100, 4, 500, 200), 4); // pipelineDepth floored to 1
  assert.equal(hwgwBatchDepth(1600, 0, 500, 200), 2); // waves floored to 1
});

test("calculatePrepThreads weakens an un-prepped server toward min", () => {
  const ns = makeNs({
    getServerSecurityLevel: () => 15, // 5 above min
    getServerMinSecurityLevel: () => 10,
    getServerMoneyAvailable: () => 1_000_000, // already maxed -> no grow needed
    getServerMaxMoney: () => 1_000_000,
  });
  const p = calculatePrepThreads(ns, { hostname: "x" });
  assert.equal(p.weakenThreads, 100); // 5 / 0.05
  assert.equal(p.growThreads, 0);
});

// --- fitBatchToRAM ---
//
// The mock above is deliberately insensitive to hackPercent (fixed thread counts), which
// would make a "shrinks until it fits" assertion pass for the wrong reason. This one scales
// the way the game does: grow threads with ln(1 / (1 - p)), hack threads linearly with p.
function makeScalingNs(overrides = {}) {
  return makeNs({
    getServerMaxMoney: () => 1e9,
    getServerMoneyAvailable: () => 1e9,
    // 1 grow thread multiplies money by e^1e-4, so threads = ln(mult) / 1e-4.
    growthAnalyze: (_h, mult) => Math.log(mult) / 1e-4,
    growthAnalyzeSecurity: (threads) => 0.004 * threads,
    // 1 hack thread steals $1e7 from a $1e9 server (1%).
    hackAnalyzeThreads: (_h, amount) => amount / 1e7,
    hackAnalyzeSecurity: (threads) => 0.002 * threads,
    ...overrides,
  });
}

test("batch RAM rises monotonically with hackPercent (fitBatchToRAM's precondition)", () => {
  const ns = makeScalingNs();
  let prev = 0;
  for (const p of [0.01, 0.05, 0.1, 0.25, 0.5, 0.7, 0.9]) {
    const ram = calculateBatch(ns, "x", p).totalRAM;
    assert.ok(ram > prev, `RAM at ${p} (${ram}) should exceed RAM at the previous step (${prev})`);
    prev = ram;
  }
});

test("fitBatchToRAM keeps the full hackPercent when RAM is plentiful", () => {
  const ns = makeScalingNs();
  const full = calculateBatch(ns, "x", 0.7);
  const fit = fitBatchToRAM(ns, "x", full.totalRAM * 4, 0.7, 0.01);
  assert.equal(fit.hackPercent, 0.7);
  assert.equal(fit.batch.totalRAM, full.totalRAM);
});

test("fitBatchToRAM shrinks hackPercent so the batch fits the pool", () => {
  const ns = makeScalingNs();
  // A 70% batch needs ~22 TB here; the pool has 5 TB — the real the-hub deadlock.
  const pool = 5000;
  assert.ok(calculateBatch(ns, "x", 0.7).totalRAM > pool);

  const fit = fitBatchToRAM(ns, "x", pool, 0.7, 0.01);
  assert.notEqual(fit, null);
  assert.ok(fit.hackPercent < 0.7);
  assert.ok(fit.batch.totalRAM <= pool, `batch (${fit.batch.totalRAM}) must fit in ${pool}`);
  // It must not shrink further than necessary: the fitted batch uses most of the pool,
  // and one notch up would overflow it.
  assert.ok(fit.batch.totalRAM > pool * 0.9);
  assert.ok(calculateBatch(ns, "x", fit.hackPercent * 1.2).totalRAM > pool);
});

test("fitBatchToRAM returns null when even the minimum steal cannot fit", () => {
  const ns = makeScalingNs();
  const floor = calculateBatch(ns, "x", 0.01).totalRAM;
  assert.equal(fitBatchToRAM(ns, "x", floor - 1, 0.7, 0.01), null);
  assert.equal(fitBatchToRAM(ns, "x", 0, 0.7, 0.01), null);
  assert.equal(fitBatchToRAM(ns, "x", -5, 0.7, 0.01), null);
});

test("fitBatchToRAM never returns a batch above the requested ceiling", () => {
  const ns = makeScalingNs();
  const fit = fitBatchToRAM(ns, "x", 1e9, 0.25, 0.01);
  assert.equal(fit.hackPercent, 0.25);
});
