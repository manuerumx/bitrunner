import { PORTS } from "/src/lib/constants.js";
import { readPortData, writePortData } from "/src/lib/port-registry.js";

// Toggle the hack-coordinator's "soak surplus RAM for hacking EXP" override (written to the config
// overrides port, read by getConfig).
//   run /src/tools/xp-farm.js on     force it on
//   run /src/tools/xp-farm.js off    force it off
//   run /src/tools/xp-farm.js        toggle
//
// When ON, all RAM left over after HWGW/prep/hack-income runs xp.js (weaken-spam on the highest
// EXP/sec target) instead of share(). EXP and faction-rep compete for the same surplus, so this
// WINS over share() while on — share() earns zero hacking EXP. Turn it on when your goal is raising
// your hacking level; turn it off (and turn share-idle on) when you're grinding faction reputation.
/** @param {NS} ns */
export async function main(ns) {
  const overrides = /** @type {{ xpFarmRAM?: boolean }} */ (
    readPortData(ns, PORTS.CONFIG_OVERRIDES) || {}
  );
  const arg = String(ns.args[0] ?? "").toLowerCase();
  const on = arg === "on" ? true : arg === "off" ? false : !overrides.xpFarmRAM;

  writePortData(ns, PORTS.CONFIG_OVERRIDES, { ...overrides, xpFarmRAM: on });
  ns.tprint(
    `xp-farm: ${on ? "ON" : "OFF"} — hack-coordinator will ` +
      `${on ? "soak surplus RAM (home + botnet) with grow-spam for hacking EXP, overriding share()" : "stop the EXP farm (share() resumes if grinding a faction)"} ` +
      `(takes effect next cycle).`
  );
}
