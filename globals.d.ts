// The NetscriptDefinitions.d.ts that bitburner-filesync pulls from the game is a
// *module* (it has top-level `export`s), so its types are NOT global by default.
// This shim re-exposes the common ones in global scope so plain .js files can use
// `/** @param {NS} ns */` (and {Server}, {Player}, ...) without importing anything.
// Add a line here whenever you reference another Netscript type in JSDoc.
declare global {
  type NS = import("./NetscriptDefinitions").NS;
  type Server = import("./NetscriptDefinitions").Server;
  type Player = import("./NetscriptDefinitions").Player;

  // Enum string-literal types that the game validates strictly at runtime (a wrong
  // value throws). The underlying aliases aren't exported from the def file, so we
  // derive them from the NS method signatures that consume them.
  type BladeburnerActionType = Parameters<NS["bladeburner"]["startAction"]>[0];
  type BladeburnerActionName = Parameters<NS["bladeburner"]["startAction"]>[1];
  type FactionWorkType = Parameters<NS["sleeve"]["setToFactionWork"]>[2];
  type FactionName = Parameters<NS["sleeve"]["setToFactionWork"]>[1];
  type GymType = Parameters<NS["sleeve"]["setToGymWorkout"]>[2];
  type CrimeType = Parameters<NS["sleeve"]["setToCommitCrime"]>[1];
  type HacknetServerHashUpgrade = Parameters<NS["hacknet"]["spendHashes"]>[0];

  // Port IPC payloads — the JSON shapes passed through the netscript ports listed in
  // constants.js PORTS. Writers and readers both annotate against these so the contract
  // is type-checked across files (see src/lib/port-registry.js).
  interface FactionStatus {
    currentFaction: string | null;
    rep: number;
    targetRep: number;
    availableAugs: number;
  }
  interface GangStatus {
    members: number;
    income: number;
    territory: number;
    respect: number;
    wantedPenalty: number;
    warfare: boolean;
  }
  interface CorpStatus {
    revenue: number;
    expenses: number;
    profit: number;
    funds: number;
    divisions: number;
  }
  interface BladeburnerStatus {
    rank: number;
    action: string;
    stamina: string;
    skillPoints: number;
  }
  // Written by tools/stasis-worker.js from the darknet server, consumed by tools/stasis.js.
  interface StasisResult {
    host: string;
    mode: "link" | "unlink";
    success: boolean;
    code: number;
    message: string;
  }
}

export {};
