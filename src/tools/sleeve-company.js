import { MANAGERS, PORTS } from "/src/lib/constants.js";
import { readPortData, writePortData } from "/src/lib/port-registry.js";
import { assignCompanies } from "/src/lib/sleeves.js";
import { promotionBlockers, rankBySalary, workableCompanies } from "/src/lib/companies.js";
import { formatMoney, log, tlog } from "/src/lib/utils.js";

// Put every sleeve to work for a company and climb the Business track to Chief Executive
// Officer, the best-paid title, for the salary.
//
//   run /src/tools/sleeve-company.js        take over the sleeves (stops sleeve-manager.js)
//   run /src/tools/sleeve-company.js stop   stop, and hand the sleeves back to sleeve-manager.js
//
// A sleeve has no job of its own: it works the player's job at that company, paid by the
// player's title and the sleeve's own stats. So the promotion to CEO is the player's — it
// needs the company's rep, which the sleeve earns, and the player's charisma and hacking,
// which it does not. The log lists whatever blocks each next promotion.
//
// Taking a Business job replaces a Software one at the same company (one job each).
// faction-manager.js keeps whichever field is held, so the two don't swap it back and forth.
//
// While it runs, sleeve-manager.js is disabled the same way `manager-toggle.js off sleeve`
// does it, or the daemon would relaunch it and the two would fight over the sleeves. That
// also means no shock recovery and no sleeve augmentations until `stop`.

const SELF = "/src/tools/sleeve-company.js";
const CEO = /** @type {JobName} */ ("Chief Executive Officer");
const SLEEVE_MANAGER = /** @type {(typeof MANAGERS)[number]} */ (MANAGERS.find((m) => m.id === "sleeve"));

/**
 * Turn sleeve-manager.js off or back on in the daemon's config overrides.
 *
 * @param {NS} ns
 * @param {boolean} enabled
 */
function setSleeveManager(ns, enabled) {
  const overrides = /** @type {{ disabledManagers?: string[] }} */ (
    readPortData(ns, PORTS.CONFIG_OVERRIDES) || {}
  );
  const disabled = new Set(overrides.disabledManagers || []);
  if (enabled) disabled.delete(SLEEVE_MANAGER.id);
  else disabled.add(SLEEVE_MANAGER.id);
  writePortData(ns, PORTS.CONFIG_OVERRIDES, { ...overrides, disabledManagers: [...disabled] });
}

/**
 * Other running copies of a script, whatever their arguments. ns.ps, not ns.isRunning: a
 * script is keyed by filename plus arguments, so isRunning would miss `run x.js stop`.
 *
 * @param {NS} ns
 * @param {string} script
 */
function others(ns, script) {
  return ns.ps("home").filter((p) => p.filename.replace(/^\//, "") === script.replace(/^\//, "") && p.pid !== ns.pid);
}

/**
 * The CEO salary at a company, or null where there is no such position: the call throws.
 *
 * @param {NS} ns
 * @param {CompanyName} company
 */
function ceoSalary(ns, company) {
  try {
    return ns.singularity.getCompanyPositionInfo(company, CEO).salary;
  } catch {
    return null;
  }
}

const short = (n) => formatMoney(n).slice(1);

/**
 * One line per company: the player's title and what blocks the next promotion.
 *
 * @param {NS} ns
 * @param {CompanyName[]} companies
 * @param {Player} player
 */
function report(ns, companies, player) {
  return companies.map((company) => {
    const title = player.jobs[company];
    const info = ns.singularity.getCompanyPositionInfo(company, title);
    if (title === CEO || !info.nextPosition) return `${company}: ${title} (${formatMoney(info.salary)}/s, top)`;
    const next = ns.singularity.getCompanyPositionInfo(company, info.nextPosition);
    const blockers = promotionBlockers(next, ns.singularity.getCompanyRep(company), player.skills);
    const why = blockers.map((b) => `${b.stat} ${short(b.have)}/${short(b.need)}`).join(", ");
    return `${company}: ${title} → ${next.name}${why ? ` needs ${why}` : " next cycle"}`;
  });
}

/** @param {NS} ns */
export async function main(ns) {
  ns.disableLog("ALL");

  if (ns.args[0] === "stop") {
    for (const p of others(ns, SELF)) ns.kill(p.pid);
    setSleeveManager(ns, true);
    tlog(ns, "sleeve-company: stopped; sleeve-manager.js re-enabled (the daemon relaunches it next cycle)");
    return;
  }

  try {
    ns.sleeve.getNumSleeves();
  } catch {
    tlog(ns, "sleeve-company: ERROR: needs the Sleeve API (Source-File 10)");
    return;
  }
  if (others(ns, SELF).length > 0) {
    tlog(ns, "sleeve-company: already running");
    return;
  }

  setSleeveManager(ns, false);
  for (const p of others(ns, SLEEVE_MANAGER.script)) ns.kill(p.pid);

  // Salaries are fixed per company, so the ranking is read once.
  const ranked = rankBySalary(
    Object.values(ns.enums.CompanyName).map((company) => ({ company, salary: ceoSalary(ns, company) })),
  );
  tlog(ns, `sleeve-company: running; sleeve-manager.js disabled. Best CEO pay: ${ranked.slice(0, 3).join(", ")}`);

  let lastReport = "";
  while (true) {
    const numSleeves = ns.sleeve.getNumSleeves();
    const targets = ranked.slice(0, numSleeves);

    // Hires the player, or promotes them once they qualify; null when nothing changes.
    for (const company of targets) {
      try {
        const job = ns.singularity.applyToCompany(company, "Business");
        if (job) log(ns, `${company}: now ${job}`);
      } catch {}
    }

    const player = ns.getPlayer();
    const workable = workableCompanies(targets, player.jobs);
    const live = [];
    for (let i = 0; i < numSleeves; i++) live.push(ns.sleeve.getTask(i));

    // A sleeve already at a target keeps it: moving it would restart its work. Sleeves
    // left without a company keep whatever they were doing.
    const assigned = assignCompanies(
      live.map((task, i) => ({
        sleeveNum: i,
        eligible: true,
        current: task?.type === "COMPANY" ? task.companyName : null,
      })),
      workable,
    );
    for (const [i, company] of assigned) {
      if (!company || (live[i]?.type === "COMPANY" && live[i].companyName === company)) continue;
      let started = false;
      try {
        started = ns.sleeve.setToCompanyWork(i, /** @type {CompanyName} */ (company));
      } catch {}
      log(ns, started ? `Sleeve ${i}: working at ${company}` : `Sleeve ${i}: ${company} refused the sleeve`);
    }

    let lines = [];
    try {
      lines = report(ns, workable, player);
    } catch (e) {
      lines = [`status unavailable: ${e}`];
    }
    const text = lines.join("\n") || "no company job yet (charisma or hacking too low to be hired?)";
    if (text !== lastReport) {
      for (const line of text.split("\n")) log(ns, line);
      lastReport = text;
    }

    await ns.sleep(30000);
  }
}
