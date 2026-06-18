import { test } from "node:test";
import assert from "node:assert/strict";
import {
  calculateBatch,
  calculatePrepThreads,
  isServerPrepped,
  maxBatches,
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
