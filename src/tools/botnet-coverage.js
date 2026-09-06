import { scanNetwork } from "/src/lib/scanner.js";
import { WORKER_SCRIPTS, WORKER_RAM, DEFAULTS } from "/src/lib/constants.js";
import { formatRAM } from "/src/lib/utils.js";

// Reconciles "N/N rooted" (daemon.js) against the number of servers the game's Active Scripts
// page actually lists. Those two numbers are SUPPOSED to differ, and by a lot:
//
//   27 of the 70 servers Bitburner 3.0.1 ships have no maxRamExponent at all, i.e. 0 GB — ecorp,
//   megacorp, nwo, clarkinc, 4sigma, kuai-gong, fulcrumassets, b-and-a, stormtech, defcomm,
//   infocomm, icarus, taiyang-digital, galactic-cyber, aerocorp, zb-def, applied-energetics,
//   deltaone, nova-med, zeus-med, syscore, computek, johnson-ortho, crush-fitness, snap-fitness,
//   The-Cave, w0r1d_d43m0n. They are hack and backdoor targets, never script hosts. Rooting them
//   is still correct; nothing can ever run on them.
//
//   Measured against a real save: scan returns 94 (69 base + 25 purchased) — the 70th base server,
//   w0r1d_d43m0n, is not in the network yet, and darkweb never appears in scan at all. 26 of those
//   69 are the 0 GB set, leaving 68 script-capable + home = the 69 rows Active Scripts shows.
//
// So "rooted but not in Active Scripts" is expected for roughly a third of the network. What is
// NOT expected is a rooted host WITH RAM sitting idle, or one missing the worker files. Those two
// buckets are the ones worth reading — the rest is arithmetic.
//
//   run src/tools/botnet-coverage.js

/** @param {NS} ns */
function classify(ns) {
  const purchased = new Set(ns.cloud.getServerNames());
  const hosts = scanNetwork(ns);

  const buckets = {
    total: hosts.length,
    rooted: 0,
    purchased: purchased.size,
    unrooted: [],
    zeroRAM: [],   // rooted, maxRam 0 — can never host a script
    idle: [],      // rooted, has RAM, nothing running: the bucket that answers the question
    missing: [],   // rooted, has RAM, worker files absent: a real deployment gap
    running: [],
    hacknet: [],   // hacknet SERVERS (BitNode 9) show up in scan; hacknet nodes do not
    byScript: {},  // filename -> threads, across the whole botnet
  };

  for (const hostname of hosts) {
    if (hostname.startsWith("hacknet-server-") || hostname.startsWith("hacknet-node-")) {
      buckets.hacknet.push(hostname);
    }
    if (!ns.hasRootAccess(hostname)) {
      buckets.unrooted.push(hostname);
      continue;
    }
    buckets.rooted++;

    const maxRam = ns.getServerMaxRam(hostname);
    if (maxRam === 0) {
      buckets.zeroRAM.push(hostname);
      continue;
    }

    const procs = ns.ps(hostname);
    for (const p of procs) buckets.byScript[p.filename] = (buckets.byScript[p.filename] ?? 0) + p.threads;
    const entry = {
      hostname,
      maxRam,
      freeRAM: maxRam - ns.getServerUsedRam(hostname),
      procs: procs.length,
      purchased: purchased.has(hostname),
    };

    // execWorker() scp's on a failed exec, so a missing worker should self-heal within a cycle.
    // If it shows up here anyway, the host is being skipped before exec is ever attempted.
    if (!WORKER_SCRIPTS.every((script) => ns.fileExists(script, hostname))) buckets.missing.push(entry);

    if (procs.length === 0) buckets.idle.push(entry);
    else buckets.running.push(entry);
  }

  return buckets;
}

/** @param {NS} ns */
export async function main(ns) {
  const b = classify(ns);
  const homeProcs = ns.ps("home").length;
  const scriptHosts = b.running.length + (homeProcs > 0 ? 1 : 0);

  ns.tprint("\n=== Botnet coverage ===");
  ns.tprint(`  Scanned (excl. home): ${b.total}`);
  ns.tprint(`  Rooted:               ${b.rooted}${b.unrooted.length ? `  (unrooted: ${b.unrooted.join(", ")})` : ""}`);
  ns.tprint(`  Purchased:            ${b.purchased}`);
  ns.tprint(`  Hacknet in scan:      ${b.hacknet.length}${b.hacknet.length ? " (hacknet servers — these CAN run scripts)" : " (plain hacknet nodes are not network servers)"}`);

  ns.tprint(`\n  Rooted with 0 GB RAM: ${b.zeroRAM.length}  — can never appear in Active Scripts`);
  if (b.zeroRAM.length) ns.tprint(`    ${b.zeroRAM.join(", ")}`);

  ns.tprint(`\n  Script-capable rooted hosts: ${b.rooted - b.zeroRAM.length}`);
  ns.tprint(`    running scripts: ${b.running.length}`);
  ns.tprint(`    idle:            ${b.idle.length}`);
  ns.tprint(`  Active Scripts should therefore list ${scriptHosts} host(s), home included.`);

  const idleRAM = b.idle.reduce((sum, s) => sum + s.freeRAM, 0);
  const poolRAM = b.idle.concat(b.running).reduce((sum, s) => sum + s.maxRam, 0);
  ns.tprint(`  Idle RAM: ${formatRAM(idleRAM)} of ${formatRAM(poolRAM)} rooted network+purchased RAM.`);

  // What the botnet is actually doing. Phase 4 of the coordinator is supposed to leave share.js
  // (or xp.js) soaking every spare GB, so a large idle figure with zero share threads means the
  // soak never ran — or ran against a pool that was full at the time and has since drained.
  ns.tprint(`\n  Threads by script (whole botnet, excl. home):`);
  const scripts = Object.entries(b.byScript).sort((x, y) => y[1] - x[1]);
  if (!scripts.length) ns.tprint(`    (nothing running)`);
  for (const [file, threads] of scripts) ns.tprint(`    ${file.padEnd(22)} ${threads}t`);

  if (b.idle.length) {
    ns.tprint(`\n  IDLE (rooted, has RAM, nothing running) — expected only when the pool is oversupplied:`);
    for (const s of b.idle.sort((x, y) => y.freeRAM - x.freeRAM)) {
      const tooSmall = s.freeRAM < WORKER_RAM.WEAKEN ? "  ← below one weaken thread" : "";
      ns.tprint(`    ${s.hostname.padEnd(22)} ${formatRAM(s.freeRAM).padStart(10)} free / ${formatRAM(s.maxRam)}${tooSmall}`);
    }
  }

  if (b.missing.length) {
    ns.tprint(`\n  ⚠ MISSING WORKERS (rooted, has RAM, ${WORKER_SCRIPTS.join("/")} absent) — deployment gap:`);
    for (const s of b.missing) ns.tprint(`    ${s.hostname}`);
  } else {
    ns.tprint(`\n  Worker files present on every script-capable rooted host.`);
  }

  const homeFree = Math.max(0, ns.getServerMaxRam("home") - ns.getServerUsedRam("home") - DEFAULTS.reservedHomeRAM);
  ns.tprint(`\n  home: ${homeProcs} process(es), ${formatRAM(homeFree)} free after the ${formatRAM(DEFAULTS.reservedHomeRAM)} reserve.`);
  for (const p of ns.ps("home")) ns.tprint(`    ${p.filename.padEnd(34)} ${p.threads}t`);
}
