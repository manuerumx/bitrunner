# Bitrunner — Bitburner Automation Suite

A complete automation framework for [Bitburner](https://github.com/bitburner-official/bitburner-src), the programming-based incremental hacking game. Bitrunner automates every game system — from basic server hacking through endgame corporation management — using 32 modular NS2 scripts organized in 6 progressive phases.

---

## Table of Contents

1. [Quick Start](#quick-start)
2. [Architecture Overview](#architecture-overview)
3. [Script Reference](#script-reference)
   - [Micro-Workers](#micro-workers)
   - [Library Modules](#library-modules)
   - [Managers](#managers)
   - [Advanced Systems](#advanced-systems)
   - [Tools](#tools)
4. [How It Works](#how-it-works)
   - [The Daemon](#the-daemon)
   - [Proto-Batch Mode](#proto-batch-mode)
   - [HWGW Batch Mode](#hwgw-batch-mode)
   - [Inter-Script Communication](#inter-script-communication)
5. [Game Progression Strategy](#game-progression-strategy)
6. [Configuration](#configuration)
7. [Troubleshooting](#troubleshooting)

---

## Quick Start

1. **Upload** the `src/` directory into Bitburner (via the game's script editor or file sync).
2. **Run the daemon** from the terminal:
   ```
   run src/daemon.js
   ```
3. **Watch** the tail window — it shows money, hacking level, network stats, and manager statuses.
4. **Optional**: Open the monitor for a detailed live dashboard:
   ```
   run src/tools/monitor.js
   ```

That's it. The daemon automatically launches managers based on available home RAM, roots new servers as your hacking level rises, and scales income from zero to billions.

---

## Architecture Overview

```
┌──────────────────────────────────────────────────────┐
│                    daemon.js                         │
│            Master Orchestrator (home)                │
│  Launches, monitors, and restarts all managers       │
└──────────┬───────────┬───────────┬───────────────────┘
           │           │           │
    ┌──────▼──┐  ┌─────▼────┐  ┌──▼──────────┐
    │ rooter  │  │  hack-   │  │ server-     │  ...more managers
    │         │  │coordinator│  │ buyer       │
    └─────────┘  └────┬─────┘  └─────────────┘
                      │
          ┌───────────┼───────────┐
          │           │           │
     ┌────▼──┐  ┌─────▼──┐  ┌────▼────┐
     │hack.js│  │grow.js │  │weaken.js│   ← Micro-workers
     │(n thr)│  │(n thr) │  │(n thr)  │     deployed everywhere
     └───────┘  └────────┘  └─────────┘
```

### Design Principles

- **Modular**: Each game system has its own manager script. Install only what you need.
- **RAM-efficient**: Workers are tiny (~1.7 GB each). Heavy logic stays on home server.
- **Self-scaling**: The daemon detects available RAM and APIs, launching what fits.
- **Progressive**: Phase 1 scripts work on a fresh game. Advanced scripts activate as you unlock Source Files.
- **Resilient**: If a manager crashes, the daemon restarts it on the next cycle.

### File Layout

```
src/
├── hack.js, grow.js, weaken.js, share.js     ← Micro-workers
├── daemon.js                                  ← Master orchestrator
├── lib/                                       ← Shared libraries
│   ├── constants.js, utils.js, config.js
│   ├── scanner.js, target-selector.js
│   ├── port-registry.js, batch-calculator.js
├── managers/                                  ← Core subsystem managers
│   ├── rooter.js, hack-coordinator.js
│   ├── server-buyer.js, hacknet-manager.js
│   ├── prep-server.js, contract-solver.js
├── advanced/                                  ← Source-File-gated managers
│   ├── stock-trader.js, faction-manager.js
│   ├── augmentation-buyer.js, gang-manager.js
│   ├── sleeve-manager.js, corp-manager.js
│   └── bladeburner-manager.js
└── tools/                                     ← Standalone utilities
    ├── monitor.js, analyze.js, deploy.js
    ├── nuke-all.js, find-contracts.js
    ├── backdoor.js, reset-prep.js
```

---

## Script Reference

### Micro-Workers

These are the smallest possible scripts. They run on every rooted server in the network, executing a single hacking operation per invocation. Keeping them tiny maximizes the number of threads you can run.

| Script | RAM | Purpose |
|--------|-----|---------|
| `hack.js` | ~1.70 GB | Steals money from target server |
| `grow.js` | ~1.75 GB | Increases money available on target |
| `weaken.js` | ~1.75 GB | Reduces target's security level |
| `share.js` | ~4.00 GB | Donates idle RAM to boost faction rep gain |

**Arguments**: `args[0]` = target hostname, `args[1]` = optional delay in ms (used for HWGW batch timing).

You never run these manually — the hack-coordinator dispatches them via `ns.exec()`.

---

### Library Modules

Shared code imported by managers and tools. These have no `main()` function and cost 0 GB on their own — RAM cost is inherited by whatever imports them.

| Module | Purpose |
|--------|---------|
| `lib/constants.js` | Game constants, port assignments, default config values, worker script paths |
| `lib/utils.js` | Formatting helpers: `formatMoney()`, `formatRAM()`, `formatTime()`, `formatPercent()`, logging |
| `lib/scanner.js` | BFS network scanner: `scanNetwork()`, `getServerDetails()`, `getAllServers()`, `getPath()` |
| `lib/target-selector.js` | Ranks hackable servers by profitability score: `(maxMoney × hackChance × hackPercent) / weakenTime` |
| `lib/batch-calculator.js` | HWGW batch math: thread counts, timing offsets, prep requirements, server readiness check |
| `lib/port-registry.js` | Port communication helpers: `writePortData()`, `readPortData()`, `consumePortData()` |
| `lib/config.js` | Configuration loader: reads overrides from Port 5, merges with defaults |

---

### Managers

Persistent daemons that run on the home server. Each handles one game subsystem and loops on a configurable interval.

#### `managers/rooter.js` — Auto-Root Servers
- **Cycle**: Every 30 seconds
- **What it does**: Scans the entire network. For each un-rooted server, opens ports using available programs (`BruteSSH.exe`, `FTPCrack.exe`, etc.), then runs `nuke()` if enough ports are open. Deploys worker scripts to newly rooted servers.
- **Why it matters**: Expands your botnet automatically as your hacking level rises and you acquire new programs.

#### `managers/hack-coordinator.js` — Hacking Engine
- **Cycle**: Adaptive (waits for current batch to land)
- **What it does**: The brain of income generation. Operates in two modes:
  - **Proto-batch** (early game): Simple priority loop — weaken if security is high, grow if money is low, hack otherwise. Spreads work across all available RAM.
  - **HWGW batch** (mid/late game): Dispatches precision-timed Hack-Weaken-Grow-Weaken sequences that land 200ms apart, keeping the target at perfect conditions.
- **Auto-switching**: Uses HWGW when the primary target is "prepped" (min security, max money) and enough RAM is available. Falls back to proto-batch otherwise.

#### `managers/server-buyer.js` — Purchased Server Management
- **Cycle**: Every 60 seconds
- **What it does**: Buys servers up to the 25-server limit, then upgrades the smallest one. Never spends more than 50% of your cash on a single purchase. Deploys worker scripts automatically.
- **Strategy**: Starts with small servers (8 GB) to get RAM online fast, then doubles the smallest server's RAM each cycle.

#### `managers/hacknet-manager.js` — Hacknet Node Automation
- **Cycle**: Every 10 seconds
- **What it does**: Buys and upgrades hacknet nodes (level, RAM, cores) based on which upgrade has the lowest cost. Spends up to 10% of your money per cycle.
- **Strategy**: Always picks the cheapest available upgrade — buy a new node or upgrade an existing one, whichever is cheaper.

#### `managers/prep-server.js` — Server Preparation
- **Usage**: `run src/managers/prep-server.js <target>`
- **What it does**: Brings a target server to optimal hacking conditions — minimum security and maximum money. Runs weaken until security is at minimum, then alternates grow/weaken until money is maxed.
- **When to use**: The hack-coordinator handles this automatically, but you can run it manually to prep a specific target faster.

#### `managers/contract-solver.js` — Coding Contract Solver
- **Cycle**: Every 5 minutes
- **What it does**: Scans all servers for `.cct` files and auto-solves them. Implements 25+ contract types including array problems, stock trading variants, IP generation, path finding, graph coloring, compression, ciphers, and Hamming codes.
- **Why it matters**: Coding contracts give free money, faction rep, or faction invitations.

---

### Advanced Systems

These require specific Source Files or BitNode conditions. Each checks for API availability at startup and exits gracefully if unavailable.

#### `advanced/stock-trader.js` — Stock Market Bot
- **Requires**: WSE Account + TIX API Access (~$30B total investment)
- **Cycle**: Every 6 seconds (matches stock price update frequency)
- **Strategy with 4S data**: Buys stocks with forecast >55%, sells when forecast drops below 50%. Commission-aware — only trades when expected profit exceeds $200K.
- **Strategy without 4S**: Limited functionality (4S data strongly recommended).
- **Supports**: Long positions always. Short positions if SF-8 is unlocked.

#### `advanced/faction-manager.js` — Faction Work Automation
- **Requires**: Source-File 4 (Singularity API)
- **Cycle**: Every 30 seconds
- **What it does**: Accepts faction invitations, prioritizes factions by number of available augmentations, and works for the best faction (hacking contracts > field work > security work).

#### `advanced/augmentation-buyer.js` — Augmentation Purchasing
- **Requires**: Source-File 4
- **Usage**:
  - `run src/advanced/augmentation-buyer.js` — Dry run, shows what you can afford
  - `run src/advanced/augmentation-buyer.js install` — Purchases augmentations
  - `run src/advanced/augmentation-buyer.js install reset` — Purchases and installs (triggers soft reset)
- **Strategy**: Buys most expensive augmentations first (price multiplier stacking), then fills remaining money with NeuroFlux Governor levels.

#### `advanced/gang-manager.js` — Gang Operations
- **Requires**: Source-File 2 (or BitNode 2), gang must be created first
- **Cycle**: Every 10 seconds
- **What it does**: Recruits members, assigns tasks based on stats (training → mugging → human trafficking), buys equipment, ascends members when multiplier gain ≥1.5x, manages territory warfare (enables when win chance >55%).

#### `advanced/sleeve-manager.js` — Sleeve Automation
- **Requires**: Source-File 10
- **Cycle**: Every 30 seconds
- **What it does**: Assigns sleeves to optimal activities — shock recovery first, then synchronization, then faction work / gym training / crime based on sleeve index. Purchases sleeve augmentations when affordable (<1% of money).

#### `advanced/corp-manager.js` — Corporation Management
- **Requires**: Source-File 3 (or BitNode 3)
- **Cycle**: Every 10 seconds
- **What it does**: Manages divisions (starts with Agriculture), hires and assigns employees evenly across roles, upgrades warehouses, develops and sells products, buys corporate upgrades. The most RAM-heavy script (~30 GB).

#### `advanced/bladeburner-manager.js` — Bladeburner Operations
- **Requires**: Source-File 6 or 7
- **Cycle**: Every 5 seconds
- **What it does**: Manages stamina (trains when low), reduces chaos via diplomacy, attempts Black Ops when success chance ≥80%, runs operations/contracts based on success probability. Upgrades skills with priority on Blade's Intuition, Cloak, and Overclock.

---

### Tools

One-shot or dashboard utilities you run manually from the terminal.

#### `tools/monitor.js` — Live Dashboard
```
run src/tools/monitor.js
```
Opens a tail window showing:
- Money and income rate ($/sec)
- Hacking level
- Home RAM usage
- Network stats (rooted servers, botnet RAM utilization)
- Purchased servers and hacknet nodes
- Top 5 hacking targets with security/money status
- All running scripts on home with thread counts

#### `tools/analyze.js` — Server Analysis
```
run src/tools/analyze.js <hostname>
```
Deep analysis of a target server:
- Basic info (required hacking, ports, RAM, root/backdoor status)
- Current vs max money, current vs min security
- Hack chance, hack time, grow time, weaken time
- Prep requirements (threads needed to reach optimal state)
- HWGW batch breakdowns at 25%, 50%, 75% hack percentages with expected $/sec

#### `tools/deploy.js` — Deploy Workers
```
run src/tools/deploy.js
```
Copies worker scripts to all rooted servers. The rooter does this automatically, but useful for manual deployment after code changes.

#### `tools/nuke-all.js` — Mass Root
```
run src/tools/nuke-all.js
```
One-shot scan and root of every accessible server. Reports newly rooted, already rooted, and unreachable counts.

#### `tools/find-contracts.js` — Contract Scanner
```
run src/tools/find-contracts.js
```
Scans the entire network for coding contracts. Shows filename, server, contract type, and remaining attempts for each.

#### `tools/backdoor.js` — Auto-Backdoor (SF-4)
```
run src/tools/backdoor.js
```
Automatically connects to and backdoors every rootable server. Prioritizes faction-critical servers (CSEC, avmnite-02h, I.I.I.I, run4theh111z).

#### `tools/reset-prep.js` — Pre-Reset Checklist (SF-4)
```
run src/tools/reset-prep.js
```
Pre-augmentation reset report: sells all stocks, shows installed/pending augmentations, faction rep status, money summary. Use `run src/tools/reset-prep.js go` to install augmentations and trigger the soft reset.

---

## How It Works

### The Daemon

The daemon (`src/daemon.js`) is the single entry point. When you run it:

1. **Detects environment**: Checks home RAM, available APIs, installed scripts
2. **Launches managers** in priority order, skipping any that won't fit in RAM:
   1. Hack Coordinator (income engine)
   2. Rooter (network expansion)
   3. Server Buyer (RAM expansion)
   4. Hacknet Manager (passive income)
   5. Contract Solver (bonus rewards)
   6. Stock Trader, Faction Manager, Gang, Sleeves, Bladeburner, Corporation
3. **Monitors** every 5 seconds: restarts crashed managers, displays status dashboard
4. **Self-heals**: If a manager dies, daemon relaunches it on the next cycle

### Proto-Batch Mode

The early-game hacking strategy. Simple but effective with limited RAM.

**Logic per server per cycle:**
```
if security > minSecurity + 5 → weaken
else if money < maxMoney × 75% → grow
else → hack
```

All available RAM across all rooted servers is used. Threads are assigned to the best available target(s). After dispatching, sleeps until the longest operation completes.

**When it's used**: Always active as a fallback. Primary mode when targets aren't prepped or RAM is too low for full HWGW batches.

### HWGW Batch Mode

The optimized hacking strategy for mid/late game. Dispatches precisely timed batches where four operations land in sequence:

```
Time →
                                    ┌─────────┐
Hack    ─────────────────────────── │  LAND   │
                                    └────┬────┘  +0ms
                                         │
Weaken1 ──────────────────────────────── │LAND│  +200ms
                                         │
Grow    ─────────────────────────── ──── │LAND│  +400ms
                                         │
Weaken2 ──────────────────────────────── │LAND│  +600ms
```

**Why this order matters:**
1. Hack steals money (raises security)
2. Weaken1 counters the security increase from hack
3. Grow restores the money that was stolen
4. Weaken2 counters the security increase from grow

After all four land, the server is back to perfect conditions — ready for the next batch.

**Thread calculation** (per batch):
- `hackThreads`: Enough to steal `hackPercent` (default 50%) of max money
- `weaken1Threads`: Enough to counter hack's security increase
- `growThreads`: Enough to restore money from `(1 - hackPercent)` back to max
- `weaken2Threads`: Enough to counter grow's security increase

Multiple batches can run concurrently on the same target, staggered by `batchSpacingMs × 4`.

### Inter-Script Communication

Scripts communicate via **Netscript ports** (JSON-serialized data):

| Port | Purpose | Writer → Reader |
|------|---------|-----------------|
| 1 | Daemon heartbeat & status | daemon → monitor |
| 2 | Commands to hack coordinator | daemon → hack-coordinator |
| 3 | Hack/grow events for stock correlation | hack-coordinator → stock-trader |
| 4 | General data feed | all managers → monitor |
| 5 | Runtime configuration overrides | user/daemon → all managers |
| 6-10 | Subsystem status reports | advanced managers → daemon |

**Port protocol**: All data is `JSON.stringify()`'d on write and `JSON.parse()`'d on read. Status ports use `ns.peek()` (non-destructive) for polling; command ports use `ns.readPort()` (consuming).

---

## Game Progression Strategy

### Minutes 0-5: Bootstrap
- Run `src/daemon.js`
- Rooter immediately roots 0-port servers (n00dles, foodnstuff, sigma-cosmetics, joesguns, etc.)
- Hack-coordinator starts proto-batch hacking on `joesguns` (best early target: low security, decent money)

### Minutes 5-30: Early Growth
- Money starts flowing in
- Server-buyer purchases first 8 GB servers
- Hacknet-manager buys first nodes
- Your hacking level rises, unlocking more servers to root

### Minutes 30-120: Mid Game
- Acquire port-opening programs (purchase from darkweb or create):
  - `BruteSSH.exe` → 1 port
  - `FTPCrack.exe` → 2 ports
  - `relaySMTP.exe` → 3 ports
  - `HTTPWorm.exe` → 4 ports
  - `SQLInject.exe` → 5 ports (all servers accessible)
- Hack-coordinator transitions to HWGW batching
- Server-buyer upgrades purchased servers (64 GB → 256 GB → higher)
- Targets evolve: joesguns → phantasy → max-hardware → the-hub → omega-net

### Hours 2-8: Late Game
- Nearly every server is rooted, botnet is massive
- Top targets: ecorp, megacorp, fulcrumassets (max money servers)
- Income exceeds $1B/sec with optimal batching
- If WSE is accessible, stock-trader adds another income stream
- If SF-4 available, faction-manager grinds reputation

### Hour 8+: Endgame & Reset
- All priority augmentations are reputation-unlocked
- Run augmentation-buyer to purchase in optimal order
- Install augmentations (soft reset)
- Run `src/daemon.js` again — now faster with augmentation bonuses
- Each subsequent run is faster due to accumulated multipliers

### BitNode Progression Tips
- **First run**: Focus on hacking income and augmentations
- **BitNode 1** (default): Standard progression. Get SF-4 (Singularity) early for full automation
- **BitNode 2**: Unlocks Gang API — good for combat income
- **BitNode 4**: Unlocks Singularity API — essential for augmentation automation
- **BitNode 8**: Unlocks stock shorting
- **Recommended SF priority**: SF-4 > SF-1 > SF-2 > SF-5 > SF-10

---

## Configuration

Default values are in `src/lib/constants.js`. You can override them at runtime by writing to Port 5:

```javascript
// In the game terminal or a custom script:
ns.clearPort(5);
ns.writePort(5, JSON.stringify({
  hackPercent: 0.25,          // Steal 25% per batch (safer, more stable)
  reservedHomeRAM: 64,        // Reserve 64 GB on home for managers
  moneyThreshold: 0.9,        // Only hack when money is above 90% of max
}));
```

### Key Configuration Values

| Key | Default | Description |
|-----|---------|-------------|
| `hackPercent` | 0.5 | Fraction of max money to steal per HWGW batch (0.01–0.99) |
| `minSecurityThreshold` | 5 | Max security above minimum before proto-batch switches to weaken |
| `moneyThreshold` | 0.75 | Fraction of max money required before proto-batch will hack |
| `reservedHomeRAM` | 32 | GB reserved on home for managers (not used by workers) |
| `purchasedServerRAM` | 8 | Initial RAM for newly purchased servers (power of 2) |
| `maxPurchasedServerRAM` | 1048576 | Maximum RAM to upgrade purchased servers to (1 PB) |
| `hacknetBudgetPercent` | 0.1 | Max fraction of money to spend on hacknet per cycle |
| `stockBudgetPercent` | 0.25 | Max fraction of money to invest in stocks per cycle |
| `batchSpacingMs` | 200 | Milliseconds between HWGW batch landing times |

### Tuning Tips

- **Low RAM (< 64 GB home)**: Lower `reservedHomeRAM` to 16, or only run the hack-coordinator and rooter
- **Aggressive hacking**: Set `hackPercent` to 0.75 (more money per batch, but needs more grow threads)
- **Conservative hacking**: Set `hackPercent` to 0.1 (less money per batch, but very stable — good for stock manipulation)
- **Stock-aware hacking**: Set `hackPercent` low when stock-trader is active to minimize market disruption

---

## Troubleshooting

### "Module not found" errors
All import paths must match the game filesystem. If you uploaded scripts to `src/`, every import uses `/src/lib/...`, `/src/managers/...`, etc. If you moved scripts to root, imports should use `/lib/...`.

### Manager shows "STOPPED" in daemon
The daemon only launches managers that fit in available home RAM. Check the GB number shown — you need that much free RAM. Solutions:
- Upgrade home RAM (buy from the computer store or via augmentations)
- Kill other scripts to free RAM
- Lower `reservedHomeRAM` in config

### Hack-coordinator stuck in "PROTO(prepping)"
The primary target isn't at optimal conditions yet. This is normal — weakening and growing takes time, especially for high-security targets. You can speed it up by running `prep-server.js` manually on the target.

### No targets found
Your hacking level is too low to hack any rooted servers, or no servers are rooted. Wait for your hacking level to rise, or manually hack in the terminal to gain XP.

### Stock trader exits immediately
You need to purchase WSE Account and TIX API Access from the World Stock Exchange in-game. Total cost is approximately $30B.

### Advanced scripts exit with "API required" message
These require specific Source Files. You unlock them by completing BitNodes:
- **SF-2**: Gang API (complete BitNode 2)
- **SF-3**: Corporation API (complete BitNode 3)
- **SF-4**: Singularity API (complete BitNode 4)
- **SF-6/7**: Bladeburner API (complete BitNode 6 or 7)
- **SF-10**: Sleeve API (complete BitNode 10)

### Scripts not deploying to remote servers
The rooter deploys workers via `ns.scp()`. If a server has 0 GB RAM, it can't run scripts even with root access. This is normal — some servers are data-only.

### "Function removed in 3.0.0" warning
Bitburner 3.0 renamed `ns.tail()` to `ns.ui.openTail()`. This is a non-breaking warning — the script still runs. To silence it, replace `ns.tail()` with `ns.ui.openTail()` in `daemon.js`.
