import { PORTS } from "/src/lib/constants.js";
import { readPortData, writePortData } from "/src/lib/port-registry.js";

// Toggle the hack-coordinator's "soak idle RAM with share()" override (written to the config
// overrides port, read by getConfig).
//   run /src/tools/share-idle.js on     force it on
//   run /src/tools/share-idle.js off    force it off
//   run /src/tools/share-idle.js        toggle
//
// share() only speeds up reputation while you're actually working for a faction — turn it on
// when you're grinding rep so your idle home + botnet RAM gets put to use.
/** @param {NS} ns */
export async function main(ns) {
  const overrides = /** @type {{ shareIdleRAM?: boolean }} */ (
    readPortData(ns, PORTS.CONFIG_OVERRIDES) || {}
  );
  const arg = String(ns.args[0] ?? "").toLowerCase();
  const on = arg === "on" ? true : arg === "off" ? false : !overrides.shareIdleRAM;

  writePortData(ns, PORTS.CONFIG_OVERRIDES, { ...overrides, shareIdleRAM: on });
  ns.tprint(
    `share-idle: ${on ? "ON" : "OFF"} — hack-coordinator will ` +
      `${on ? "soak surplus RAM (home + botnet) with share() each cycle" : "stop forcing share()"} ` +
      `(takes effect next cycle).`
  );
}
