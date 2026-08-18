// Darkweb shopping list. See docs/API-COVERAGE-AUDIT.md §5.1.
//
// rooter.js can only open as many ports as it has programs (constants.js PROGRAMS), and
// until now those were bought by hand — so root coverage stalled behind manual shopping.

/**
 * Which catalogue entries are not on home yet, in catalogue order.
 *
 * Order matters: the catalogue is cheapest-first, so a partial budget still buys the
 * programs that open the most ports per dollar. rooter.js uses whatever subset exists.
 *
 * Generic so a ProgramName[] catalogue survives the filter — ns.singularity.purchaseProgram
 * takes the literal union, not `string`.
 *
 * @template {string} T
 * @param {readonly T[]} catalog  program filenames, cheapest first
 * @param {readonly string[]} owned    filenames already present on home
 * @returns {T[]}
 */
export function selectProgramsToBuy(catalog, owned) {
  return catalog.filter((name) => !owned.includes(name));
}
