// @ts-check
const SUFFIXES = ["", "k", "m", "b", "t", "q", "Q"];

export function formatMoney(n) {
  if (n === 0) return "$0";
  const negative = n < 0;
  n = Math.abs(n);
  let idx = 0;
  while (n >= 1000 && idx < SUFFIXES.length - 1) {
    n /= 1000;
    idx++;
  }
  const formatted = idx === 0 ? n.toFixed(0) : n.toFixed(2);
  return `${negative ? "-" : ""}$${formatted}${SUFFIXES[idx]}`;
}

export function formatRAM(gb) {
  if (gb < 1024) return `${gb.toFixed(1)} GB`;
  if (gb < 1024 * 1024) return `${(gb / 1024).toFixed(1)} TB`;
  return `${(gb / (1024 * 1024)).toFixed(1)} PB`;
}

export function formatTime(ms) {
  if (ms < 1000) return `${ms.toFixed(0)}ms`;
  const s = Math.floor(ms / 1000) % 60;
  const m = Math.floor(ms / 60000) % 60;
  const h = Math.floor(ms / 3600000);
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export function formatPercent(n) {
  return `${(n * 100).toFixed(1)}%`;
}

/** @param {NS} ns */
export function log(ns, msg) {
  ns.print(`[${new Date().toLocaleTimeString()}] ${msg}`);
}

/** @param {NS} ns */
export function tlog(ns, msg) {
  ns.tprint(`[${new Date().toLocaleTimeString()}] ${msg}`);
}
