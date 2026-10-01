// Company work exists in this suite for one reason: 400k reputation at a megacorp earns an
// invitation to its faction. Shared by advanced/faction-manager.js, which holds the jobs,
// and advanced/sleeve-manager.js, which works them.

/**
 * Megacorp → the faction its reputation unlocks. Same name everywhere except Fulcrum.
 * @type {Record<string, string>}
 */
export const COMPANY_FACTIONS = {
  ECorp: "ECorp",
  MegaCorp: "MegaCorp",
  "Bachman & Associates": "Bachman & Associates",
  "Blade Industries": "Blade Industries",
  NWO: "NWO",
  "Clarke Incorporated": "Clarke Incorporated",
  "OmniTek Incorporated": "OmniTek Incorporated",
  "Four Sigma": "Four Sigma",
  "KuaiGong International": "KuaiGong International",
  "Fulcrum Technologies": "Fulcrum Secret Technologies",
};

/**
 * Megacorps whose faction the player hasn't joined, i.e. where a job is still worth holding.
 *
 * @param {string[]} factions  player.factions
 * @returns {CompanyName[]}
 */
export function companiesToUnlock(factions) {
  const todo = Object.keys(COMPANY_FACTIONS).filter((c) => !factions.includes(COMPANY_FACTIONS[c]));
  return /** @type {CompanyName[]} */ (todo);
}

/**
 * Companies a sleeve should work: the player holds a job there (setToCompanyWork refuses
 * otherwise) and the company's faction is still locked.
 *
 * @param {Record<string, any>} jobs  player.jobs
 * @param {string[]} factions  player.factions
 * @returns {CompanyName[]}
 */
export function sleeveCompanies(jobs, factions) {
  return companiesToUnlock(factions).filter((c) => jobs[c] !== undefined);
}
