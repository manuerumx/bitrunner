import { scanNetwork, getServerDetails } from "/src/lib/scanner.js";

/** @param {NS} ns */
export function rankTargets(ns, servers) {
  const playerHacking = ns.getHackingLevel();
  const scored = [];

  for (const srv of servers) {
    if (srv.maxMoney <= 0) continue;
    if (!srv.hasRoot) continue;
    if (srv.requiredHackLevel > playerHacking) continue;
    if (srv.isPurchased || srv.isHome) continue;

    // Score using OPTIMAL server state (min security) for fair comparison.
    // hackAnalyze/hackAnalyzeChance use current security, which penalizes
    // un-prepped servers unfairly. Instead, use maxMoney and weakenTime
    // (which reflects min-security time) as the primary ranking signal.
    const hackChance = ns.hackAnalyzeChance(srv.hostname);
    const hackPercent = ns.hackAnalyze(srv.hostname);
    const hackTime = ns.getHackTime(srv.hostname);
    const weakenTime = ns.getWeakenTime(srv.hostname);
    const growTime = ns.getGrowTime(srv.hostname);

    if (hackTime <= 0 || weakenTime <= 0) continue;

    // Score: maxMoney is dominant, weakenTime is a mild tiebreaker.
    //
    // Old formula: maxMoney / weakenTime (linear)
    //   Problem: dividing linearly by time made fast low-money servers
    //   (foodnstuff at 2s) outscore high-money servers (catalyst at 300s)
    //   by 10-30x. A $50m server with 2s weaken beat a $250m server
    //   with 60s weaken — the opposite of what we want.
    //
    // New formula: maxMoney / weakenTime^0.3 (dampened)
    //   The 0.3 exponent keeps a slight speed preference for tiebreaking
    //   but lets maxMoney dominate. In HWGW mode, batches stack so cycle
    //   time barely matters — RAM efficiency and raw money potential do.
    const effectiveChance = Math.max(hackChance, 0.5); // Don't over-penalize
    const timeFactor = Math.pow(weakenTime / 1000, 0.3);
    const score = (srv.maxMoney * effectiveChance) / timeFactor;

    scored.push({ ...srv, hackChance, hackPercent, hackTime, weakenTime, growTime, score });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored;
}

/** @param {NS} ns */
export function selectTargets(ns, count = 1) {
  const hostnames = scanNetwork(ns);
  const servers = hostnames.map((h) => getServerDetails(ns, h));
  const ranked = rankTargets(ns, servers);
  return ranked.slice(0, count);
}

// Rank servers for a pure hacking-EXP farm (xp.js loops weaken() on the winner).
//
// EXP is driven by a DIFFERENT signal than money. Per thread per op the game grants
// (3 + 0.3 * baseDifficulty) hacking EXP — keyed off the server's BASE difficulty (a constant),
// NOT its current security, and NOT the money stolen. So the money-based rankTargets score above is
// irrelevant here. What we actually want to maximize is EXP throughput per thread:
//
//     score = expPerOp / weakenTime = (3 + 0.3 * baseDifficulty) / weakenTime
//
// A high-baseDifficulty server pays more EXP per op but also has a longer weakenTime, so neither raw
// difficulty nor raw speed wins outright — we divide one by the other and let the live game numbers
// pick. We measure weakenTime (the farm worker uses weaken()), and because weaken keeps the target
// pinned at min security, the measured time IS the farm's steady-state time — the ranking is accurate.
// Money/prep state is ignored: weaken() pays full EXP on any rooted server regardless of its balance.
/** @param {NS} ns */
export function rankXPTargets(ns, hostnames) {
  const playerHacking = ns.getHackingLevel();
  const scored = [];

  for (const hostname of hostnames) {
    if (hostname === "home") continue;
    if (!ns.hasRootAccess(hostname)) continue;
    if (ns.getServerRequiredHackingLevel(hostname) > playerHacking) continue;

    const weakenTime = ns.getWeakenTime(hostname);
    if (!(weakenTime > 0)) continue;

    const baseDifficulty = ns.getServerBaseSecurityLevel(hostname);
    const expPerOp = 3 + 0.3 * baseDifficulty;
    const score = expPerOp / weakenTime;

    scored.push({ hostname, baseDifficulty, weakenTime, expPerOp, score });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored;
}

/** @param {NS} ns */
export function selectXPTarget(ns) {
  const ranked = rankXPTargets(ns, scanNetwork(ns));
  return ranked[0] || null;
}
