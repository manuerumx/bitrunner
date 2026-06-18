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
