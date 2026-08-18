import { placementOrder, rankFragments } from "/src/lib/stanek.js";
import { tlog } from "/src/lib/utils.js";

// Stanek's Gift: board layout and fragment charging. See docs/API-COVERAGE-AUDIT.md §5.14.
//
//   run /src/tools/stanek.js            show the board and every placed fragment
//   run /src/tools/stanek.js place      greedily fill empty space, hacking fragments first
//   run /src/tools/stanek.js charge     charge every placed fragment, forever
//
// ⚠ THIS TOOL CANNOT ACCEPT THE GIFT, BY DESIGN. ns.stanek.acceptGift() is irreversible
// and permanently shrinks home RAM — which is the resource daemon.js budgets every manager
// against. Accepting is a run-shaping decision, so it stays yours: take the gift from the
// Church of the Machine God in Chongqing, then come back here. The function is not
// referenced anywhere in this suite, so no script can accept it by accident.
//
// Requires BitNode 13 or Source-File 13.
//
// RAM: 1.6 base + giftWidth/giftHeight (0.8) + activeFragments (5) + fragmentDefinitions (0)
//      + canPlaceFragment (0.5) + placeFragment (5) + chargeFragment (0.4) = 13.3 GB.

// This suite's income is hacking, so hacking fragments earn their board space first:
// HackingSpeed(3), HackingMoney(4), HackingGrow(5), Hacking(6).
const PREFERRED_TYPES = [3, 4, 5, 6];

/** @param {NS} ns */
function hasGift(ns) {
  try {
    return ns.stanek.giftWidth() > 0;
  } catch {
    return false;
  }
}

/** @param {NS} ns */
function printStatus(ns) {
  const width = ns.stanek.giftWidth();
  const height = ns.stanek.giftHeight();
  const active = ns.stanek.activeFragments();

  ns.tprint(`\n=== Stanek's Gift — ${width}×${height}, ${active.length} fragment(s) placed ===`);
  if (active.length === 0) {
    ns.tprint("  Board is empty. Fill it with:  run /src/tools/stanek.js place");
    return;
  }
  for (const f of active) {
    ns.tprint(
      `  #${f.id} type ${f.type} at (${f.x},${f.y}) rot ${f.rotation} — ` +
        `charge ${f.numCharge.toFixed(0)} (peak ${f.highestCharge.toFixed(0)}), effect ${f.effect}`
    );
  }
  ns.tprint("\nFragments do nothing until charged:  run /src/tools/stanek.js charge");
}

/** @param {NS} ns */
function placeFragments(ns) {
  const width = ns.stanek.giftWidth();
  const height = ns.stanek.giftHeight();
  const positions = placementOrder(width, height);
  const ranked = rankFragments(ns.stanek.fragmentDefinitions(), { preferredTypes: PREFERRED_TYPES });

  let placed = 0;
  for (const fragment of ranked) {
    // canPlaceFragment reflects live board state, so each success narrows what fits next —
    // which is why placement is greedy and place-as-you-go rather than solved up front.
    const spot = positions.find((p) =>
      ns.stanek.canPlaceFragment(p.x, p.y, p.rotation, fragment.id)
    );
    if (!spot) continue;
    if (ns.stanek.placeFragment(spot.x, spot.y, spot.rotation, fragment.id)) {
      placed++;
      tlog(ns, `Placed fragment #${fragment.id} (type ${fragment.type}) at ${spot.x},${spot.y}`);
    }
  }

  tlog(ns, placed > 0 ? `Placed ${placed} fragment(s)` : "Nothing else fits on the board");
  if (placed > 0) ns.tprint("Now charge them:  run /src/tools/stanek.js charge");
}

/** @param {NS} ns */
async function chargeForever(ns) {
  ns.disableLog("ALL");
  ns.ui.openTail();

  let cycles = 0;
  while (true) {
    const active = ns.stanek.activeFragments();
    if (active.length === 0) {
      ns.tprint("No fragments placed — nothing to charge. Try: run /src/tools/stanek.js place");
      return;
    }

    // Charge is per-fragment and effect scales with the LOWEST charge, so sweeping all of
    // them evenly beats pouring everything into one.
    for (const f of active) {
      await ns.stanek.chargeFragment(f.x, f.y);
    }

    if (++cycles % 20 === 0) {
      const lowest = active.reduce((min, f) => Math.min(min, f.numCharge), Infinity);
      ns.print(`Charged ${active.length} fragment(s) ×${cycles} — lowest charge ${lowest.toFixed(0)}`);
    }
  }
}

/** @param {NS} ns */
export async function main(ns) {
  if (!hasGift(ns)) {
    ns.tprint("Stanek's Gift is not active.");
    ns.tprint("Accept it from the Church of the Machine God in Chongqing — a permanent,");
    ns.tprint("irreversible choice that shrinks home RAM, so this tool will not do it for you.");
    return;
  }

  const mode = String(ns.args[0] ?? "").toLowerCase();
  if (mode === "place") return placeFragments(ns);
  if (mode === "charge") return chargeForever(ns);
  printStatus(ns);
}
