import { PORTS, DEFAULTS } from "/src/lib/constants.js";
import { readPortData, writePortData } from "/src/lib/port-registry.js";

// Tune the hack-coordinator's HWGW pipeline depth live (written to the config overrides port, read
// by getConfig). Depth per target per cycle = ceil(batchDuration / (batchSpacingMs*4)) * waves,
// capped at max. Higher = more income/sec but longer, less responsive cycles.
//   run /src/tools/hwgw-tune.js                 print current vs default
//   run /src/tools/hwgw-tune.js waves 6         set hwgwBatchWaves
//   run /src/tools/hwgw-tune.js max 800         set hwgwMaxBatches
//   run /src/tools/hwgw-tune.js waves 6 max 800 set both
//   run /src/tools/hwgw-tune.js reset           clear both overrides (back to constants.js)
/** @param {NS} ns */
export async function main(ns) {
  const overrides = /** @type {{ hwgwBatchWaves?: number, hwgwMaxBatches?: number }} */ (
    readPortData(ns, PORTS.CONFIG_OVERRIDES) || {}
  );

  const args = ns.args.map((a) => String(a).toLowerCase());
  if (args[0] === "reset") {
    const { hwgwBatchWaves, hwgwMaxBatches, ...rest } = overrides;
    void hwgwBatchWaves;
    void hwgwMaxBatches;
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
    else ns.tprint(`hwgw-tune: unknown key "${args[i]}" (use "waves" or "max").`);
  }

  if (args.length > 0) writePortData(ns, PORTS.CONFIG_OVERRIDES, next);

  const waves = next.hwgwBatchWaves ?? DEFAULTS.hwgwBatchWaves;
  const max = next.hwgwMaxBatches ?? DEFAULTS.hwgwMaxBatches;
  ns.tprint(
    `hwgw-tune: waves=${waves}${next.hwgwBatchWaves === undefined ? " (default)" : ""}, ` +
      `max=${max}${next.hwgwMaxBatches === undefined ? " (default)" : ""} ` +
      `(takes effect next cycle).`
  );
}
