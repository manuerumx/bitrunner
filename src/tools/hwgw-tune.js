import { PORTS, DEFAULTS } from "/src/lib/constants.js";
import { readPortData, writePortData } from "/src/lib/port-registry.js";

// Tune the hack-coordinator's HWGW batching live (written to the config overrides port, read by
// getConfig). Depth per target per cycle = ceil(batchDuration / (batchSpacingMs*4)) * waves, capped
// at max. Higher = more income/sec but longer, less responsive cycles.
//
// `fit` and `min` control batch SIZE rather than depth. hackPercent is a ceiling: the coordinator
// shrinks the steal fraction until a batch fits poolFree/fit, because a grow leg costs
// ln(1/(1-p)) threads and a full-size batch on a rich low-growth server can exceed the whole
// botnet. Below `min` it gives up on HWGW for that target and preps/hacks instead.
//   run /src/tools/hwgw-tune.js                 print current vs default
//   run /src/tools/hwgw-tune.js waves 6         set hwgwBatchWaves
//   run /src/tools/hwgw-tune.js max 800         set hwgwMaxBatches
//   run /src/tools/hwgw-tune.js fit 6           set hwgwFitBatches (batches sized to fit the pool)
//   run /src/tools/hwgw-tune.js min 0.005       set hwgwMinHackPercent (floor on the steal fraction)
//   run /src/tools/hwgw-tune.js waves 6 max 800 set several at once
//   run /src/tools/hwgw-tune.js reset           clear all four overrides (back to constants.js)
/** @param {NS} ns */
export async function main(ns) {
  const overrides =
    /** @type {{ hwgwBatchWaves?: number, hwgwMaxBatches?: number, hwgwFitBatches?: number, hwgwMinHackPercent?: number }} */ (
      readPortData(ns, PORTS.CONFIG_OVERRIDES) || {}
    );

  const args = ns.args.map((a) => String(a).toLowerCase());
  if (args[0] === "reset") {
    const { hwgwBatchWaves, hwgwMaxBatches, hwgwFitBatches, hwgwMinHackPercent, ...rest } = overrides;
    void hwgwBatchWaves;
    void hwgwMaxBatches;
    void hwgwFitBatches;
    void hwgwMinHackPercent;
    writePortData(ns, PORTS.CONFIG_OVERRIDES, rest);
    ns.tprint("hwgw-tune: cleared overrides — back to constants.js defaults (takes effect next cycle).");
    return;
  }

  const next = { ...overrides };
  for (let i = 0; i < args.length - 1; i += 2) {
    const value = Number(args[i + 1]);
    if (!Number.isFinite(value) || value <= 0) {
      ns.tprint(`hwgw-tune: ignoring "${args[i]} ${args[i + 1]}" — value must be a positive number.`);
      continue;
    }
    if (args[i] === "waves") next.hwgwBatchWaves = Math.floor(value);
    else if (args[i] === "max") next.hwgwMaxBatches = Math.floor(value);
    else if (args[i] === "fit") next.hwgwFitBatches = Math.floor(value);
    else if (args[i] === "min") {
      // A steal FRACTION, not a batch count — must stay under the hackPercent ceiling, and a
      // floor of 0 would let the sizer converge on batches that steal nothing.
      if (value >= DEFAULTS.hackPercent) {
        ns.tprint(`hwgw-tune: ignoring "min ${args[i + 1]}" — must be below hackPercent (${DEFAULTS.hackPercent}).`);
        continue;
      }
      next.hwgwMinHackPercent = value;
    } else ns.tprint(`hwgw-tune: unknown key "${args[i]}" (use "waves", "max", "fit" or "min").`);
  }

  if (args.length > 0) writePortData(ns, PORTS.CONFIG_OVERRIDES, next);

  // Report under the CLI names, not the config keys, so the output doubles as the syntax to type.
  const KEYS = [
    ["waves", "hwgwBatchWaves"],
    ["max", "hwgwMaxBatches"],
    ["fit", "hwgwFitBatches"],
    ["min", "hwgwMinHackPercent"],
  ];
  const shown = KEYS.map(
    ([label, key]) => `${label}=${next[key] ?? DEFAULTS[key]}${next[key] === undefined ? " (default)" : ""}`
  );
  ns.tprint(`hwgw-tune: ${shown.join(", ")} (takes effect next cycle).`);
}
