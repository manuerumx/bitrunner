import { PORTS } from "/src/lib/constants.js";

export function writePortData(ns, portNum, data) {
  const json = JSON.stringify(data);
  ns.clearPort(portNum);
  ns.writePort(portNum, json);
}

export function readPortData(ns, portNum) {
  const raw = ns.peek(portNum);
  if (raw === "NULL PORT DATA") return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

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
