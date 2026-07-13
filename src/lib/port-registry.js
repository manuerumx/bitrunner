import { PORTS } from "/src/lib/constants.js";

// Ports carry JSON payloads whose shapes are declared as the *Status interfaces in
// globals.d.ts. Reads come back as `unknown` on purpose: each call site must commit to a
// payload type (e.g. `/** @type {FactionStatus | null} */ (readPortData(...))`), and writers
// build a typed object first, so the producer and consumer are checked against one contract.

/**
 * @param {NS} ns
 * @param {number} portNum
 * @param {*} data  Annotate the caller's object against its port payload type.
 */
export function writePortData(ns, portNum, data) {
  const json = JSON.stringify(data);
  ns.clearPort(portNum);
  ns.writePort(portNum, json);
}

/**
 * Append a payload to a port WITHOUT clearing it — queue semantics, for many writers
 * feeding one consumer (vs writePortData's latest-state semantics).
 * @param {NS} ns
 * @param {number} portNum
 * @param {*} data  Annotate the caller's object against its port payload type.
 */
export function pushPortData(ns, portNum, data) {
  ns.writePort(portNum, JSON.stringify(data));
}

/**
 * Peek the latest payload on a port without consuming it.
 * @param {NS} ns
 * @param {number} portNum
 * @returns {unknown} `null` if the port is empty or holds invalid JSON.
 */
export function readPortData(ns, portNum) {
  const raw = ns.peek(portNum);
  if (raw === "NULL PORT DATA") return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Read and consume the next payload on a port.
 * @param {NS} ns
 * @param {number} portNum
 * @returns {unknown} `null` if the port is empty or holds invalid JSON.
 */
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
