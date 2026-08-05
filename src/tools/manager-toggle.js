import { MANAGERS, PORTS } from "/src/lib/constants.js";
import { readPortData, writePortData } from "/src/lib/port-registry.js";

// Enable/disable individual daemon managers at runtime (written to the config overrides port,
// read by getConfig). A disabled manager is killed by the daemon if it's running and won't be
// relaunched until re-enabled — daemon.js itself and every other manager keep running normally.
//   run /src/tools/manager-toggle.js                   list every manager + its current status
//   run /src/tools/manager-toggle.js off faction        disable one (id or "Faction Manager" both work)
//   run /src/tools/manager-toggle.js off faction gang   disable several in one call
//   run /src/tools/manager-toggle.js off all            disable every manager
//   run /src/tools/manager-toggle.js on faction         re-enable one
//   run /src/tools/manager-toggle.js on all             re-enable every manager
//
// Use this when a manager is doing something you don't want right now — e.g. faction-manager
// cancelling whatever work you started in favor of its own faction grind — without shutting down
// the whole daemon.
/** @param {NS} ns */
export async function main(ns) {
  const overrides = /** @type {{ disabledManagers?: string[] }} */ (
    readPortData(ns, PORTS.CONFIG_OVERRIDES) || {}
  );
  const disabled = new Set(overrides.disabledManagers || []);

  const args = ns.args.map((a) => String(a).toLowerCase());
  const action = args[0] === "on" || args[0] === "off" ? args[0] : null;

  if (!action) {
    if (args.length > 0) ns.tprint(`manager-toggle: unrecognized command "${args[0]}" — use "on" or "off". Showing status instead.`);
    ns.tprint("manager-toggle: current status —");
    for (const m of MANAGERS) {
      ns.tprint(`  ${disabled.has(m.id) ? "⏸ disabled" : "▶ enabled "}  ${m.id.padEnd(14)} ${m.name}`);
    }
    ns.tprint('usage: manager-toggle.js <on|off> <id [id...]|all>');
    return;
  }

  const targets = args.slice(1);
  if (targets.length === 0) {
    ns.tprint(`manager-toggle: specify manager id(s) or "all" after "${action}".`);
    return;
  }

  const matchManager = (t) => MANAGERS.find((m) => m.id === t || m.name.toLowerCase() === t);
  const unknown = targets.filter((t) => t !== "all" && !matchManager(t));
  for (const t of unknown) {
    ns.tprint(`manager-toggle: unknown manager "${t}" — known ids: ${MANAGERS.map((m) => m.id).join(", ")}`);
  }

  const ids = targets.includes("all")
    ? MANAGERS.map((m) => m.id)
    : targets.map(matchManager).filter(Boolean).map((m) => m.id);

  for (const id of ids) {
    if (action === "off") disabled.add(id);
    else disabled.delete(id);
  }

  writePortData(ns, PORTS.CONFIG_OVERRIDES, { ...overrides, disabledManagers: [...disabled] });

  for (const id of ids) {
    const m = matchManager(id);
    ns.tprint(
      `manager-toggle: ${m.name} ${
        action === "off" ? "DISABLED (daemon will stop it next cycle)" : "ENABLED (daemon will relaunch it next cycle)"
      }.`
    );
  }
}
