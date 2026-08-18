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
  DNET_STASIS: 11,
  DNET_PROBE: 12,
  DNET_CRACK: 13,
  GO_CHEAT: 14,
};

// Single source of truth for the daemon's manager roster, shared with tools/manager-toggle.js so
// the toggle tool's valid ids always match what the daemon actually launches. `id` is the short
// name used on the command line and in DEFAULTS.disabledManagers.
//
// `oneShot: true` marks a script that does its job and exits rather than looping. The daemon has
// no scheduler, so these ride its relaunch machinery instead: the script exits, the daemon counts
// three immediate-exits, locks it, and RELOCK_RETRY_CYCLES clears the lock ~5 min later — a burst
// of runs every five minutes, which is the right cadence for shopping. The flag exists so the
// dashboard can render that steady state as ⏱ IDLE instead of the 🔒 LOCKED used for a genuinely
// unavailable subsystem (see lib/manager-health.js). One-shots MUST be idempotent: they run about
// three times per burst.
export const MANAGERS = [
  { id: "hack", script: "/src/managers/hack-coordinator.js", name: "Hack Coordinator", priority: 1, phase: 1 },
  { id: "rooter", script: "/src/managers/rooter.js", name: "Rooter", priority: 2, phase: 1 },
  { id: "programs", script: "/src/tools/program-buyer.js", name: "Program Buyer", priority: 2.5, phase: 2, oneShot: true },
  { id: "home-ram", script: "/src/tools/home-upgrader.js", name: "Home Upgrader", priority: 2.6, phase: 2, oneShot: true },
  { id: "server-buyer", script: "/src/managers/server-buyer.js", name: "Server Buyer", priority: 3, phase: 2 },
  { id: "hacknet", script: "/src/managers/hacknet-manager.js", name: "Hacknet Manager", priority: 4, phase: 2 },
  { id: "contracts", script: "/src/managers/contract-solver.js", name: "Contract Solver", priority: 5, phase: 3 },
  { id: "market-access", script: "/src/tools/market-access.js", name: "Market Access", priority: 5.5, phase: 4, oneShot: true },
  { id: "stock", script: "/src/advanced/stock-trader.js", name: "Stock Trader", priority: 6, phase: 4 },
  { id: "faction", script: "/src/advanced/faction-manager.js", name: "Faction Manager", priority: 7, phase: 5 },
  { id: "gang", script: "/src/advanced/gang-manager.js", name: "Gang Manager", priority: 8, phase: 6 },
  { id: "sleeve", script: "/src/advanced/sleeve-manager.js", name: "Sleeve Manager", priority: 9, phase: 6 },
  { id: "bladeburner", script: "/src/advanced/bladeburner-manager.js", name: "Bladeburner", priority: 10, phase: 6 },
  { id: "corp", script: "/src/advanced/corp-manager.js", name: "Corporation", priority: 11, phase: 6 },
  { id: "corp-boost", script: "/src/tools/corp-boost.js", name: "Corp Boost", priority: 11.5, phase: 6, oneShot: true },
];

export const WORKER_SCRIPTS = ["/src/hack.js", "/src/grow.js", "/src/weaken.js", "/src/share.js", "/src/xp.js"];

export const WORKER_RAM = {
  HACK: 1.7,
  GROW: 1.75,
  WEAKEN: 1.75,
};

// Port openers, cheapest first — the order tools/program-buyer.js buys them in, so a
// partial budget still buys the programs that open the most ports per dollar.
/** @type {{name: ProgramName, fn: string}[]} */
export const PROGRAMS = [
  { name: "BruteSSH.exe", fn: "brutessh" },
  { name: "FTPCrack.exe", fn: "ftpcrack" },
  { name: "relaySMTP.exe", fn: "relaysmtp" },
  { name: "HTTPWorm.exe", fn: "httpworm" },
  { name: "SQLInject.exe", fn: "sqlinject" },
];

// Darkweb purchases that aren't port openers — they unlock subsystems rather than servers,
// so rooter.js ignores them but program-buyer.js still buys them. Bought after the port
// openers because rooting is the more urgent bottleneck.
//   Formulas.exe            — exact hacking/dnet math (ns.formulas.*), 0 GB API but file-gated
//   DarkscapeNavigator.exe  — darknet access; ns.dnet.isDarknetServer is documented as the one
//                             dnet call that does NOT require it, implying the rest do
// Availability is not guaranteed in every BitNode: program-buyer.js tolerates a name the
// darkweb doesn't stock rather than failing the run.
/** @type {ProgramName[]} */
export const DARKWEB_EXTRAS = ["Formulas.exe", "DarkscapeNavigator.exe"];

export const DEFAULTS = {
  hackPercent: 0.7,
  minSecurityThreshold: 5,
  moneyThreshold: 0.75,
  reservedHomeRAM: 32,
  purchasedServerRAM: 8,
  // No maxPurchasedServerRAM here on purpose: server-buyer.js reads the real per-server
  // ceiling from ns.cloud.getRamLimit() (0.05 GB). Hardcoding 1 PB was wrong if this fork's
  // cap differs from vanilla or scales with progression.
  hacknetBudgetPercent: 0.1,
  // Hash-bar fill fraction at which hacknet-manager buys a cache upgrade. Cache adds no
  // production, so it's only worth money as evidence hashes are being wasted between
  // spend cycles. Below this the drain loop is keeping up. See pickCacheUpgrade.
  hacknetCacheFillThreshold: 0.8,
  // Max purchases per cycle of each targeted hash upgrade (Reduce Minimum Security / Increase Maximum
  // Money) the hacknet-manager buys on the richest server. Bounded so one cycle can't dump the whole
  // hash reserve into a single target; whatever's left is drained to money so hashes never cap out.
  // No-op on BitNodes without hacknet servers (no hashes exist). See managers/hacknet-manager.js.
  hashTargetUpgradesPerCycle: 2,
  stockBudgetPercent: 0.25,
  // Fraction of cash each one-shot buyer may spend per burst; the rest stays liquid for
  // server-buyer.js and augmentation-buyer.js. See docs/API-COVERAGE-AUDIT.md §5.
  // Port openers top out around $250m and unblock rooting, so they get a wide budget.
  programBudgetPercent: 0.5,
  // Home RAM gates how many managers the daemon can launch at all (daemon.js refuses any
  // script that doesn't fit), so it competes hard for cash.
  homeUpgradeBudgetPercent: 0.5,
  // 4S Market Data TIX API is the $25b rung of the ladder; without a cap it would drain
  // the wallet the whole suite shares.
  marketAccessBudgetPercent: 0.5,
  // Sleeves and sleeve memory are permanent (memory survives an install), but they compete
  // with augmentations, so a small slice per cycle.
  sleeveBudgetPercent: 0.1,
  // Boost materials multiply a division's production while held. Targets are per city and
  // deliberately modest — an overfilled warehouse stalls production outright.
  //
  // KEY ORDER IS PRIORITY. planBoostPurchases walks these in insertion order and consumes
  // the free warehouse space as it goes, so on a small warehouse the later keys get starved.
  // Real Estate is last because it is by far the bulkiest; if you are running an industry
  // where it dominates the multiplier (rather than Agriculture, where it doesn't), move it
  // to the front.
  corpBoostTargets: { Hardware: 125, Robots: 10, "AI Cores": 75, "Real Estate": 2700 },
  // Fraction of a warehouse left empty for output goods after boost materials are stocked.
  corpWarehouseHeadroom: 0.4,
  batchSpacingMs: 200,
  // HWGW pipeline depth per target per cycle. The old flat cap of 100 batches was wrong for both
  // ends: it under-filled slow high-tier targets (whose long weakenTime needs >100 batches just to
  // keep the pipeline full) and over-filled fast targets (100 batches = an absurd multi-minute cycle
  // for a 1s-weaken server). hwgwBatchWaves self-sizes the depth to each target's batch timing —
  // `waves` copies of the "pipeline-full" depth (batchDuration / (batchSpacingMs*4)). Higher waves =
  // closer to max income/sec but longer cycles (less responsive). hwgwMaxBatches caps the depth so a
  // very slow target can't stretch one cycle into many minutes (stale batch params, slow reprep).
  // Tune live via tools/config overrides (PORTS.CONFIG_OVERRIDES); RAM is still the hard limiter.
  hwgwBatchWaves: 4,
  hwgwMaxBatches: 500,
  managerCycleMs: 5000,
  rooterCycleMs: 30000,
  serverBuyerCycleMs: 60000,
  hacknetCycleMs: 10000,
  // When true, hack-coordinator soaks ALL surplus RAM (home + idle botnet) with share() every
  // cycle, even if the faction-manager isn't reporting an active grind. Toggle at runtime with
  // tools/share-idle.js. share() only boosts rep while you're actually working for a faction.
  shareIdleRAM: false,
  // When true, hack-coordinator soaks ALL surplus RAM (home + idle botnet) with the xp.js weaken-farm
  // instead of share(), pointed at the highest EXP/sec target (see selectXPTarget). Toggle at runtime
  // with tools/xp-farm.js. xpFarmRAM and share() compete for the same surplus, so xpFarmRAM WINS when
  // on — share() earns zero hacking EXP, so leaving it on is what stalls levelling on a big botnet.
  xpFarmRAM: false,
  // Manager ids (see MANAGERS above) the daemon should not launch — and should kill if it finds
  // one already running. Toggle at runtime with tools/manager-toggle.js. Use this to stop a
  // manager from acting (e.g. faction-manager overriding your current work with its own grind)
  // without shutting down the whole daemon.
  disabledManagers: [],
};
