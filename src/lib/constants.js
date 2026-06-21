export const PORTS = {
  DAEMON_HEARTBEAT: 1,
  HACK_COMMANDS: 2,
  STOCK_SIGNALS: 3,
  MONITOR_FEED: 4,
  CONFIG_OVERRIDES: 5,
  FACTION_STATUS: 6,
  STOCK_STATUS: 7,
  GANG_STATUS: 8,
  CORP_STATUS: 9,
  BLADEBURNER_STATUS: 10,
};

export const WORKER_SCRIPTS = ["/src/hack.js", "/src/grow.js", "/src/weaken.js", "/src/share.js"];

export const WORKER_RAM = {
  HACK: 1.7,
  GROW: 1.75,
  WEAKEN: 1.75,
};

export const PROGRAMS = [
  { name: "BruteSSH.exe", fn: "brutessh" },
  { name: "FTPCrack.exe", fn: "ftpcrack" },
  { name: "relaySMTP.exe", fn: "relaysmtp" },
  { name: "HTTPWorm.exe", fn: "httpworm" },
  { name: "SQLInject.exe", fn: "sqlinject" },
];

export const DEFAULTS = {
  hackPercent: 0.7,
  minSecurityThreshold: 5,
  moneyThreshold: 0.75,
  reservedHomeRAM: 32,
  purchasedServerRAM: 8,
  maxPurchasedServerRAM: 1048576,
  hacknetBudgetPercent: 0.1,
  stockBudgetPercent: 0.25,
  batchSpacingMs: 200,
  managerCycleMs: 5000,
  rooterCycleMs: 30000,
  serverBuyerCycleMs: 60000,
  hacknetCycleMs: 10000,
  // When true, hack-coordinator soaks ALL surplus RAM (home + idle botnet) with share() every
  // cycle, even if the faction-manager isn't reporting an active grind. Toggle at runtime with
  // tools/share-idle.js. share() only boosts rep while you're actually working for a faction.
  shareIdleRAM: false,
};
