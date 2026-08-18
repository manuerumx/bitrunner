import { pushPortData, PORTS } from "/src/lib/port-registry.js";
import { shouldCheat } from "/src/lib/go.js";

// Plays ONE IPvGO cheat move, then exits. Launched by tools/ipvgo.js with `cheat`.
//
//   run /src/tools/ipvgo-cheat-worker.js <x> <y>
//
// Why a separate script. Bitburner charges static RAM for every literal `ns.<fn>` the
// source mentions, whether or not it runs — so putting cheats behind an `if` in ipvgo.js
// would still bill removeRouter (8 GB) + getCheatSuccessChance (1) + getCheatCount (1) on
// every run, for everyone, including players without Source-File 14.2 for whom the calls
// only throw. Isolating them here keeps ipvgo.js at +1 GB (ns.run) and pays the 11.6 GB
// only while a cheat is actually in flight. Same trick as the darknet workers.
//
// RAM: 1.6 base + getCheatSuccessChance (1) + getCheatCount (1) + removeRouter (8) = 11.6 GB.
//
// Requires Source-File 14.2. Without it the calls throw and the worker reports that back
// rather than dying silently.

// The odds are re-checked here, not in the caller, because getCheatSuccessChance costs
// 1 GB and the whole point is to keep that out of ipvgo.js.
//
// Two thresholds because the penalty is not flat. From the API docs: a failed cheat skips
// your turn, and "after your first cheat attempt, if you fail, there is a small (~10%)
// chance you will instantly be ejected from the subnet". The opening cheat therefore risks
// only a turn we were about to pass anyway; every later one risks the whole game, while the
// success chance itself decays with each attempt.
const FIRST_THRESHOLD = 0.55;
const LATER_THRESHOLD = 0.9;

/** @param {NS} ns */
export async function main(ns) {
  const x = Number(ns.args[0]);
  const y = Number(ns.args[1]);

  /** @param {string} status @param {string} message */
  const report = (status, message) =>
    pushPortData(ns, PORTS.GO_CHEAT, { x, y, status, message });

  let cheatCount;
  let successChance;
  try {
    cheatCount = ns.go.cheat.getCheatCount();
    successChance = ns.go.cheat.getCheatSuccessChance();
  } catch (err) {
    report("unavailable", `cheat API unavailable (needs SF-14.2): ${String(err).split("\n")[0]}`);
    return;
  }

  if (!shouldCheat({ successChance, cheatCount, firstThreshold: FIRST_THRESHOLD, laterThreshold: LATER_THRESHOLD })) {
    report(
      "declined",
      `${(successChance * 100).toFixed(0)}% success after ${cheatCount} cheat(s) — not worth the ejection risk`
    );
    return;
  }

  try {
    const result = await ns.go.cheat.removeRouter(x, y);
    report("played", `removeRouter at ${x},${y} → ${result.type} (${(successChance * 100).toFixed(0)}% odds)`);
  } catch (err) {
    // A rejected cheat costs the turn, which is the turn ipvgo.js was about to pass.
    report("failed", String(err).split("\n")[0]);
  }
}
