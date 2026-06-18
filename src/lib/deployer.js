// @ts-check
import { WORKER_SCRIPTS } from "/src/lib/constants.js";

// Single source of truth for getting the worker scripts (hack/grow/weaken) onto a host so the
// coordinator can ns.exec them there. This scp was previously copy-pasted across rooter,
// server-buyer, deploy, nuke-all, and the coordinator — and it drifted (nuke-all forgot it
// entirely, which left the hosts it rooted idle). Route every deployer through here instead.

/**
 * Copy the worker scripts from home onto `host` (unconditional).
 * @param {NS} ns
 */
export function deployWorkers(ns, host) {
  ns.scp(WORKER_SCRIPTS, host, "home");
}

/**
 * Copy the workers only if they're missing — idempotent, self-healing, restart-safe.
 * @param {NS} ns
 */
export function ensureWorkers(ns, host) {
  if (!ns.fileExists(WORKER_SCRIPTS[0], host)) ns.scp(WORKER_SCRIPTS, host, "home");
}
