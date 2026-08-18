import { test } from "node:test";
import assert from "node:assert/strict";
import { managerStatus, ramVerdict } from "/src/lib/manager-health.js";

// ── managerStatus ───────────────────────────────────────────────────────────

// The daemon relaunch loop parks a script that exits immediately in the `locked`
// state (3 immediate-exits, then ~5 min until RELOCK_RETRY_CYCLES clears it). For a
// one-shot that is the DESIGNED steady state, not a fault, so it must not render as
// the "missing Source File / feature unavailable" symbol a persistent manager uses.
test("managerStatus renders a locked one-shot as IDLE, not LOCKED", () => {
  assert.equal(managerStatus({ exists: true, oneShot: true, locked: true }), "⏱ IDLE");
});

test("managerStatus renders a locked persistent manager as LOCKED", () => {
  assert.equal(managerStatus({ exists: true, oneShot: false, locked: true }), "🔒 LOCKED");
});

test("managerStatus reports a missing script file", () => {
  assert.equal(managerStatus({ exists: false, running: true }), "·");
});

test("managerStatus reports disabled ahead of running", () => {
  assert.equal(managerStatus({ exists: true, disabled: true, running: true }), "⏸ DISABLED");
});

test("managerStatus reports a running manager", () => {
  assert.equal(managerStatus({ exists: true, running: true }), "▶ RUNNING");
});

test("managerStatus reports a stopped manager with its RAM bill", () => {
  assert.equal(managerStatus({ exists: true, ram: 12.5 }), "■ STOPPED (12.5 GB)");
});

// A one-shot mid-burst (launched, exited, not yet locked) is genuinely stopped —
// only the locked steady state is IDLE.
test("managerStatus reports an unlocked one-shot as stopped", () => {
  assert.equal(managerStatus({ exists: true, oneShot: true, ram: 65.8 }), "■ STOPPED (65.8 GB)");
});

// ── ramVerdict ──────────────────────────────────────────────────────────────

test("ramVerdict says ok when the script fits in free RAM", () => {
  assert.equal(ramVerdict({ ram: 20, freeRam: 64, maxRam: 128 }), "ok");
});

// Fits on an empty home but not right now — the daemon will retry and eventually
// succeed, so this is a scheduling problem, not a sizing problem.
test("ramVerdict says blocked when the script fits home but not free RAM", () => {
  assert.equal(ramVerdict({ ram: 100, freeRam: 64, maxRam: 128 }), "blocked");
});

// Larger than home itself: no amount of waiting will launch it. This is what
// silently locks an over-RAM manager forever.
test("ramVerdict says impossible when the script exceeds total home RAM", () => {
  assert.equal(ramVerdict({ ram: 400, freeRam: 64, maxRam: 128 }), "impossible");
});

test("ramVerdict treats an exact fit as ok", () => {
  assert.equal(ramVerdict({ ram: 64, freeRam: 64, maxRam: 128 }), "ok");
});

// ns.getScriptRam() returns 0 for a file it cannot parse; daemon.js:8 already
// treats that as Infinity. Surface it rather than reporting a 0 GB script as "ok".
test("ramVerdict flags an unparseable script (0 GB) as unknown", () => {
  assert.equal(ramVerdict({ ram: 0, freeRam: 64, maxRam: 128 }), "unknown");
});
