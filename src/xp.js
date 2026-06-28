/** @param {NS} ns */
export async function main(ns) {
  // Pure hacking-EXP farm: loop weaken() on `target` forever. Hacking EXP per thread per op is
  // (3 + 0.3 * baseDifficulty) regardless of money or security — same for hack/grow/weaken — so the
  // only thing that separates them for a farm is op-time, and op-time scales with the target's
  // CURRENT security. weaken() is the only op that LOWERS security (hack and grow both raise it), so
  // a botnet-scale weaken-farm drives the target to min security and pins it there: op-time stays at
  // its floor and the farm runs at its fastest, self-stabilizing rate. A grow/hack farm would instead
  // slam the target to max security and run at its slowest rate forever. Loops like share.js; the
  // coordinator kills and re-fills it each cycle.
  const target = String(ns.args[0]);
  while (true) {
    await ns.weaken(target);
  }
}
