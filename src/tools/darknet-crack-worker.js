import { pushPortData, PORTS } from "/src/lib/port-registry.js";

// Runs ON a cracked darknet server and heartbleeds one of its neighbours — heartbleed()
// only reaches servers directly connected to the server the script runs on, so it has to
// be shipped out there. Pushed and exec'd by tools/darknet-scan.js.
//
//   run /src/tools/darknet-crack-worker.js <target> [logLines]
//
// PEEK ONLY. `peek: true` reads the most recent log lines without consuming them, so a
// repeat capture can never destroy intel this run hasn't stored yet. This is Stage A of
// docs/API-COVERAGE-AUDIT.md §5.2: build a corpus of what these logs actually say. No
// password is guessed and authenticate() is never called — the server model list is
// "intentionally undocumented" per the API docs, so there is no evidence yet that a
// password is derivable from hint + format + length.
//
// The target arrives as an argument so the worker never pays for getServerDetails:
// 1.6 GB base + 0.6 GB heartbleed = 2.2 GB (lib/darknet.js CRACK_WORKER_RAM). Ports are free.

/** @param {NS} ns */
export async function main(ns) {
  const target = String(ns.args[0] ?? "");
  const logsToCapture = Number(ns.args[1] ?? 10);

  try {
    const result = await ns.dnet.heartbleed(target, { peek: true, logsToCapture });
    pushPortData(ns, PORTS.DNET_CRACK, {
      host: target,
      logs: result.logs ?? [],
      success: result.success,
      message: result.message,
    });
  } catch (err) {
    pushPortData(ns, PORTS.DNET_CRACK, {
      host: target,
      logs: [],
      success: false,
      message: String(err),
    });
  }
}
