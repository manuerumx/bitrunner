import { DEFAULTS, PORTS } from "/src/lib/constants.js";
import { readPortData } from "/src/lib/port-registry.js";

/** @param {NS} ns */
export function getConfig(ns) {
  const overrides = readPortData(ns, PORTS.CONFIG_OVERRIDES);
  if (overrides && typeof overrides === "object") {
    return { ...DEFAULTS, ...overrides };
  }
  return { ...DEFAULTS };
}

/**
 * Home RAM the hacking scripts leave free. DEFAULTS.reservedHomeRAM always; while a
 * corporation exists, also DEFAULTS.corpReservedHomeRAM, because the corp tools are big
 * one-shots the daemon can only launch into free home RAM. Without it the hacker filled home,
 * corp-office.js never ran, and the offices went without tea and parties until morale hit 10.
 *
 * @param {NS} ns
 * @returns {number} GB
 */
export function homeReserveRAM(ns) {
  return DEFAULTS.reservedHomeRAM + (ns.corporation.hasCorporation() ? DEFAULTS.corpReservedHomeRAM : 0);
}
