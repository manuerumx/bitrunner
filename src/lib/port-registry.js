// @ts-check
import { PORTS } from "/src/lib/constants.js";

/** @param {NS} ns */
export function writePortData(ns, portNum, data) {
  const json = JSON.stringify(data);
  ns.clearPort(portNum);
  ns.writePort(portNum, json);
}

/** @param {NS} ns */
export function readPortData(ns, portNum) {
  const raw = ns.peek(portNum);
  if (raw === "NULL PORT DATA") return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** @param {NS} ns */
export function consumePortData(ns, portNum) {
  const raw = ns.readPort(portNum);
  if (raw === "NULL PORT DATA") return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export { PORTS };
