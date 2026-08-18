// Gate for the ns.formulas.* namespace.
//
// The formulas API itself costs 0 GB, but every call throws unless Formulas.exe is on
// home — so each use site needs a file check, not a try/catch after the fact.
// tools/program-buyer.js buys the file when the budget allows (it is in DARKWEB_EXTRAS),
// which is what gives that purchase a visible payoff.
//
// Deliberately NOT used in lib/batch-calculator.js. formulas.hacking.growThreads is exact
// where ns.growthAnalyze approximates, but the difference is a few threads per batch, and
// batch-calculator drives every HWGW batch the suite dispatches — up to hwgwMaxBatches per
// target per cycle through a timing-critical landing sequence. A Formulas-gated branch
// there would mean two code paths through the income engine, with the live one depending
// on whether Formulas.exe happens to be bought yet, so the tested path and the running
// path could silently differ. Considered and declined; see docs/API-COVERAGE-AUDIT.md §7.

export const FORMULAS_EXE = "Formulas.exe";

/**
 * Is the formulas API usable right now?
 * Costs 0.1 GB (ns.fileExists) at each call site that imports this.
 * @param {NS} ns
 */
export function hasFormulas(ns) {
  return ns.fileExists(FORMULAS_EXE, "home");
}
