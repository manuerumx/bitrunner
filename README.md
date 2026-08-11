# Bitrunner — Manual Run Reference

Most of this suite runs itself. You start **one** script (`daemon.js`) and it launches,
supervises, and restarts every manager automatically. This README lists only the scripts
you run **by hand** from the terminal.

> For architecture, strategy, and how each subsystem works, see **[BITRUNNER-GUIDE.md](BITRUNNER-GUIDE.md)**.

All scripts live under `/src/` in the game filesystem, so every command is `run src/...`.

---

## TL;DR

```
run src/daemon.js
```

That's the only thing you *need* to run. Everything below is optional or situational.

---

## 1. Start here — the only required script

| Command | Args | What it does |
|---------|------|--------------|
| `run src/daemon.js` | none | Master orchestrator. Launches and supervises all managers (hacking, rooting, servers, hacknet, contracts, and every unlocked advanced subsystem). Opens a status dashboard in the tail window. |

Run this once after a fresh start or after a reset. It self-scales to your available home RAM and unlocked APIs.

---

## 2. Augmentations & reset (manual on purpose — SF-4)

These are **not** auto-run, because installing augmentations triggers a soft reset — a decision you make, not a background loop.

| Command | What it does |
|---------|--------------|
| `run src/advanced/augmentation-buyer.js` | **Dry run.** Lists every aug you can afford (respects faction rep + the 1.9× price stacking). Buys nothing. |
| `run src/advanced/augmentation-buyer.js install` | Buys all affordable augs (most-expensive-first). Keeps leftover cash — **no** NeuroFlux, no reset. Safe to run repeatedly as money grows. |
| `run src/advanced/augmentation-buyer.js install nfg` | Same, then dumps all leftover money into NeuroFlux Governor levels. Only do this right before installing — each NFG level makes every other aug 1.9× pricier. |
| `run src/advanced/augmentation-buyer.js install reset` | Buys augs, dumps leftovers into NeuroFlux, then installs augmentations and reboots into `daemon.js` (**soft reset**). |
| `run src/tools/sell-stocks.js` | **Liquidator (run instead of the daemon).** Stops the daemon + stock-trader so nothing keeps buying, then sells each position the moment it's green. Loops until you're flat, then reports realized P/L. |
| `run src/tools/sell-stocks.js now` | Same, but **dumps every position immediately** — profit or loss. Use when you're resetting right now. |
| `run src/tools/reset-prep.js` | Pre-reset checklist: reports open stock positions (and points you to `sell-stocks.js`), installed/pending augs, faction rep & favor, money. Sells nothing. |
| `run src/tools/reset-prep.js go` | Force-sells any remaining stocks (safety net), installs augmentations, and resets. |

**Typical end-of-run flow:** kill the daemon → `sell-stocks.js` (cash out at a profit) → `augmentation-buyer.js install nfg` (buy + NFG money dump) → `reset-prep.js go` (install + reset). `sell-stocks.js` stops the daemon for you, and the daemon restarts automatically after the reset.

> Note: "I have the money" isn't enough to buy an aug — you also need the **faction reputation** for it. The daemon's faction-manager farms rep automatically; the buyer is left manual.

---

## 3. Utility tools — run anytime

| Command | Args | Requires | What it does |
|---------|------|----------|--------------|
| `run src/tools/monitor.js` | none | — | Live dashboard: money/sec, hacking level, home & botnet RAM, top targets, running scripts. |
| `run src/tools/analyze.js <hostname>` | hostname | — | Deep dive on one server: money/security, prep needs, HWGW batch breakdown & $/sec at 25/50/75%. |
| `run src/tools/find-contracts.js` | none | — | Scans the whole network for coding contracts (`.cct`) and lists type + tries remaining. |
| `run src/tools/connect.js <hostname>` | hostname | — | Prints a copy-paste `connect …; backdoor` chain to reach a server in the terminal. |
| `run src/tools/backdoor.js` | none | SF-4 | Auto-connects and backdoors every rootable server (faction servers first). |
| `run src/tools/deploy.js` | none | — | Copies the worker scripts to every rooted server. (Rooter does this automatically.) |
| `run src/tools/nuke-all.js` | none | — | One-shot: opens ports and nukes every server you can root right now. |
| `run src/tools/rename-servers.js` | none | — | One-shot: renames old `bitrunner-#` purchased servers to scientist names (see below). Kills a busy server's scripts if needed; the coordinator redeploys them next cycle. |
| `run src/managers/prep-server.js <target>` | hostname | — | Manually weaken/grow one target to min-security/max-money. Exits when prepped. |

`analyze.js`, `connect.js`, and `prep-server.js` **require a hostname argument** — running them bare just prints usage.

> 🧑‍🔬 **Fun note:** purchased servers are named after famous computer scientists — `turing`, `lovelace`, `hopper`, `dijkstra`, `von-neumann`… The server-buyer picks a random unused name from the hall of fame in `src/lib/server-names.js`, so your botnet reads like a CS syllabus. If the list ever runs dry, the game appends a number (`knuth-0`) and life goes on.

---

## 4. Optional

| Command | What it does |
|---------|--------------|
| `run -t <threads> src/share.js` | Donates RAM to boost faction reputation gain while working for a faction. Runs until you kill it. Use a thread count, e.g. `run -t 1000 src/share.js`. |

---

## Scripts you do **not** run by hand

- **Workers** — `hack.js`, `grow.js`, `weaken.js` — dispatched by the hack-coordinator with precise timing/thread args. Running them manually does nothing useful.
- **Managers** — `hack-coordinator.js`, `rooter.js`, `server-buyer.js`, `hacknet-manager.js`, `contract-solver.js`, and the advanced managers (`stock-trader.js`, `faction-manager.js`, `gang-manager.js`, `sleeve-manager.js`, `bladeburner-manager.js`, `corp-manager.js`) — all auto-launched by `daemon.js`.

You *can* launch a single manager by hand for testing (e.g. `run src/advanced/stock-trader.js`); the daemon detects it's already running and won't double-launch it. Advanced managers exit with an "API required" message if their Source File isn't unlocked.

---

## API / Source-File requirements at a glance

| Script | Needs |
|--------|-------|
| `augmentation-buyer.js`, `reset-prep.js`, `backdoor.js` | **SF-4** (Singularity) |
| `stock-trader.js` (auto) | WSE + TIX API (shorts need SF-8) |
| `faction-manager.js` (auto) | SF-4 |
| `gang-manager.js` (auto) | SF-2 / BitNode 2 |
| `corp-manager.js` (auto) | SF-3 / BitNode 3 |
| `bladeburner-manager.js` (auto) | SF-6 or SF-7 |
| `sleeve-manager.js` (auto) | SF-10 |
| Everything else | No Source File required |
