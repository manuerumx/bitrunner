import { SCIENTIST_NAMES, pickServerName } from "/src/lib/server-names.js";
import { tlog } from "/src/lib/utils.js";

/**
 * One-shot: rename existing purchased servers (e.g. bitrunner-0) to scientist names.
 * If a rename is rejected while the server is busy, its scripts are killed and the
 * rename retried — the coordinator redeploys workers on its next cycle.
 *
 * @param {NS} ns
 */
export async function main(ns) {
  let renamed = 0;
  let failed = 0;

  for (const hostname of ns.cloud.getServerNames()) {
    if (SCIENTIST_NAMES.includes(hostname)) continue;

    const newName = pickServerName(ns.cloud.getServerNames());
    let ok = ns.cloud.renameServer(hostname, newName);
    if (!ok) {
      ns.killall(hostname);
      ok = ns.cloud.renameServer(hostname, newName);
    }

    if (ok) {
      renamed++;
      tlog(ns, `RENAMED: ${hostname} -> ${newName}`);
    } else {
      failed++;
      tlog(ns, `FAILED: could not rename ${hostname}`);
    }
  }

  tlog(ns, `Done: ${renamed} renamed, ${failed} failed`);
}
