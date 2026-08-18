import { MANAGERS } from "/src/lib/constants.js";
import { ramVerdict } from "/src/lib/manager-health.js";
import { formatRAM } from "/src/lib/utils.js";

// What every manager actually costs, and which ones can never launch.
//
//   run /src/tools/ram-report.js          per-manager RAM against home
//   run /src/tools/ram-report.js api      per-function RAM for the expensive namespaces
//
// Why this exists: daemon.js refuses to launch a script that doesn't fit in free home RAM,
// retries three times, then marks it 🔒 LOCKED — the same symbol it uses for "missing
// Source File". A manager that outgrew home is therefore indistinguishable from one whose
// subsystem is unavailable, and stays that way silently for the whole run.
//
// It also settles the open question in docs/API-COVERAGE-AUDIT.md §1: every
// ns.corporation.* function is documented at 20 GB, which would put corp-manager.js near
// 400 GB. `api` mode asks the game directly instead of trusting the docs.
//
// Free: getFunctionRamCost and getScriptRam are 0 GB and 0.1 GB respectively.

// Fully-qualified names (no leading `ns.`) for the namespaces whose documented costs decide
// whether a subsystem is affordable at all. Singularity entries are quoted at their base
// cost and multiplied 16/4/1 by Source-File 4 level.
const API_SAMPLES = [
  "corporation.buyMaterial",
  "corporation.setMaterialMarketTA2",
  "corporation.getCorporation",
  "corporation.hireEmployee",
  "singularity.purchaseTor",
  "singularity.purchaseProgram",
  "singularity.upgradeHomeRam",
  "singularity.getDarkwebProgramCost",
  "sleeve.purchaseSleeve",
  "sleeve.getTask",
  "stock.purchase4SMarketDataTixApi",
  "dnet.heartbleed",
  "dnet.authenticate",
  "hasTorRouter",
];

/** @param {NS} ns */
function reportApiCosts(ns) {
  ns.tprint("\n=== Per-function RAM, as the game charges it ===");
  for (const name of API_SAMPLES) {
    let cost;
    try {
      cost = ns.getFunctionRamCost(name);
    } catch {
      ns.tprint(`  ${name.padEnd(38)} unavailable in this BitNode`);
      continue;
    }
    ns.tprint(`  ${name.padEnd(38)} ${formatRAM(cost)}`);
  }
  ns.tprint("\nCompare against NetscriptDefinitions.d.ts: a mismatch means the doc figure is");
  ns.tprint("nominal, and docs/API-COVERAGE-AUDIT.md §5.5 can be planned against the real one.");
}

/** @param {NS} ns */
export async function main(ns) {
  if (String(ns.args[0] ?? "").toLowerCase() === "api") {
    reportApiCosts(ns);
    return;
  }

  const maxRam = ns.getServerMaxRam("home");
  const freeRam = maxRam - ns.getServerUsedRam("home");

  ns.tprint(`\n=== Manager RAM vs home (${formatRAM(freeRam)} free / ${formatRAM(maxRam)}) ===`);

  let impossible = 0;
  for (const manager of MANAGERS) {
    if (!ns.fileExists(manager.script)) {
      ns.tprint(`  ${manager.name.padEnd(18)} — not installed`);
      continue;
    }
    const ram = ns.getScriptRam(manager.script);
    const verdict = ramVerdict({ ram, freeRam, maxRam });
    if (verdict === "impossible") impossible++;
    const tag = manager.oneShot ? " (one-shot)" : "";
    ns.tprint(`  ${manager.name.padEnd(18)} ${formatRAM(ram).padStart(10)}  ${verdict}${tag}`);
  }

  ns.tprint("\n  ok         fits right now");
  ns.tprint("  blocked    fits home, but not while the botnet is this busy — daemon will retry");
  ns.tprint("  impossible larger than home itself; the daemon will lock it forever");
  ns.tprint("  unknown    ns.getScriptRam() returned 0 — the file failed to parse");
  ns.tprint("\n  ok/blocked are a SNAPSHOT — free RAM was read while this report was running,");
  ns.tprint("  and a one-shot buyer mid-burst can hold 50-75 GB. Re-run to see it move.");
  ns.tprint("  `impossible` is the durable signal: it compares against total home RAM.");

  if (impossible > 0) {
    ns.tprint(
      `\n⚠ ${impossible} manager(s) can never launch at this home size. They show as ` +
        `🔒 LOCKED on the daemon dashboard, identical to a missing Source File.`
    );
  }
  ns.tprint("\nRun with `api` to see per-function costs (settles the corporation figure).");
}
