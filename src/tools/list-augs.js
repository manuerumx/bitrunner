import { tlog, formatMoney } from "/src/lib/utils.js";

const NFG = "NeuroFlux Governor";
const SUFFIXES = ["", "k", "m", "b", "t"];

function hasSingularity(ns) {
  try {
    ns.singularity.getCurrentWork();
    return true;
  } catch {
    return false;
  }
}

export function formatRep(n) {
  let idx = 0;
  while (n >= 1000 && idx < SUFFIXES.length - 1) {
    n /= 1000;
    idx++;
  }
  return idx === 0 ? `${n.toFixed(0)}` : `${n.toFixed(2)}${SUFFIXES[idx]}`;
}

export function formatAugStats(stats) {
  const parts = [];
  for (const [key, value] of Object.entries(stats)) {
    if (typeof value !== "number" || value === 1) continue;
    const pct = Number(((value - 1) * 100).toFixed(1));
    parts.push(`${pct >= 0 ? "+" : ""}${pct}% ${key.replaceAll("_", " ")}`);
  }
  return parts.join(", ");
}

export function mergeAugEntries(entries) {
  const map = new Map();
  for (const e of entries) {
    const existing = map.get(e.name);
    if (!existing) {
      map.set(e.name, {
        name: e.name,
        price: e.price,
        repReq: e.repReq,
        factions: [e.faction],
        bestFaction: e.faction,
        bestRep: e.factionRep,
      });
    } else {
      existing.factions.push(e.faction);
      if (e.factionRep > existing.bestRep) {
        existing.bestRep = e.factionRep;
        existing.bestFaction = e.faction;
      }
    }
  }
  return [...map.values()];
}

export function classifyAug(aug, money, ownedState) {
  if (ownedState === "installed") return "INSTALLED";
  if (ownedState === "purchased") return "PENDING";
  if (aug.bestRep < aug.repReq) return "NEED REP";
  if (aug.price > money) return "NEED $";
  return "READY";
}

function collectAugEntries(ns) {
  const entries = [];
  for (const faction of ns.getPlayer().factions) {
    const factionRep = ns.singularity.getFactionRep(faction);
    for (const aug of ns.singularity.getAugmentationsFromFaction(faction)) {
      entries.push({
        name: aug,
        faction,
        price: ns.singularity.getAugmentationPrice(aug),
        repReq: ns.singularity.getAugmentationRepReq(aug),
        factionRep,
      });
    }
  }
  return entries;
}

/** @param {NS} ns */
export async function main(ns) {
  ns.disableLog("ALL");

  if (!hasSingularity(ns)) {
    ns.tprint("ERROR: Singularity API required (Source-File 4)");
    return;
  }

  const showOwned = ns.args[0] === "all";
  const owned = ns.singularity.getOwnedAugmentations(true);
  const installed = ns.singularity.getOwnedAugmentations(false);
  const money = ns.getPlayer().money;

  const augs = mergeAugEntries(collectAugEntries(ns)).sort((a, b) => b.price - a.price);

  tlog(ns, `\n=== Augmentations (${ns.getPlayer().factions.length} factions) ===`);
  tlog(ns, `Player money: ${formatMoney(money)}`);
  tlog(ns, `Prices are base values — each purchase multiplies remaining prices x1.9.`);
  tlog(ns, showOwned ? "" : "Owned augs hidden — pass 'all' to include them.");

  const counts = new Map();
  for (const aug of augs) {
    // NFG is level-scaling and always repurchasable, so never treat it as owned.
    const isNfg = aug.name === NFG;
    const ownedState = isNfg ? null : installed.includes(aug.name) ? "installed" : owned.includes(aug.name) ? "purchased" : null;
    if (ownedState && !showOwned) {
      counts.set(ownedState === "installed" ? "INSTALLED" : "PENDING", (counts.get(ownedState === "installed" ? "INSTALLED" : "PENDING") ?? 0) + 1);
      continue;
    }

    const tag = classifyAug(aug, money, ownedState);
    counts.set(tag, (counts.get(tag) ?? 0) + 1);

    const repNote =
      aug.bestRep >= aug.repReq
        ? `rep ${formatRep(aug.repReq)} OK @ ${aug.bestFaction}`
        : `rep ${formatRep(aug.repReq)} (have ${formatRep(aug.bestRep)} @ ${aug.bestFaction})`;
    tlog(ns, `[${tag}]`.padEnd(11) + `${aug.name}${isNfg ? " (repeatable)" : ""} — ${formatMoney(aug.price)} | ${repNote}`);

    const stats = formatAugStats(ns.singularity.getAugmentationStats(aug.name));
    if (stats) tlog(ns, `           ${stats}`);

    const missingPrereqs = ns.singularity.getAugmentationPrereq(aug.name).filter((p) => !owned.includes(p));
    if (missingPrereqs.length > 0) tlog(ns, `           requires first: ${missingPrereqs.join(", ")}`);
  }

  tlog(ns, "");
  const summary = [...counts.entries()].map(([tag, n]) => `${tag}: ${n}`).join(" | ");
  tlog(ns, `Total: ${augs.length} — ${summary}`);
  tlog(ns, `Buy with: run src/advanced/augmentation-buyer.js install`);
}
