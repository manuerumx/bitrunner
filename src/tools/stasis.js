import { consumePortData, PORTS } from "/src/lib/port-registry.js";
import { formatRAM, tlog } from "/src/lib/utils.js";
import {
  getStasisCandidates,
  loadPasswords,
  savePassword,
  planStasisLinks,
  PASSWORD_FILE,
  STASIS_WORKER_RAM,
} from "/src/lib/darknet.js";

// Manage darknet stasis links (ns.dnet). A stasis link pins a darknet server so it can't
// move or go offline when the net mutates, and doubles as a permanent exec route to it.
// Links are globally capped; the planner in lib/darknet.js decides who deserves a slot.
//
//   run /src/tools/stasis.js                      status: links, limit, candidates
//   run /src/tools/stasis.js auto                 fill every free slot with the best candidates
//   run /src/tools/stasis.js link <host> [pw]     link one server (pw saved to the store on success)
//   run /src/tools/stasis.js unlink <host>        remove a link (frees a global slot)
//
// Passwords live in /data/darknet-passwords.txt (host → password JSON); sessions are
// per-PID so this script re-authenticates from the store on every run.

const WORKER = "/src/tools/stasis-worker.js";
// The worker's import chain must exist on the target for the game to resolve it.
const WORKER_FILES = [WORKER, "/src/lib/port-registry.js", "/src/lib/constants.js"];
const RESULT_TIMEOUT_MS = 60000;

// Human hints for the planner's machine-readable skip reasons.
const REASON_HINTS = {
  linked: "already linked",
  offline: "offline (possibly permanently)",
  stationary: "stationary story server — can't move, link would be wasted",
  "no-password": "no stored password — run: stasis.js link <host> <password>",
  "no-exec-route": "needs a direct connection, backdoor, or existing link to exec",
  "blocked-ram": "worker would fit if owner RAM were freed via dnet.memoryReallocation()",
  "no-ram": `needs ${formatRAM(STASIS_WORKER_RAM)} free on the target`,
  "no-slot": "no free stasis slot (raise the limit with deep-darknet augments)",
};

/**
 * Authenticate, push the worker to the target, and wait for its verdict.
 * @param {NS} ns
 * @param {string} host
 * @param {"link" | "unlink"} mode
 * @param {string} password
 * @returns {Promise<"ok" | "no-session" | "no-exec" | "failed" | "timeout">}
 */
async function applyLink(ns, host, mode, password) {
  const session = ns.dnet.connectToSession(host, password);
  if (!session.success) {
    tlog(ns, `✗ ${host}: session failed — ${session.message} (code ${session.code})`);
    return "no-session";
  }

  if (!ns.scp(WORKER_FILES, host, "home")) {
    tlog(ns, `✗ ${host}: couldn't copy the stasis worker over`);
    return "no-exec";
  }
  const pid = ns.exec(WORKER, host, 1, mode, host);
  if (pid === 0) {
    tlog(
      ns,
      `✗ ${host}: exec refused — needs ${formatRAM(STASIS_WORKER_RAM)} free RAM there and ` +
        `an exec route (direct connection, backdoor, or existing link)`
    );
    return "no-exec";
  }

  const deadline = Date.now() + RESULT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const res = /** @type {StasisResult | null} */ (consumePortData(ns, PORTS.DNET_STASIS));
    if (res && res.host === host && res.mode === mode) {
      if (res.success) tlog(ns, `✓ ${host}: stasis ${mode} confirmed`);
      else tlog(ns, `✗ ${host}: ${res.message} (code ${res.code})`);
      return res.success ? "ok" : "failed";
    }
    // Backup confirmation: the worker can die before reporting (server restart mid-call);
    // the authoritative link list still tells us whether the deed got done.
    const isLinked = ns.dnet.getStasisLinkedServers().includes(host);
    if (isLinked === (mode === "link") && !ns.isRunning(pid)) {
      tlog(ns, `✓ ${host}: stasis ${mode} confirmed (via link list)`);
      return "ok";
    }
    await ns.sleep(500);
  }
  tlog(ns, `✗ ${host}: no verdict after ${RESULT_TIMEOUT_MS / 1000}s — check its logs`);
  return "timeout";
}

/** @param {NS} ns */
function printStatus(ns, limit) {
  const linked = ns.dnet.getStasisLinkedServers();
  const candidates = getStasisCandidates(ns);
  const plan = planStasisLinks(candidates, limit, linked);

  ns.tprint(`\n=== Stasis links: ${linked.length} / ${limit} ===`);
  for (const host of linked) {
    const c = candidates.find((x) => x.hostname === host);
    ns.tprint(`  ● ${host}${c && c.depth >= 0 ? ` (depth ${c.depth})` : ""}`);
  }
  if (plan.add.length > 0) {
    ns.tprint(`  Next to link (${plan.slotsFree} slot${plan.slotsFree === 1 ? "" : "s"} free):`);
    for (const c of plan.add) {
      ns.tprint(`  ○ ${c.hostname} (depth ${c.depth}, difficulty ${c.difficulty}) — run: stasis.js auto`);
    }
  } else if (plan.slotsFree > 0) {
    ns.tprint(`  ${plan.slotsFree} slot(s) free but no eligible candidate.`);
  }
  for (const s of plan.skipped) {
    if (s.reason === "linked") continue; // already shown with ● above
    ns.tprint(`  · ${s.hostname}: ${REASON_HINTS[s.reason] ?? s.reason}`);
  }
  if (candidates.length === 0) {
    ns.tprint(`  No known darknet servers yet — store a password with: stasis.js link <host> <password>`);
    ns.tprint(`  (store: ${PASSWORD_FILE})`);
  }
}

/** @param {NS} ns */
export async function main(ns) {
  let limit;
  try {
    limit = ns.dnet.getStasisLinkLimit();
  } catch {
    ns.tprint("Darknet API unavailable — get darknet access (DarkscapeNavigator.exe) first.");
    return;
  }

  const cmd = String(ns.args[0] ?? "status").toLowerCase();
  const host = ns.args[1] != null ? String(ns.args[1]) : null;
  const passwordArg = ns.args[2] != null ? String(ns.args[2]) : null;
  const store = loadPasswords(ns);

  if (cmd === "status") {
    printStatus(ns, limit);
    return;
  }

  if (cmd === "auto") {
    const linked = ns.dnet.getStasisLinkedServers();
    const plan = planStasisLinks(getStasisCandidates(ns), limit, linked);
    if (plan.add.length === 0) {
      tlog(ns, `stasis auto: nothing to do (${linked.length}/${limit} linked, ${plan.slotsFree} free slots)`);
      return;
    }
    let ok = 0;
    for (const c of plan.add) {
      if ((await applyLink(ns, c.hostname, "link", store[c.hostname])) === "ok") ok++;
    }
    tlog(ns, `stasis auto: linked ${ok}/${plan.add.length}, now ${ns.dnet.getStasisLinkedServers().length}/${limit}`);
    return;
  }

  if (cmd === "link" || cmd === "unlink") {
    if (!host) {
      ns.tprint(`Usage: run ${ns.getScriptName()} ${cmd} <host>${cmd === "link" ? " [password]" : ""}`);
      return;
    }
    const password = passwordArg ?? store[host];
    if (!password) {
      ns.tprint(`No password for ${host}. Pass one: run ${ns.getScriptName()} link ${host} <password>`);
      return;
    }
    const result = await applyLink(ns, host, /** @type {"link"|"unlink"} */ (cmd), password);
    // Session success proves the password — worth keeping even if the exec step failed.
    if (passwordArg && result !== "no-session" && store[host] !== passwordArg) {
      savePassword(ns, host, passwordArg);
      tlog(ns, `password for ${host} saved to ${PASSWORD_FILE}`);
    }
    return;
  }

  ns.tprint(`Unknown command "${cmd}". Usage: run ${ns.getScriptName()} [status|auto|link|unlink]`);
}
