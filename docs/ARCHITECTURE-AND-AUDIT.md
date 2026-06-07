# Bitrunner — Architecture & Efficiency Audit

**Date:** 2026-06-06
**Scope:** Full source tree under `src/` (33 scripts, ~3,150 LOC).
**Method:** Multi-agent audit — 8 subsystem auditors + a dedicated RAM‑distribution
deep‑dive, with adversarial verification of every high/critical finding, then synthesis.
50 findings were raised; 3 were **refuted** by verification (documented in §7 so they are
not "fixed" by mistake).

> **The question that started this:** *"Scripts are only executed on my `home` and the
> purchased (`bitrunner-*`) instances."* — Answered in §1 and §4. Short version: it is a
> **load‑distribution artifact, not a missing-file bug.** The small rooted servers are
> rooted, have the worker files, and are in the worker pool — they just never get picked.

> **Implemented 2026-06-07** (working tree, not committed):
> - **Batch 1 — allocation & deploy:** **F‑1/F‑15/F‑20/F‑31** (the allocation fix —
>   smallest‑first with `home` last, §4.3); **F‑30** (nuke‑all deploys workers after nuke);
>   **F‑34** (nuke‑all hacking‑level gate removed).
> - **Batch 2 — file‑presence/exec hardening:** **F‑2/F‑16/F‑22** — `execWorker` now
>   self‑heals (deploy‑and‑retry once on `pid===0`, then logs if it still fails), closing the
>   fresh‑start race so the coordinator no longer depends on the rooter; **F‑3b/F‑21** — the
>   rooter deploys on `!fileExists` instead of an in‑memory Set (self‑healing, restart‑safe);
>   **F‑26** — contract‑solver now skips contracts with ≤1 try left and blacklists any contract
>   a solver got wrong, so it can no longer burn a contract's tries over successive cycles.
>
> - **Batch 3 — contract correctness:** **F‑27** — replaced the greedy LZ Compression III
>   solver with a port of Bitburner's optimal `comprLZEncode` (DP over chunk states).
>   *Verified offline* against an independent Dijkstra shortest‑encoding solver + round‑trip
>   decode over 66,291 inputs (exhaustive small + random large) — 0 failures. It now solves
>   these contracts instead of failing/skipping them.
>
> - **Batch 4 — consolidation & economy:** **F‑33** — extracted `src/lib/deployer.js`
>   (`deployWorkers` / `ensureWorkers`); rooter, server‑buyer, deploy, nuke‑all, and the
>   coordinator now all route through it (`ns.scp` lives in one place). **F‑37** — stock‑trader
>   decrements a running budget across symbols instead of sizing each against the full 25 %.
>   **F‑38** — faction‑manager advances to the next faction with augs still needing rep instead
>   of idling once the top faction is maxed. **F‑48** — corp‑manager now calls
>   `acceptInvestmentOffer` for material early rounds instead of only logging them.
>
> - **Batch 5 — polish (efficiency/robustness/small correctness):** **F‑8** hoist repeated
>   `getServerMaxMoney` in `calculateBatch`; **F‑9** clamp negative HWGW delays; **F‑19** drop
>   dead `scanner.getAllServers`; **F‑29** guard the 3 grid solvers against empty matrices;
>   **F‑25** hacknet buys multiple upgrades/cycle within budget; **F‑39** stock short value uses
>   market price; **F‑40** drop dead `maxShares − shares` arithmetic; **F‑42** faction auto‑join
>   respects mutually‑exclusive city factions; **F‑43** NeuroFlux loop drops the 100‑cap and
>   hoists invariant lookups; **F‑46/F‑49** gang/bladeburner hoist per‑cycle NS calls out of
>   loops; **F‑47** sleeve assignment falls back to crime instead of silently idling; **F‑50**
>   corp hoists funds, drops dead constants, collision‑free product names.
>
> All touched files pass `node --check`. Verify in‑game with `ns.ps("n00dles")` (workers spread)
> and the contract tail (no repeated FAILED). **Still open** (deliberately deferred — design
> calls or very low value): F‑5 daemon stat throttle, F‑17a coordinator scan caching, F‑28
> contract type caching, F‑24 server‑buyer micro‑opt, F‑35 analyze label, F‑36 reset‑prep
> commission, and the strategy choices F‑17 `share()` and F‑18 `config` wiring/removal. The 3
> refuted findings (§7) stay untouched.

---

## 1. TL;DR — why workers only run on `home` + purchased servers

The dispatcher in [`hack-coordinator.js`](../src/managers/hack-coordinator.js) builds its
worker pool from **every** rooted server (correctly), then **sorts it by free RAM,
largest‑first** ([`getAllWorkerServers` line 32](../src/managers/hack-coordinator.js#L32))
and fills greedily from the front, stopping the instant demand is met
([`allocateThreads` line 56](../src/managers/hack-coordinator.js#L56)).

`home` (minus the 32 GB reserve) and your purchased cloud servers (which `server-buyer`
upgrades toward **1 PB each**) sit permanently at the head of that list and dwarf the small
network servers (n00dles 4 GB, foodnstuff 16 GB, …). Crucially, **`allocateThreads` is
called once per operation** — each HWGW batch fires 4 separate calls (H, W1, G, W2), and
every call restarts iteration *from the front of the descending list*. A single operation
usually needs only a handful of threads, so it is satisfied entirely on `home` before the
loop index ever advances to a small server. The small servers are reached only in the rare
cycle where one operation's thread demand exceeds the **combined** free RAM of every larger
host ahead of it — which, with a big home/cloud, effectively never happens.

**Net effect:** workers visibly land only on `home` + purchased servers; the rooted network
RAM is dead weight. This is **confirmed** — independently reported by 4 of the 8 auditors and
upheld under adversarial verification.

**A second, independent cause to rule out:**
[`tools/nuke-all.js`](../src/tools/nuke-all.js) roots servers but **never `scp`s the worker
files** to them. If you root the network with `nuke-all.js` (without also running
`deploy.js` or relying on the rooter), every host it rooted has root + RAM but no worker
scripts, so `ns.exec` silently returns 0 there and that RAM is never used. See §4.2.

→ **The fix is in §4.3.** It's a ~15‑line change to `allocateThreads`.

---

## 2. Architecture overview

A four‑layer, home‑supervised system. Everything is launched and watched by one daemon.

```
                       ┌───────────────────────────────────────────┐
  LAYER 1  Supervisor  │  daemon.js  (runs on home, 5s loop)        │
                       │  launches + relaunches managers,           │
                       │  lock/relock state machine for SF-gated    │
                       │  features, renders the status tail          │
                       └───────────────────────────────────────────┘
                                          │ ns.run() on home
            ┌─────────────────────────────┼─────────────────────────────────┐
  LAYER 2   ▼                             ▼                                   ▼
  Managers  hack-coordinator.js   rooter.js / server-buyer.js /     advanced/* (stock,
  (home)    THE BOTNET BRAIN      hacknet-manager.js / contract-    faction, gang, sleeve,
            HWGW + prep + hack    solver.js                          bladeburner, corp)
            income distributor    (root, buy, scp, solve)            feature-API only;
                  │                       │                          never touch workers
                  │ ns.exec()             │ ns.scp() worker files
                  ▼                       ▼
  LAYER 3   ┌───────────────────────────────────────────────────────────────┐
  Workers   │  hack.js · grow.js · weaken.js  (~1.7–1.75 GB each, 1 NS call) │
            │  copied onto every rooted host; the coordinator exec's them     │
            └───────────────────────────────────────────────────────────────┘
                  the botnet = home + purchased cloud + every rooted network server

  LAYER 4   lib/: scanner (BFS) · batch-calculator (HWGW math) · target-selector
  Libraries       (ranking) · constants (WORKER_SCRIPTS, WORKER_RAM, DEFAULTS) ·
                  utils (formatting/log) · port-registry + config (runtime overrides)
```

### Module map

| Layer | File | Role |
|---|---|---|
| Supervisor | [`daemon.js`](../src/daemon.js) | Launches the 11 managers in priority order; lock/relock state machine demotes managers that exit immediately (missing Source File/API) and re‑probes every ~60 cycles; renders the status tail. |
| Manager | [`managers/hack-coordinator.js`](../src/managers/hack-coordinator.js) | **The heart.** Per cycle: HWGW batches on prepped targets → smart prep on un‑prepped targets → opportunistic hack‑income on all other rooted servers. Owns *which host* each thread runs on. |
| Manager | [`managers/rooter.js`](../src/managers/rooter.js) | BFS‑scans every 30 s, opens ports + nukes rootable hosts, and `scp`s the 3 worker files to each rooted host **once** (in‑memory `deployed` Set). |
| Manager | [`managers/server-buyer.js`](../src/managers/server-buyer.js) | Buys/upgrades the purchased `bitrunner-*` fleet (doubling RAM toward 1 PB), `scp`s workers on purchase. |
| Manager | [`managers/hacknet-manager.js`](../src/managers/hacknet-manager.js) | Buys the single best‑payback hacknet upgrade per cycle within a 10 %‑of‑cash budget. |
| Manager | [`managers/contract-solver.js`](../src/managers/contract-solver.js) | Largest file (528 LOC). Scans for `.cct` coding contracts every 5 min and auto‑solves supported types. |
| Tool/Manager | [`managers/prep-server.js`](../src/managers/prep-server.js) | **Manual** weaken/grow‑to‑min utility (takes a hostname arg; **not** in the daemon's manager list). |
| Worker | [`hack.js`](../src/hack.js) · [`grow.js`](../src/grow.js) · [`weaken.js`](../src/weaken.js) | Minimal: optional `delay` arg → `await ns.sleep(delay)` → one `ns.hack/grow/weaken`. Correct, RAM‑lean. |
| Worker | [`share.js`](../src/share.js) | `ns.share()` for faction rep. **Not** in `WORKER_SCRIPTS`; never auto‑deployed or dispatched (see F‑17). |
| Lib | [`lib/scanner.js`](../src/lib/scanner.js) | `scanNetwork` BFS, `getServerDetails`, `getPath`. `getAllServers` is dead code (F‑19). |
| Lib | [`lib/batch-calculator.js`](../src/lib/batch-calculator.js) | HWGW thread math + landing‑time offsets, `isServerPrepped`, `calculatePrepThreads`. |
| Lib | [`lib/target-selector.js`](../src/lib/target-selector.js) | Ranks targets by `maxMoney·chance / weakenTime^0.3`. |
| Lib | [`lib/constants.js`](../src/lib/constants.js) | `WORKER_SCRIPTS`, `WORKER_RAM`, `PROGRAMS`, `PORTS`, `DEFAULTS`. |
| Lib | [`lib/port-registry.js`](../src/lib/port-registry.js) · [`lib/config.js`](../src/lib/config.js) | Port read/write helpers + `getConfig` (runtime overrides). `getConfig` is **never called by the hot path** (F‑18). |
| Advanced | [`advanced/stock-trader.js`](../src/advanced/stock-trader.js), [`faction-manager.js`](../src/advanced/faction-manager.js), [`augmentation-buyer.js`](../src/advanced/augmentation-buyer.js), [`gang-manager.js`](../src/advanced/gang-manager.js), [`sleeve-manager.js`](../src/advanced/sleeve-manager.js), [`bladeburner-manager.js`](../src/advanced/bladeburner-manager.js), [`corp-manager.js`](../src/advanced/corp-manager.js) | Progression/economy automation. All run on home and use only their feature APIs — **none distribute workers.** |
| Tools | [`tools/`](../src/tools) | One‑shot operator commands: deploy, backdoor, monitor, connect, analyze, nuke-all, reset-prep, sell-stocks, find-contracts. |

---

## 3. Runtime control & RAM flow

1. **`daemon.js`** wakes every 5 s, launches any non‑running, non‑locked manager that fits
   in home RAM, then prints stats. A manager that exits instantly (feature locked behind a
   Source File) gets **locked**; locks clear every ~60 cycles to re‑probe.
2. **`rooter.js`** (30 s) roots new hosts and `scp`s worker files to them — *the only
   automatic deployer for generic network hosts.*
3. **`hack-coordinator.js`** (variable cycle) is the income engine:
   - **Phase 1 — HWGW:** for each *prepped* target, dispatch precision‑timed
     hack→weaken→grow→weaken batches until the pool can't fit another
     ([loop lines 178‑196](../src/managers/hack-coordinator.js#L178)). **Drains the pool.**
   - **Phase 2 — Prep:** weaken‑to‑min‑then‑grow un‑prepped targets, capped at 50 % of the
     pool ([line 211](../src/managers/hack-coordinator.js#L211)).
   - **Phase 3 — Hack income:** opportunistically hack every *other* rooted server that has
     money and low security, until the pool is drained
     ([lines 234‑274](../src/managers/hack-coordinator.js#L234)). **Drains the pool.**
   - **Sleep** is matched to script duration to avoid RAM stacking — a genuinely good design
     decision, called out in the code's own comments.
4. **RAM is the scarce resource.** Worker scripts are kept to one NS call each so more
   threads fit. Managers all run on `home`; every distinct NS API they reference adds to
   `home`'s static RAM cost (F‑44).

The phase loops are **saturation‑bound** (they dispatch until the pool is empty), *not*
demand‑capped — this matters, because it means the under‑utilization is purely an
*allocation‑order* artifact, not "too little work generated." (One auditor claimed the
opposite; it was refuted — see §7, F‑R1.)

---

## 4. The distribution problem (deep dive)

### 4.1 Primary cause — greedy largest‑first allocation `[CONFIRMED, critical]`

[`getAllWorkerServers`](../src/managers/hack-coordinator.js#L16) collects every rooted host
+ home, then:

```js
servers.sort((a, b) => b.freeRAM - a.freeRAM);   // line 32 — LARGEST FIRST
```

[`allocateThreads`](../src/managers/hack-coordinator.js#L48) walks that list front‑to‑back,
packs each host to capacity, and bails the moment the requested threads are placed:

```js
for (const server of workerServers) {
  if (remaining <= 0) break;                 // line 56 — stop as soon as demand is met
  if (server.freeRAM < ram) continue;
  const canRun = Math.floor(server.freeRAM / ram);
  const toRun  = Math.min(canRun, remaining);  // (already caps to need — see §7 F‑R2)
  ...
}
```

Because it's called **once per operation** and always restarts at the biggest host,
home/cloud absorb each operation before the small servers are ever reached. The files *are*
present on the small servers (rooter `scp`s them on root), so this is **mis‑allocation, not
exec failure.**

> Verification correction: this is *starvation/under‑utilization*, not literal
> impossibility. `allocateThreads` mutates `server.freeRAM` in place and runs many times per
> cycle, so the tail *is* reached once cumulative demand exceeds the big hosts' capacity —
> which is why you see it intermittently empty rather than provably never. With purchased
> RAM growing toward 1 PB, that overflow effectively never fires in normal play.

### 4.2 Secondary causes (real, but not the steady‑state driver)

- **`nuke-all.js` roots without deploying `[CONFIRMED, critical]`** —
  [`tools/nuke-all.js`](../src/tools/nuke-all.js) opens ports + nukes but never `scp`s
  workers (it doesn't even import `WORKER_SCRIPTS`). Hosts rooted *only* by this tool have no
  worker files → silent `exec` failure. **If you root the network this way, it's a direct
  second cause of your symptom.** It also wrongly skips servers above your hacking level
  ([line 19](../src/tools/nuke-all.js#L19)) — rooting needs only the port programs, not
  hacking level (the rooter gets this right).
- **`execWorker` swallows `pid===0` `[CONFIRMED, high]`** —
  [`execWorker`](../src/managers/hack-coordinator.js#L40) returns `pid > 0 ? threads : 0`
  with no log, so a missing‑file or out‑of‑RAM failure is indistinguishable from "host
  skipped." Zero diagnostics is why this was hard to see.
- **Fresh‑start race `[CONFIRMED, high → reframed]`** — the coordinator (≤5 s cycle) can
  `exec` on a host before the rooter's 30 s cycle has `scp`'d it. Real, but transient — the
  rooter roots *and* deploys atomically, so steady‑state hosts have the files.
- **Rooter's in‑memory `deployed` Set `[medium]`** —
  [`rooter.js` line 30](../src/managers/rooter.js#L30) copies each host once and never
  re‑verifies. If a file is ever missing, it's never re‑sent within a run. (Verification
  note: a rooter *restart* does re‑deploy, so this is intra‑run hardening, not the systemic
  cause.)

### 4.3 Recommended fix

**Stop greedy largest‑first packing — spread work across the pool.** The key insight
(confirmed by verification): Bitburner imposes **no co‑location requirement** — a single
operation's threads can already be split across many hosts and all land correctly, so there's
nothing to keep contiguous.

**Minimal, surgical change** — fill smallest‑first, with `home` reserved as last‑resort
overflow (also frees home RAM for the managers):

```js
// getAllWorkerServers — replace the descending sort (line 32):
servers.sort((a, b) => {
  if (a.hostname === "home") return 1;      // home always last
  if (b.hostname === "home") return -1;
  return a.freeRAM - b.freeRAM;             // smallest network/cloud first
});
```

That single change makes workers appear on n00dles/foodnstuff/etc. immediately. A more
balanced alternative is a **round‑robin / water‑fill** spread inside `allocateThreads`
(place `chunk = min(canRun, ceil(remaining / eligibleHostCount))` on each eligible host,
cycling) so load is even rather than draining the smallest first.

**Optional refinement** noted by the verifiers: keep dense packing for the *timing‑critical*
HWGW threads (so a batch stays consolidated and scheduling jitter stays low) but spread the
*non‑timing‑critical* Phase‑2 prep and Phase‑3 hack‑income threads smallest‑first. Either
approach resolves the symptom; start with the one‑line sort change and verify.

**Harden the deploy/exec path too (closes the secondary causes):**
1. `nuke-all.js`: add `ns.scp(WORKER_SCRIPTS, hostname, "home")` after the nuke, and drop the
   hacking‑level gate at line 19.
2. `execWorker`: when `pid === 0 && threads > 0`, `log(...)` a warning so silent thread loss
   surfaces.
3. Make the coordinator self‑sufficient: before `exec` on a host (cache in a Set), `if
   (!ns.fileExists("/src/weaken.js", host)) ns.scp(WORKER_SCRIPTS, host, "home")`.
4. `rooter.js`: gate deploy on `!ns.fileExists("/src/hack.js", host)` instead of the
   in‑memory Set, making deployment self‑healing.

**Verify any fix** by running `ns.ps("n00dles")` (or any small rooted host) after a cycle —
it should now show `grow/weaken/hack` PIDs.

---

## 5. Findings catalog (50 total)

Severity: 🔴 critical · 🟠 high · 🟡 medium · ⚪ low. ✅ = verified real, ❌ = **refuted**
by adversarial verification (see §7), blank = not separately verified (lower‑severity).

### Core orchestration — `daemon.js`, `hack-coordinator.js`
| # | Sev | Cat | Finding | Fix |
|---|---|---|---|---|
| F‑1 | 🔴 ✅ | ram‑dist | Descending‑RAM greedy allocation starves all small rooted servers (**root cause**). | §4.3 — spread allocation. |
| F‑2 | 🟠 ✅ | correctness | `execWorker` swallows `pid===0`, hiding genuine exec failures; coordinator relies entirely on the rooter for file presence. | Log `pid===0`; coordinator self‑`scp` with `fileExists` guard. |
| F‑3 | 🟡 | correctness | `execWorker` assumes `exec` launched all requested threads; freeRAM is a stale per‑cycle snapshot, so contention on home can silently drop threads. | Re‑read free RAM on contended hosts / surface `pid===0`. |
| F‑4 | ⚪ | correctness | Phase‑3 `busySet` excludes only the 3‑6 investment targets, so a just‑deselected target can be hit mid‑prep. | Track recently‑targeted hosts a couple of cycles. |
| F‑5 | ⚪ | efficiency | Daemon recomputes full network stats every 5 s purely for the cosmetic tail. | Refresh stats every Nth cycle / gate on tail open. |
| F‑R1 | 🟠 ❌ | efficiency | *"Per‑cycle workload is structurally too small to overflow onto the network pool."* | **Refuted** — Phase 1 & 3 are saturation‑bound. See §7. |

### Batching & targeting — `batch-calculator.js`, `target-selector.js`, `prep-server.js`
| # | Sev | Cat | Finding | Fix |
|---|---|---|---|---|
| F‑6 | 🟠 ✅ | ram‑dist | `prep-server.js` never `scp`s workers and silently skips undeployed hosts. (Manual tool, not in daemon.) | `fileExists`+`scp` before dispatch; log `pid===0`. |
| F‑7 | 🟡 | correctness | Prep grow + compensating weaken run concurrently with no delay and a fixed 80/20 RAM split, so weaken can't reliably offset grow's security bump. | Reuse `calculatePrepThreads`; derive weaken from `growthAnalyzeSecurity`; delay weaken to land after grow. |
| F‑8 | ⚪ | efficiency | `calculateBatch` calls `getServerMaxMoney` 3× per invocation. | Hoist once. |
| F‑9 | ⚪ | robustness | `growthNeeded` magic‑`100` fallback (dead under default hackPercent) + no negative‑delay guard (`hackDelay` can go negative). | Clamp delays to ≥0; assert `hackPercent < 1`. |
| F‑R2 | 🟠 ❌ | ram‑dist | *"Largest‑first dispatch in `prep-server` is identical to `allocateThreads`; apply the same fix there."* | **Refuted** — `allocateThreads` already caps to need (line 60). `prep-server` over‑alloc is real but separate. See §7. |

### Workers & libraries — workers, `scanner`, `utils`, `constants`, `config`, `port-registry`
| # | Sev | Cat | Finding | Fix |
|---|---|---|---|---|
| F‑15 | 🔴 ✅ | ram‑dist | (Same as F‑1, independently found.) Largest‑first allocation → small servers never reached. | §4.3. |
| F‑16 | 🟠 ✅ | ram‑dist | Startup race: coordinator dispatches before the rooter's first 30 s `scp`, causing silent `exec(0)`. (Transient.) | Coordinator self‑`scp`; log `pid===0`. |
| F‑3b | 🟡 | robustness | Rooter's deploy Set is in‑memory only; never re‑verifies file presence within a run. | `fileExists`‑gated re‑`scp`. |
| F‑17a | 🟡 | efficiency | Redundant full‑network BFS scans (≥3× per coordinator cycle) + repeated static `getServer*` calls. | Scan once/cycle; cache static attrs in a module map. |
| F‑17 | ⚪ | efficiency | Idle botnet RAM is never repurposed to `share()` — `share.js` is excluded from `WORKER_SCRIPTS`. | Add to `WORKER_SCRIPTS`; dispatch on leftover RAM **only while working for a faction**. |
| F‑18 | ⚪ | maint | Runtime config overrides (port 5 / `getConfig`) are ignored by the hot path — managers read `DEFAULTS` directly. | Route managers through `getConfig(ns)` once/cycle, **or** delete `config.js`. |
| F‑19 | ⚪ | maint | `scanner.getAllServers` is exported but unused (dead code). | Remove, or adopt as the single server‑snapshot source. |

### Infrastructure managers — `rooter.js`, `server-buyer.js`, `hacknet-manager.js`
| # | Sev | Cat | Finding | Fix |
|---|---|---|---|---|
| F‑20 | 🟠 ✅ | ram‑dist | (Same as F‑1.) Coordinator fills home+purchased first. *Verifier: severity is state‑dependent; the real mechanism is per‑op front‑fill, not RAM caps.* | §4.3. |
| F‑21 | 🟠 ✅ | ram‑dist | Worker deploy hinges on a non‑persisted Set + unchecked `scp`. *Verifier: restart re‑deploys; this is intra‑run hardening, medium not high.* | `fileExists`‑gated `scp`; check `scp` return. |
| F‑22 | 🟡 | ram‑dist | 30 s rooter cycle races the coordinator on freshly‑rooted hosts. | Shorten cycle or coordinator self‑`scp`. |
| F‑23 | ⚪ | efficiency | Rooter re‑scans whole network + re‑derives programs every cycle; `getServerMaxRam/MaxMoney` called just for a log string. | Track a separate `rooted` set; skip log getters unless logging. |
| F‑24 | ⚪ | efficiency | `server-buyer` rebuilds + re‑sorts all owned servers every upgrade iteration; re‑queries cost for the log line. | Compute the owned list once; reuse the known cost. |
| F‑25 | ⚪ | efficiency | `hacknet-manager` buys at most one upgrade per 10 s cycle, ramping slowly early game. | Loop within a cycle while spend stays under the 10 % budget. |

### Contracts — `contract-solver.js`, `find-contracts.js`
| # | Sev | Cat | Finding | Fix |
|---|---|---|---|---|
| F‑26 | 🟠 ✅ | correctness | **No `getNumTriesRemaining` guard before `attempt()`** — a consistently wrong solver burns one try per 5‑min cycle until the contract self‑destructs and its reward is lost. | Per‑session failed‑set keyed by host+file; skip when tries ≤ 1. |
| F‑27 | 🟠 ✅ | correctness | **LZ Compression III solver is a non‑optimal greedy** — the grader needs the *shortest* encoding, so valid‑but‑longer answers are rejected (traced: `10×'a'` → `1a811a` len 6 vs optimal `1a91` len 4). Also `len < 9` caps copy length at 8 (format allows 9). Compounds F‑26. | Replace with the standard min‑length DP; allow length 9; until then remove from `SOLVERS` so it's skipped, not failed. |
| F‑28 | ⚪ | efficiency | `getContractType`/`getData` re‑invoked for every `.cct` every cycle, including permanently‑unsupported types. | Cache resolved/unsupported ids across cycles. |
| F‑29 | ⚪ | robustness | `Spiralize Matrix` (and Unique Paths II / Shortest Path) can throw on `[[]]` / empty first row. | Guard `data[0]` shape. |

### Tools — `deploy`, `nuke-all`, `monitor`, `backdoor`, `connect`, `analyze`, `reset-prep`, `sell-stocks`
| # | Sev | Cat | Finding | Fix |
|---|---|---|---|---|
| F‑30 | 🔴 ✅ | ram‑dist | **`nuke-all.js` roots but never deploys workers** — a 2nd independent cause of the symptom if used as the rooting path. | Add `ns.scp(WORKER_SCRIPTS, host, "home")` after the nuke. |
| F‑31 | 🔴 ✅ | ram‑dist | (Same as F‑1, found again from the tools angle.) Big‑servers‑first fill starves small rooted hosts. | §4.3. |
| F‑32 | 🟡 ✅ | robustness | `monitor.js` Scripts panel inspects only `ns.ps("home")` — it *visually confirms the false impression* that workers never spread. | Aggregate `ns.ps` across all rooted hosts, or relabel "Scripts (home)". |
| F‑33 | 🟡 | maint | Worker‑deploy logic duplicated in **four** places (rooter, server‑buyer, deploy, +needed in nuke‑all) and will drift. | Extract a shared `deployWorkers(ns, host)` / `rootAndDeploy` helper in `lib/`. |
| F‑34 | 🟡 | correctness | `nuke-all.js` refuses to root servers above the player's hacking level, though rooting doesn't require it. | Remove the line‑19 gate; root on port count alone. |
| F‑35 | ⚪ | correctness | `analyze.js` "$/sec (1 batch)" projection is misleading for pipelined HWGW. | Clarify the metric (it's single‑batch, not steady‑state). |
| F‑36 | ⚪ | maint | `reset-prep.js` force‑sell uses gross proceeds while the rest of the codebase nets commission; usage hints inconsistent. | Net commission; align usage strings. |

### Advanced — economy (`stock-trader`, `faction-manager`, `augmentation-buyer`)
| # | Sev | Cat | Finding | Fix |
|---|---|---|---|---|
| F‑37 | 🟡 | efficiency | **Stock budget recomputed per‑symbol, not decremented** — the first few strong symbols can each spend the full 25 %, defeating the per‑cycle cap and draining cash you may want liquid. | Track a running `remaining` and subtract each buy. |
| F‑38 | 🟡 | efficiency | `faction-manager` goes **idle once the top faction's rep target is met** instead of advancing to the next faction with reachable augs. | Exclude maxed factions; re‑pick next‑best; only idle when none remain. |
| F‑44 | 🟡 | ram‑dist | Singularity/Stock‑heavy always‑on managers inflate **home static RAM**, shrinking home's botnet contribution. | Keep lean; consider running them on a small purchased server; ensure `reservedHomeRAM` covers them. |
| F‑39 | ⚪ | correctness | `getPortfolio` reports short positions at cost basis, not market value (cosmetic; affects no decision). | Use ask price, or label the metric. |
| F‑40 | ⚪ | maint | Dead `maxShares - longShares/shortShares` arithmetic inside `=== 0` guards. | Use `maxShares` directly. |
| F‑41 | ⚪ | ram‑dist | `STOCK_SIGNALS`/`STOCK_STATUS` ports reserved but unused — no stock‑manipulation synergy or monitor telemetry. | Publish `STOCK_STATUS`; optionally consume `STOCK_SIGNALS` to bias trades toward grow/hack‑manipulated symbols. |
| F‑42 | ⚪ | robustness | Unbounded auto‑join of all faction invitations can lock out mutually‑exclusive (city) factions. | Allow/deny list before `joinFaction`. |
| F‑43 | ⚪ | efficiency | `buyNeuroFlux` fixed 100‑iteration cap + invariant per‑iteration singularity calls. | Rely on the `price > money` break; hoist the rep‑req lookup. |
| F‑R3 | 🟠 ❌ | correctness | *"Augmentation buyer ignores live 1.9× price escalation, so later augs fail."* | **Refuted** — the sim compounds 1.9ˣ exactly like the game's global multiplier. (Real latent gap: it ignores aug *prerequisites*.) See §7. |

### Advanced — special (`gang`, `sleeve`, `bladeburner`, `corp`)
| # | Sev | Cat | Finding | Fix |
|---|---|---|---|---|
| F‑45 | 🟠 ✅ | ram‑dist | **Scoping finding:** none of the four special managers `exec`/`scp` workers, so the symptom is *not* here — it's in the coordinator/rooter path. | No change here; fix §4.3. |
| F‑46 | 🟡 | efficiency | `gang.buyEquipment` re‑fetches the entire equipment catalog + every price for every member, every cycle. | Fetch the catalog once per cycle. |
| F‑47 | 🟡 | correctness | Sleeve faction/work assignment can silently no‑op, leaving sleeves idle with no diagnostic. | Check assignment return; log failures; fall back to a valid task. |
| F‑48 | 🟡 | correctness | Corp **investment offers are logged but `acceptInvestmentOffer` is never called** — a key early‑game funding lever is dead. | Accept when an offer clears a funds threshold (guard dilution), or remove the misleading branch. |
| F‑49 | ⚪ | efficiency | `getBestTask` re‑fetches gang info per member; bladeburner `getRank()`/`getCurrentAction()` called repeatedly per cycle. | Reuse the cycle‑level info object. |
| F‑50 | ⚪ | maint | Corp `getCorporation().funds` re‑fetched in loops; unused `INDUSTRIES`/`CITIES` constants; collision‑prone product names. | Hoist funds; remove dead constants; namespace product names. |

---

## 6. Quick wins (low effort, high value)

1. **Spread allocation** (`hack-coordinator.js`) — the one‑line sort change in §4.3. *This
   alone resolves your reported symptom.*
2. **`nuke-all.js`** — add the `scp` after the nuke and delete the hacking‑level gate (two
   tiny edits; closes the second cause).
3. **`execWorker`** — log `pid===0`; one line, huge diagnostic value.
4. **`rooter.js`** — gate deploy on `!ns.fileExists(...)` for ~0.1 GB; self‑healing.
5. **`contract-solver.js`** — add the `getNumTriesRemaining` check + per‑session failed‑set;
   prevents silent permanent loss of contract rewards.
6. **`monitor.js`** — aggregate `ns.ps` across all rooted hosts (or relabel "Scripts
   (home)") so the dashboard stops falsely confirming "workers only on home."
7. **`batch-calculator.js`** — hoist the repeated `getServerMaxMoney`.
8. **`scanner.js`** — delete the unused `getAllServers`.

## 7. Refuted findings (do **not** act on these)

The adversarial verification pass overturned three findings. They're recorded so a future
reader doesn't "fix" non‑problems.

- **F‑R1 — "per‑cycle demand is structurally too small to overflow."** *Refuted (high
  confidence).* Phase 1 HWGW ([line 188](../src/managers/hack-coordinator.js#L188)) and
  Phase 3 hack‑income ([line 258](../src/managers/hack-coordinator.js#L258)) loop until the
  pool is drained — they're saturation‑bound. Raising target/batch counts will **not** move
  work onto small servers; only fixing allocation order (F‑1) does.
- **F‑R2 — "`prep-server`'s over‑allocation is identical to `allocateThreads`; fix both."**
  *Refuted (high confidence).* `allocateThreads` **already** caps to need via `Math.min(canRun,
  remaining)` ([line 60](../src/managers/hack-coordinator.js#L60)). The proposed fix is a
  no‑op there. (`prep-server`'s whole‑RAM weaken over‑allocation *is* real — that's F‑6/F‑7 —
  but it's a separate manual tool, not the running‑system cause.)
- **F‑R3 — "augmentation buyer ignores live 1.9× price escalation."** *Refuted (high
  confidence).* Bitburner's augmentation price multiplier is a **single global counter**
  applied uniformly; the buyer's simulation compounds `1.9ˣ` with purchases‑so‑far as the
  exponent — identical to the live formula `baseCost · 1.9^K`. No drift exists. (There *is* a
  real, unrelated latent gap: the sim ignores augmentation **prerequisites**, which can make
  `purchaseAugmentation` legitimately fail — worth a separate fix.)

## 8. Suggested roadmap

1. **Fix the symptom:** rewrite `allocateThreads` to spread load (water‑fill/round‑robin for
   fungible prep + hack‑income; dense packing OK for timing‑critical HWGW). Verify with
   `ns.ps("n00dles")`.
2. **Close file‑presence/exec gaps:** `scp` in `nuke-all.js`; coordinator self‑`scp` +
   `fileExists`; log `pid===0`; `fileExists`‑gated rooter deploy; same fixes for
   `prep-server.js`.
3. **Consolidate deployment:** extract one `deployWorkers`/`rootAndDeploy` helper into `lib/`
   used by rooter, server‑buyer, deploy, and nuke‑all so the four copies can't drift.
4. **Harden contracts:** add the tries guard + failed‑set; replace the greedy LZ III solver
   with the optimal DP (allow length 9) or remove it from `SOLVERS`; shape‑guard the grid
   solvers.
5. **Improve economy managers:** running stock budget; faction advancement; wire up corp
   `acceptInvestmentOffer`.
6. **Efficiency/observability:** cache `scanNetwork` + static attrs once per coordinator
   cycle; throttle the daemon's cosmetic stats; hoist redundant NS calls in
   gang/bladeburner/server‑buyer; aggregate `monitor.js` across the botnet.
7. **Upside (optional):** add `share.js` to `WORKER_SCRIPTS` and dispatch on leftover RAM
   while working for a faction; route managers through `getConfig` (or delete `config.js`);
   stock‑manipulation synergy via the unused stock ports.

---
*Generated by a multi-agent audit (8 subsystem auditors + RAM‑distribution deep‑dive →
adversarial verification → synthesis). 50 findings raised, 47 upheld, 3 refuted.*
