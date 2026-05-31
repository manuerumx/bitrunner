import { DEFAULTS, PORTS } from "/src/lib/constants.js";
import { readPortData } from "/src/lib/port-registry.js";

export function getConfig(ns) {
  const overrides = readPortData(ns, PORTS.CONFIG_OVERRIDES);
  if (overrides && typeof overrides === "object") {
    return { ...DEFAULTS, ...overrides };
  }
  return { ...DEFAULTS };
}
