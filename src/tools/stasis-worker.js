import { writePortData, PORTS } from "/src/lib/port-registry.js";

// Runs ON a darknet server — ns.dnet.setStasisLink() only acts on the script's current
// server, so tools/stasis.js scp+execs this there. The hostname is passed as an arg
// instead of calling ns.getHostname() to keep RAM at exactly 1.6 (base) + 12
// (setStasisLink) = 13.6 GB; getHostname would add another 0.05.
//   run /src/tools/stasis-worker.js <"link"|"unlink"> <host>
/** @param {NS} ns */
export async function main(ns) {
  const mode = ns.args[0] === "unlink" ? "unlink" : "link";
  const host = String(ns.args[1] ?? "?");

  const result = await ns.dnet.setStasisLink(mode === "link");

  /** @type {StasisResult} */
  const payload = {
    host,
    mode,
    success: result.success,
    code: result.code,
    message: result.message,
  };
  writePortData(ns, PORTS.DNET_STASIS, payload);
  ns.toast(
    `stasis ${mode} ${host}: ${result.success ? "OK" : result.message}`,
    result.success ? "success" : "error",
    8000
  );
}
