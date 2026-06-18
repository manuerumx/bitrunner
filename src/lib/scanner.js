/** @param {NS} ns */
export function scanNetwork(ns) {
  const visited = new Set(["home"]);
  const queue = ["home"];
  while (queue.length > 0) {
    const current = queue.shift();
    for (const neighbor of ns.scan(current)) {
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        queue.push(neighbor);
      }
    }
  }
  visited.delete("home");
  return [...visited];
}

/** @param {NS} ns */
export function getServerDetails(ns, hostname) {
  const server = ns.getServer(hostname);
  return {
    hostname: server.hostname,
    maxMoney: server.moneyMax,
    currentMoney: server.moneyAvailable,
    minSecurity: server.minDifficulty,
    currentSecurity: server.hackDifficulty,
    requiredHackLevel: server.requiredHackingSkill,
    portsRequired: server.numOpenPortsRequired,
    portsOpen: server.openPortCount,
    hasRoot: server.hasAdminRights,
    maxRAM: server.maxRam,
    usedRAM: server.ramUsed,
    freeRAM: server.maxRam - server.ramUsed,
    isHome: hostname === "home",
    isPurchased: server.purchasedByPlayer,
    backdoor: server.backdoorInstalled,
    org: server.organizationName,
  };
}

/** @param {NS} ns */
export function getPath(ns, target) {
  const visited = new Set(["home"]);
  const queue = [["home"]];
  while (queue.length > 0) {
    const path = queue.shift();
    const current = path[path.length - 1];
    if (current === target) return path;
    for (const neighbor of ns.scan(current)) {
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        queue.push([...path, neighbor]);
      }
    }
  }
  return [];
}
