// Company work in this suite: 400k reputation at a megacorp earns an invitation to its
// faction. Shared by advanced/faction-manager.js, which holds the jobs, and
// advanced/sleeve-manager.js, which works them. tools/sleeve-company.js works companies
// for the salary instead (helpers at the bottom).

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

// Company work for its own sake: tools/sleeve-company.js climbs the Business track to Chief
// Executive Officer and keeps a sleeve on every company where the player holds a job.

/** Business-track titles, intern to CEO. */
const BUSINESS_JOBS = [
  "Business Intern",
  "Business Analyst",
  "Business Manager",
  "Operations Manager",
  "Chief Financial Officer",
  "Chief Executive Officer",
];

/**
 * The field to re-apply in at a company. The player holds one job per company and applying
 * in another field swaps it, so a Business job stays Business; anything else is Software.
 *
 * @param {string | undefined} title  player.jobs[company]
 * @returns {"Business" | "Software"}
 */
export function companyJobField(title) {
  return title !== undefined && BUSINESS_JOBS.includes(title) ? "Business" : "Software";
}

/**
 * Companies that have the position, best-paid first.
 *
 * @param {Array<{company: string, salary: number | null}>} entries  salary null = no such position
 * @returns {CompanyName[]}
 */
export function rankBySalary(entries) {
  const ranked = entries.filter((e) => e.salary !== null).sort((a, b) => b.salary - a.salary);
  return /** @type {CompanyName[]} */ (ranked.map((e) => e.company));
}

/**
 * The targets a sleeve can work: setToCompanyWork refuses a company where the player
 * holds no job. Keeps target order, so the best-paid companies get sleeves first.
 *
 * @param {string[]} targets
 * @param {Record<string, any>} jobs  player.jobs
 * @returns {CompanyName[]}
 */
export function workableCompanies(targets, jobs) {
  return /** @type {CompanyName[]} */ (targets.filter((c) => jobs[c] !== undefined));
}

/**
 * What stops the player's next promotion: the company rep first, then each skill below
 * the position's requirement. Empty when applyToCompany would promote.
 *
 * @param {{requiredReputation: number, requiredSkills: Player["skills"]}} next
 * @param {number} rep  the player's reputation with the company
 * @param {Player["skills"]} skills
 * @returns {Array<{stat: string, have: number, need: number}>}
 */
export function promotionBlockers(next, rep, skills) {
  const blockers = [];
  if (rep < next.requiredReputation) blockers.push({ stat: "rep", have: rep, need: next.requiredReputation });
  for (const [stat, need] of Object.entries(next.requiredSkills)) {
    const have = skills[/** @type {keyof Player["skills"]} */ (stat)] ?? 0;
    if (have < need) blockers.push({ stat, have, need });
  }
  return blockers;
}
