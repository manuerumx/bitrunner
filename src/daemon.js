import { log, tlog, formatMoney, formatRAM } from "/src/lib/utils.js";
import { scanNetwork } from "/src/lib/scanner.js";
import { getConfig } from "/src/lib/config.js";
import { MANAGERS } from "/src/lib/constants.js";

function getScriptRAM(ns, script) {
  const ram = ns.getScriptRam(script);
  return ram > 0 ? ram : Infinity;
}

function isRunning(ns, script) {
  return ns.isRunning(script, "home");
}

function launchManager(ns, manager) {
  if (isRunning(ns, manager.script)) return true;

  const ram = getScriptRAM(ns, manager.script);
  if (ram === Infinity) return false;

  const freeRAM = ns.getServerMaxRam("home") - ns.getServerUsedRam("home");
  if (freeRAM < ram) return false;

  const pid = ns.run(manager.script);
  if (pid > 0) {
    log(ns, `Launched ${manager.name} (${ram.toFixed(1)} GB)`);
    return true;
  }
  return false;
}

function getNetworkStats(ns) {
  const hostnames = scanNetwork(ns);
  let rootedCount = 0;
  let backdooredCount = 0;
  let totalRAM = 0;
  let usedRAM = 0;

  for (const hostname of hostnames) {
    if (ns.hasRootAccess(hostname)) {
      rootedCount++;
      // backdoorInstalled is only readable via ns.getServer (+2 GB to this script's RAM).
      if (ns.getServer(hostname).backdoorInstalled) backdooredCount++;
      totalRAM += ns.getServerMaxRam(hostname);
      usedRAM += ns.getServerUsedRam(hostname);
    }
  }

  return {
    totalServers: hostnames.length,
    rootedCount,
    backdooredCount,
    totalRAM,
    usedRAM,
    purchasedServers: ns.cloud.getServerNames().length,
    hacknetNodes: ns.hacknet.numNodes(),
  };
}

/** @param {NS} ns */
export async function main(ns) {
  ns.disableLog("ALL");
  ns.ui.openTail();

  tlog(ns, "=== BITRUNNER DAEMON STARTING ===");

  const homeRAM = ns.getServerMaxRam("home");
  tlog(ns, `Home RAM: ${formatRAM(homeRAM)}`);
  tlog(ns, `Player Money: ${formatMoney(ns.getPlayer().money)}`);
  tlog(ns, `Hacking Level: ${ns.getHackingLevel()}`);

  const sortedManagers = [...MANAGERS].sort((a, b) => a.priority - b.priority);
  const launchedLastCycle = new Set(); // managers ns.run() last cycle, awaiting confirmation they stayed up
  const locked = new Set();            // managers that exited immediately too many times in a row — stop relaunching
  const failures = new Map();          // script -> consecutive immediate-exit count, before it trips the lock
  const LOCK_AFTER_FAILURES = 3;       // tolerate this many transient immediate-exits before locking (~15s of retries)
  const RELOCK_RETRY_CYCLES = 60;      // ~5 min at 5s/cycle: re-probe locked managers in case a feature got unlocked
  let cycle = 0;

  while (true) {
    // Periodically forget the locks so newly-unlocked subsystems (SF gained, gang/corp created,
    // Bladeburner joined) get re-probed and started automatically. The re-probe is silent — the
    // managers log "API required" to their own tail, not the terminal.
    if (++cycle % RELOCK_RETRY_CYCLES === 0) locked.clear();

    const cfg = getConfig(ns); // surplus-RAM toggles + disabledManagers live on the config-overrides port (0 GB peek)

    for (const manager of sortedManagers) {
      if (!ns.fileExists(manager.script)) continue;

      // Manually disabled via tools/manager-toggle.js: kill it if it's running (so it stops
      // overriding whatever the player is doing) and don't relaunch it until re-enabled.
      if (cfg.disabledManagers.includes(manager.id)) {
        if (isRunning(ns, manager.script)) {
          ns.kill(manager.script, "home");
          log(ns, `Stopped ${manager.name} (disabled)`);
        }
        launchedLastCycle.delete(manager.script);
        locked.delete(manager.script);
        failures.delete(manager.script);
        continue;
      }

      // Already up (including started manually): keep managing it, and clear any stale state.
      if (isRunning(ns, manager.script)) {
        launchedLastCycle.delete(manager.script);
        locked.delete(manager.script);
        failures.delete(manager.script);
        continue;
      }

      // Known-unavailable (missing Source File / feature): don't relaunch. This is what
      // spammed the terminal with "API required" every cycle.
      if (locked.has(manager.script)) continue;

      // We launched it last cycle but it's already gone → it exited immediately. Count it, and
      // only lock after LOCK_AFTER_FAILURES in a row, so a single transient (a momentary RAM blip)
      // doesn't lock a healthy persistent manager like the rooter for the whole re-probe window.
      // API-gated managers fail every cycle and still trip the lock within ~15s.
      if (launchedLastCycle.has(manager.script)) {
        launchedLastCycle.delete(manager.script);
        const fails = (failures.get(manager.script) || 0) + 1;
        if (fails >= LOCK_AFTER_FAILURES) {
          failures.delete(manager.script);
          locked.add(manager.script);
          continue;
        }
        failures.set(manager.script, fails);
        // fall through and retry the launch this cycle
      }

      if (launchManager(ns, manager)) {
        launchedLastCycle.add(manager.script);
      }
    }

    const money = ns.getPlayer().money;
    const hackLevel = ns.getHackingLevel();
    const freeRAM = ns.getServerMaxRam("home") - ns.getServerUsedRam("home");
    const net = getNetworkStats(ns);

    ns.clearLog();
    ns.print("╔══════════════════════════════════╗");
    ns.print("║       BITRUNNER DAEMON           ║");
    ns.print("╚══════════════════════════════════╝");
    ns.print(`  Money:   ${formatMoney(money)}`);
    ns.print(`  Hacking: ${hackLevel}`);
    ns.print(`  Home:    ${formatRAM(freeRAM)} free / ${formatRAM(homeRAM)}`);
    ns.print("");
    ns.print(`── Network ──`);
    ns.print(`  Servers: ${net.rootedCount}/${net.totalServers} rooted | ${net.backdooredCount} backdoored`);
    ns.print(`  Botnet:  ${formatRAM(net.totalRAM - net.usedRAM)} free / ${formatRAM(net.totalRAM)}`);
    ns.print(`  Purchased: ${net.purchasedServers}/25 | Hacknet: ${net.hacknetNodes}`);
    ns.print("");
    ns.print(`── Modes ──`);
    ns.print(`  XP farm: ${cfg.xpFarmRAM ? "▶ ON" : "· off"} | Share idle: ${cfg.shareIdleRAM ? "▶ ON" : "· off"}`);
    ns.print("");
    ns.print(`── Managers ──`);
    for (const manager of sortedManagers) {
      const status = !ns.fileExists(manager.script)
        ? "·"
        : cfg.disabledManagers.includes(manager.id)
          ? "⏸ DISABLED"
          : isRunning(ns, manager.script)
            ? "▶ RUNNING"
            : locked.has(manager.script)
              ? "🔒 LOCKED"
              : `■ STOPPED (${getScriptRAM(ns, manager.script).toFixed(1)} GB)`;
      ns.print(`  ${manager.name}: ${status}`);
    }

    await ns.sleep(5000);
  }
}
