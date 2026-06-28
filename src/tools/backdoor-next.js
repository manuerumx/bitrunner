import { scanNetwork, getServerDetails, getPath } from "/src/lib/scanner.js";

// Servers whose backdoor unlocks a faction invite (the whole reason to backdoor by hand before you
// have the Singularity API). Ranked first so this tool walks you through faction unlocks in order.
const PRIORITY_SERVERS = ["CSEC", "avmnite-02h", "I.I.I.I", "run4theh111z", "w0r1d_d43m0n"];

// Backdooring this server ENDS the current BitNode — never connect silently, always warn.
const BITNODE_ENDER = "w0r1d_d43m0n";

// Pure ranking so it's unit-testable. `servers` are getServerDetails() shapes. A server is a
// candidate when we have root, we're high enough level to backdoor it, it isn't backdoored already,
// and it isn't one of our own purchased servers (those can't be backdoored). scanNetwork already
// excludes home. Faction servers first, then easiest (lowest required hacking level).
export function rankBackdoorCandidates(servers, playerHacking) {
  return servers
    .filter(
      (s) => s.hasRoot && !s.backdoor && !s.isPurchased && s.requiredHackLevel <= playerHacking
    )
    .map((s) => ({ ...s, priority: PRIORITY_SERVERS.includes(s.hostname) ? 0 : 1 }))
    .sort((a, b) => a.priority - b.priority || a.requiredHackLevel - b.requiredHackLevel);
}

// Type a command into the game terminal and submit it. The terminal input is a React-controlled
// <input>, so we set its value and invoke React's own onChange/onKeyDown props — dispatching plain
// DOM events doesn't update React's state. This reaches into React internals (the `__reactProps$…`
// key) and WILL break on a Bitburner/React update; callers must treat failure as normal and fall
// back to the printed chain. `eval("document")` is a CONSTANT string (no user input, no injection
// surface) — it's the standard Bitburner idiom to stop the game's static RAM analyzer from charging
// the 25GB window/document penalty on the literal token (and it dodges the missing-DOM-lib type
// error since jsconfig pulls no DOM lib). Returns false if it can't run.
function tryRunInTerminal(command) {
  try {
    const doc = eval("document");
    const input = doc.getElementById("terminal-input");
    if (!input) return false;
    const propsKey = Object.keys(input).find((k) => k.startsWith("__reactProps"));
    if (!propsKey) return false;
    const props = input[propsKey];
    if (!props || typeof props.onChange !== "function" || typeof props.onKeyDown !== "function") {
      return false;
    }
    input.value = command;
    props.onChange({ target: input });
    props.onKeyDown({ key: "Enter", preventDefault: () => {} });
    return true;
  } catch {
    return false;
  }
}

/** @param {NS} ns */
export async function main(ns) {
  const playerHacking = ns.getHackingLevel();
  const servers = scanNetwork(ns).map((h) => getServerDetails(ns, h));
  const candidates = rankBackdoorCandidates(servers, playerHacking);

  if (candidates.length === 0) {
    ns.tprint(
      `No server to backdoor: everything rooted and within your hacking level (${playerHacking}) ` +
        `is already backdoored. Raise your level to reach the rest.`
    );
    return;
  }

  const target = candidates[0];
  const reason =
    target.priority === 0 ? "faction server" : `lowest required hacking level: ${target.requiredHackLevel}`;
  const path = getPath(ns, target.hostname);
  const connectChain = ["home", ...path.slice(1).map((h) => `connect ${h}`)].join("; ");
  const fullChain = `${connectChain}; backdoor`;

  ns.tprint(`\n=== Next backdoor: ${target.hostname} (${reason}, ${path.length - 1} hops) ===`);

  if (target.hostname === BITNODE_ENDER) {
    ns.tprint("");
    ns.tprint("  *** WARNING: backdooring w0r1d_d43m0n ENDS THE CURRENT BITNODE. ***");
    ns.tprint("  *** Not auto-connecting. Paste the chain below ONLY if you mean to. ***");
  }

  // The copy-paste chain is the guaranteed deliverable — robust, and the manual workflow the user
  // asked for. Always print it, whether or not the DOM auto-connect below succeeds.
  ns.tprint("");
  ns.tprint("Paste this into the terminal to connect and backdoor:");
  ns.tprint(`  ${fullChain}`);
  ns.tprint("");

  // Bonus: auto-navigate. Connect only (leave `backdoor` for you to type, since the manual backdoor
  // is the point). Skipped for the BitNode-ender so we never connect toward it unprompted.
  if (target.hostname !== BITNODE_ENDER && tryRunInTerminal(connectChain)) {
    ns.tprint(`Connected to ${target.hostname}. Now type:  backdoor`);
  } else if (target.hostname !== BITNODE_ENDER) {
    ns.tprint("(Auto-connect unavailable — paste the chain above manually.)");
  }

  if (candidates.length > 1) {
    ns.tprint("");
    ns.tprint(`Other reachable targets (${candidates.length - 1}):`);
    for (const c of candidates.slice(1, 11)) {
      const tag = c.priority === 0 ? " [faction]" : "";
      ns.tprint(`  ${c.hostname} (req ${c.requiredHackLevel})${tag}`);
    }
    if (candidates.length > 11) ns.tprint(`  …and ${candidates.length - 11} more`);
  }
}
