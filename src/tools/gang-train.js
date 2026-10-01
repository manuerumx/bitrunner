import { PORTS } from "/src/lib/constants.js";
import { readPortData, writePortData } from "/src/lib/port-registry.js";

// Toggle the gang-manager's "train now" override (written to the config overrides port, read by
// getConfig).
//   run /src/tools/gang-train.js on     every member trains
//   run /src/tools/gang-train.js off    normal task assignment resumes
//   run /src/tools/gang-train.js        toggle
//
// While ON, every gang member trains its gang's stat — Train Combat, or Train Hacking for a hacking
// gang — instead of earning, clearing wanted or building power. It stays on until turned off, and
// the manager keeps recruiting, ascending and buying gear meanwhile, so there's no need to stop it.
/** @param {NS} ns */
export async function main(ns) {
  const overrides = /** @type {{ gangTrainNow?: boolean }} */ (
    readPortData(ns, PORTS.CONFIG_OVERRIDES) || {}
  );
  const arg = String(ns.args[0] ?? "").toLowerCase();
  const on = arg === "on" ? true : arg === "off" ? false : !overrides.gangTrainNow;

  writePortData(ns, PORTS.CONFIG_OVERRIDES, { ...overrides, gangTrainNow: on });
  ns.tprint(
    `gang-train: ${on ? "ON — every gang member trains" : "OFF — normal task assignment resumes"} ` +
      `(takes effect next cycle).`
  );
}
