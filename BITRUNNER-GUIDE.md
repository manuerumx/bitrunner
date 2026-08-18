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
   - [Surplus RAM: EXP vs Reputation](#surplus-ram-exp-vs-reputation)
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
├── hack.js, grow.js, weaken.js, share.js, xp.js  ← Micro-workers
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
    ├── backdoor.js, backdoor-next.js, reset-prep.js
    ├── list-augs.js                             ← augmentation catalog (SF-4)
    ├── hwgw-tune.js, xp-farm.js, share-idle.js  ← runtime config toggles
    ├── manager-toggle.js                        ← enable/disable daemon managers
    ├── stasis.js, stasis-worker.js             ← darknet stasis links
    ├── darknet-scan.js, darknet-probe-worker.js ← darknet mapping & cracking intel
    └── ipvgo.js                                 ← IPvGO subnet auto-player
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
| `xp.js` | ~1.75 GB | Loops `weaken()` forever on one target to farm hacking EXP |

**Arguments**: `args[0]` = target hostname, `args[1]` = optional delay in ms (used for HWGW batch timing). `share.js` and `xp.js` take no delay — they loop forever and are killed/re-filled by the hack-coordinator each cycle.

You never run these manually — the hack-coordinator dispatches them via `ns.exec()`.

---

### Library Modules

Shared code imported by managers and tools. These have no `main()` function and cost 0 GB on their own — RAM cost is inherited by whatever imports them.

| Module | Purpose |
|--------|---------|
| `lib/constants.js` | Game constants, port assignments, default config values, worker script paths |
| `lib/utils.js` | Formatting helpers: `formatMoney()`, `formatRAM()`, `formatTime()`, `formatPercent()`, logging |
| `lib/scanner.js` | BFS network scanner: `scanNetwork()`, `getServerDetails()`, `getAllServers()`, `getPath()` |
| `lib/target-selector.js` | Ranks hackable servers two ways: by money (`selectTargets`, score `maxMoney × chance / weakenTime^0.3`) and by hacking-EXP throughput (`selectXPTarget`, score `(3 + 0.3 × baseDifficulty) / weakenTime`) |
| `lib/batch-calculator.js` | HWGW batch math: thread counts, timing offsets, prep requirements, server readiness check |
| `lib/port-registry.js` | Port communication helpers: `writePortData()`, `readPortData()`, `consumePortData()` |
| `lib/config.js` | Configuration loader: reads overrides from Port 5, merges with defaults |
| `lib/darknet.js` | Darknet (`ns.dnet`) plumbing: password store (`/data/darknet-passwords.txt`), server map (`/data/darknet-map.txt`), stasis-link planner (`planStasisLinks()`), map merger (`mergeDarknetMap()`), candidate builder |

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
- **Surplus RAM**: HWGW against a handful of targets can't consume a large botnet, so leftover RAM is soaked each cycle — either by `xp.js` (hacking EXP) when `xpFarmRAM` is on, or by `share.js` (faction reputation) while grinding a faction. See [Surplus RAM: EXP vs Reputation](#surplus-ram-exp-vs-reputation).

#### `managers/server-buyer.js` — Purchased Server Management
- **Cycle**: Every 60 seconds
- **What it does**: Buys servers up to the 25-server limit, then upgrades the smallest one. Never spends more than 50% of your cash on a single purchase. Deploys worker scripts automatically.
- **Strategy**: Starts with small servers (8 GB) to get RAM online fast, then doubles the smallest server's RAM each cycle.

#### `managers/hacknet-manager.js` — Hacknet Node Automation
- **Cycle**: Every 10 seconds
- **What it does**: Buys and upgrades hacknet nodes (level, RAM, cores) by best payback ratio, spending up to 10% of your money per cycle. On BitNodes with Hacknet **Servers**, it also spends accumulated **hashes** every cycle so they never cap out and waste.
- **Money strategy**: Picks the upgrade with the lowest payback time (cost ÷ extra production), not the cheapest — and buys one new node per cycle so the node count keeps growing.
- **Hash strategy**: Buys a capped number of *Reduce Minimum Security* + *Increase Maximum Money* on the richest rooted server each cycle (compounds HWGW yield), then drains everything left to *Sell for Money*. No-op when hashes don't exist (`hashCapacity() === 0`).

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
  - `run src/advanced/augmentation-buyer.js install` — Purchases augmentations, keeps leftover money (no NeuroFlux)
  - `run src/advanced/augmentation-buyer.js install nfg` — Purchases augmentations, then dumps leftover money into NeuroFlux Governor levels (for manual installs)
  - `run src/advanced/augmentation-buyer.js install reset` — Purchases (including the NeuroFlux dump) and installs (triggers soft reset)
- **Strategy**: Buys most expensive augmentations first (price multiplier stacking). NeuroFlux Governor is only bought with `nfg` or `reset`, as a final money dump: each NFG level multiplies every *other* aug's price by 1.9× as well, so dumping early would price the rest of the catalog out of reach.

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
- Darknet stasis links in use vs the global limit (hidden until you have darknet access)
- Surplus-RAM modes: XP-farm and share() toggle state, plus live `xp.js`/`share.js` thread counts across home + botnet
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

#### `tools/list-augs.js` — Augmentation Catalog (SF-4)
```
run src/tools/list-augs.js        # augs you don't own yet
run src/tools/list-augs.js all    # include purchased/installed augs
```
Lists every augmentation offered by your joined factions — including ones you lack the reputation for (which `augmentation-buyer.js` hides). Each aug shows base price, rep requirement vs. your best faction's rep, stat multipliers, and unmet prerequisite augs. Tags: `READY` (buyable now), `NEED $`, `NEED REP`, `PENDING` (purchased, awaiting install), `INSTALLED`. NeuroFlux Governor is always listed since it's repurchasable.

#### `tools/reset-prep.js` — Pre-Reset Checklist (SF-4)
```
run src/tools/reset-prep.js
```
Pre-augmentation reset report: sells all stocks, shows installed/pending augmentations, faction rep status, money summary. Use `run src/tools/reset-prep.js go` to install augmentations and trigger the soft reset.

#### `tools/backdoor-next.js` — Connect to the Next Server to Backdoor (no SF-4)
```
run src/tools/backdoor-next.js
```
For manual backdooring before you have the Singularity API. Finds the best server you can currently backdoor — rooted, your hacking level ≥ its requirement, and not already backdoored — prioritizing faction-invite servers (CSEC, avmnite-02h, I.I.I.I, run4theh111z), then easiest by required level. It **auto-connects** you to that server by injecting the `connect` chain into the terminal (so you just type `backdoor`), and always prints the full `home; connect …; backdoor` chain as a copy-paste fallback plus the list of other reachable targets. Re-run it after each backdoor to walk through them. `w0r1d_d43m0n` is never auto-connected (backdooring it ends the BitNode) — it's only ever shown with a warning.

#### `tools/xp-farm.js` — Toggle the EXP Farm
```
run src/tools/xp-farm.js on     # surplus RAM → hacking EXP
run src/tools/xp-farm.js off    # back to share() (faction rep)
run src/tools/xp-farm.js        # toggle
```
Flips the `xpFarmRAM` config override (Port 5). When on, the hack-coordinator soaks all surplus RAM with `xp.js` (weaken-spam on the best EXP/sec target) instead of `share()`. Takes effect next cycle. See [Surplus RAM: EXP vs Reputation](#surplus-ram-exp-vs-reputation).

#### `tools/share-idle.js` — Toggle Forced `share()`
```
run src/tools/share-idle.js on / off
```
Flips the `shareIdleRAM` override — forces `share()` to soak surplus RAM even when the faction-manager isn't reporting an active grind. Has no effect while the EXP farm is on (the EXP farm wins).

#### `tools/manager-toggle.js` — Enable/Disable Daemon Managers
```
run src/tools/manager-toggle.js                   # list every manager + its current status
run src/tools/manager-toggle.js off faction        # disable one (id or "Faction Manager" both work)
run src/tools/manager-toggle.js off faction gang   # disable several in one call
run src/tools/manager-toggle.js off all            # disable every manager
run src/tools/manager-toggle.js on faction         # re-enable one
run src/tools/manager-toggle.js on all             # re-enable every manager
```
Flips the `disabledManagers` override — the daemon kills a disabled-but-running manager and won't relaunch it until re-enabled, while `daemon.js` and every other manager keep running. Use this when a manager is doing something you don't want right now — e.g. the faction manager cancelling whatever work you started in favor of its own grind — without shutting down the whole daemon. Manager ids: `hack`, `rooter`, `server-buyer`, `hacknet`, `contracts`, `stock`, `faction`, `gang`, `sleeve`, `bladeburner`, `corp`.

#### `tools/hwgw-tune.js` — Tune HWGW Pipeline Depth
```
run src/tools/hwgw-tune.js                 # print current vs default
run src/tools/hwgw-tune.js waves 6         # set hwgwBatchWaves
run src/tools/hwgw-tune.js max 800         # set hwgwMaxBatches
run src/tools/hwgw-tune.js reset           # clear overrides
```
Live-tunes how many HWGW batches the coordinator stacks per target per cycle. Higher = more income/sec but longer, less responsive cycles. RAM is still the hard limiter.

#### `tools/stasis.js` — Darknet Stasis Links
```
run src/tools/stasis.js                    # status: links vs limit, candidates, skip reasons
run src/tools/stasis.js auto               # fill every free slot with the best candidates
run src/tools/stasis.js link n00dles-dk hunter2   # link one server (password saved on success)
run src/tools/stasis.js unlink n00dles-dk  # remove a link, freeing a global slot
```
Darknet servers mutate on a cycle: they move, restart (killing your scripts), or go offline — often permanently. A stasis link (`ns.dnet.setStasisLink()`) pins a server in place and doubles as a permanent remote-exec route to it. Links are globally capped (`getStasisLinkLimit()`, raised by deep-darknet augmentations), so `lib/darknet.js` plans which servers deserve a slot: deepest first (hardest to re-find), then highest difficulty. Stationary story servers are skipped — they can't move, so a link there is wasted.

Mechanics worth knowing:
- `setStasisLink()` only acts on the server the script is running on, so `stasis.js` authenticates (`connectToSession`), copies `stasis-worker.js` over, and execs it there. The worker needs **13.6 GB free** on the target (1.6 base + 12 for the call) and reports its verdict back on Port 11.
- Remote exec on a darknet server requires a session **plus** a route: direct connection, backdoor, or an existing stasis link.
- Sessions are per-PID, so every run re-authenticates from the password store at `/data/darknet-passwords.txt` (host → password JSON). The store doubles as our registry of known darknet servers; `tools/darknet-scan.js` grows it and status/auto pick up everything it maps.
- If the worker doesn't fit but the owner is hogging RAM, the status output says so — free it with `ns.dnet.memoryReallocation()`.

#### `tools/darknet-scan.js` — Darknet Mapping & Cracking Intel
```
run src/tools/darknet-scan.js              # crawl, update /data/darknet-map.txt, print discoveries
run src/tools/darknet-scan.js intel        # cracking intel for every uncracked server, shallow first
```
`ns.dnet.probe()` only sees the *current* server's neighbors, so the darknet can only be mapped from within. The scan probes from home, then ships a 1.9 GB probe worker (base 1.6 + probe 0.2 + getServerDetails 0.1) to every known server we can exec on and merges all reports — reports travel back on Port 12 with queue semantics so they can't clobber each other. Each mapped server records its cracking intel: password hint, format and length, required heartbleed charisma, depth, difficulty. Stale map entries are kept — a server that mutated out of view isn't necessarily gone.

Mapped servers flow into `stasis.js` automatically (they show up as `no-password` candidates until cracked). The passwords themselves stay a human job — hints are puzzles by design. The loop is: **scan → read intel → crack → `stasis.js link` → `stasis.js auto` → scan deeper from the newly linked server.**

#### `tools/ipvgo.js` — IPvGO Auto-Player
```
run src/tools/ipvgo.js
```
Plays IPvGO subnet games back-to-back on a 13×13 board, rotating through the opponent factions in `OPPONENTS` — each win grants permanent stat bonuses (node power), scaling with opponent difficulty. Strategy per game: build a two-eyed base against a board edge (a shaft one row inside the edge, sealing columns at both ends, and a divider splitting the edge row into two eyes), expand outward from the base with scored moves (open-corridor length × lane preference × crowding penalty), then fill every remaining empty node except the protected eye points and pass until the game ends. Each finished game logs the final score before moving to the next faction.

Mechanics worth knowing:
- Every move goes through a guard that catches illegal-move errors (suicide, ko) and skips the point. The game prints its own red `go.makeMove: … It is illegal …` line before our `WARN: move rejected` — that's normal, mostly from the fill stage probing holes inside opponent territory, and a rejected attempt doesn't consume the turn.
- The script deliberately avoids `ns.go.analysis.getValidMoves()` — it costs 8 GB of RAM; the try/catch guard is free.
- A board too rugged to host a base (no viable edge streak) is rerolled after 500 ms against the **same** opponent — board generation is time-seeded — so difficult factions don't get silently skipped.
- Base spots are chosen flank-aware: an interior streak needs 5 open cells (the two sealing columns each consume one), while a streak against the board edge or dead nodes needs only 4.

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

### Surplus RAM: EXP vs Reputation

On a large botnet, HWGW saturates only a handful of targets — the rest of your RAM is surplus. Phase 4 of the hack-coordinator puts that surplus to work, but **`share()` and the XP farm compete for the same RAM**, so only one runs at a time:

| Mode | Worker | Earns | Toggle |
|------|--------|-------|--------|
| **EXP farm** | `xp.js` | Hacking EXP (raises your level) | `tools/xp-farm.js on` |
| **Reputation** | `share.js` | Faction rep (while working for a faction) | `tools/share-idle.js on`, or automatic while a faction grind is active |

**Why this matters for EXP**: hacking EXP per thread is `3 + 0.3 × baseDifficulty` — driven by the target's *base* difficulty, **independent of money stolen and current security**. `share()` earns **zero** hacking EXP, so leaving it on while you want levels is what stalls EXP growth on a big botnet. When `xpFarmRAM` is on, it **wins** over `share()`.

**Why the farm uses `weaken()`**: hack/grow/weaken all grant the same EXP per thread, so the only thing that matters is op time — and op time scales with the target's *current* security. `weaken()` is the only op that lowers security, so it pins the target at minimum and keeps op time at its floor (fastest, self-stabilizing). A grow/hack farm would instead slam the target to max security and run at its slowest rate forever. `selectXPTarget` then picks the server with the best EXP/sec = `(3 + 0.3 × baseDifficulty) / weakenTime`.

**Rule of thumb**: turn the EXP farm **on** while you're pushing your hacking level; turn it **off** (and let `share()` run) while you're grinding faction reputation.

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
| 11 | Stasis-link verdicts | stasis-worker (on darknet server) → stasis.js |
| 12 | Probe reports (queued, not cleared) | darknet-probe-worker (on darknet servers) → darknet-scan.js |

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
| `hashTargetUpgradesPerCycle` | 2 | Max purchases per cycle of each targeted hash upgrade (rest drained to money) |
| `stockBudgetPercent` | 0.25 | Max fraction of money to invest in stocks per cycle |
| `batchSpacingMs` | 200 | Milliseconds between HWGW batch landing times |
| `hwgwBatchWaves` | 4 | HWGW pipeline depth multiplier per target (tune with `hwgw-tune.js`) |
| `hwgwMaxBatches` | 500 | Hard cap on HWGW batches per target per cycle |
| `xpFarmRAM` | false | Soak surplus RAM with the EXP farm instead of `share()` (toggle with `xp-farm.js`) |
| `shareIdleRAM` | false | Force `share()` on surplus RAM even without an active faction grind (toggle with `share-idle.js`) |
| `disabledManagers` | `[]` | Manager ids the daemon won't launch (and will kill if running) — toggle with `manager-toggle.js` |

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

### Hacking level rising slowly
On a large botnet, HWGW only saturates a few targets and the rest of your RAM goes to `share()` — which earns money/rep but **zero hacking EXP**. Turn on the EXP farm to convert that surplus into levels:
```
run src/tools/xp-farm.js on
```
This makes the coordinator weaken-spam the best EXP/sec server with all leftover RAM. Note that EXP depends on a target's *base difficulty*, not its money or current security — so money-farming progress and EXP progress are separate levers. Turn the farm off again when you switch back to grinding faction reputation. See [Surplus RAM: EXP vs Reputation](#surplus-ram-exp-vs-reputation).

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
