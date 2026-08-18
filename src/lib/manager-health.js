// Daemon dashboard vocabulary, kept pure so the status rules are testable without ns.
//
// The daemon's relaunch loop (daemon.js) parks any script that exits immediately in the
// `locked` state: three immediate-exits in a row trip the lock, then RELOCK_RETRY_CYCLES
// clears it ~5 minutes later and the burst repeats. For a persistent manager that means
// "missing Source File / feature unavailable". For a one-shot — a script whose whole job
// is to run, act, and exit — it is the designed steady state, so it gets its own symbol.
// Without the split, LOCKED would mean both "working as intended" and "broken", and any
// alarm built on it would fire on healthy one-shots every five minutes.

/**
 * Dashboard label for one manager.
 * @param {{exists?: boolean, disabled?: boolean, running?: boolean,
 *   locked?: boolean, oneShot?: boolean, ram?: number}} state
 * @returns {string}
 */
export function managerStatus({ exists, disabled, running, locked, oneShot, ram }) {
  if (!exists) return "·";
  if (disabled) return "⏸ DISABLED";
  if (running) return "▶ RUNNING";
  if (locked) return oneShot ? "⏱ IDLE" : "🔒 LOCKED";
  return `■ STOPPED (${Number(ram).toFixed(1)} GB)`;
}

/**
 * Can this script ever launch, and can it launch right now?
 *
 * `impossible` is the one that matters: a script larger than home itself never runs, and
 * the daemon's only symptom is a permanent lock — indistinguishable from a missing
 * Source File. `ns.getScriptRam()` returns 0 for a file it cannot parse (daemon.js treats
 * that as Infinity), so 0 is reported as unknown rather than as a free lunch.
 *
 * @param {{ram: number, freeRam: number, maxRam: number}} budget
 * @returns {"ok" | "blocked" | "impossible" | "unknown"}
 */
export function ramVerdict({ ram, freeRam, maxRam }) {
  if (!(ram > 0)) return "unknown";
  if (ram > maxRam) return "impossible";
  if (ram > freeRam) return "blocked";
  return "ok";
}
