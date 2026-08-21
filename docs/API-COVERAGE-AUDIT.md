# Bitrunner — Netscript API Coverage Audit

**Date:** 2026-08-18
**Scope:** every callable in `NetscriptDefinitions.d.ts` (11,269 lines) vs. every `ns.*` reference in `src/` (51 scripts, ~4,700 LOC).
**Result:** **189 of 477** audited functions are referenced — **~40% coverage**. **77 of the 288
unused are actionable automation gaps**; the rest are cosmetic, redundant with existing helpers, or
gated behind content this suite does not touch.

> **Implementation status (2026-08-18).** Every **P0** and **P1** item in §5 has been built.
> See §7 for what shipped, what is verified, and the one item that remains blocked on an
> in-game measurement. The gap tables below describe the codebase *as audited*; §7 records
> what changed since.

> **This is a fork, not vanilla Bitburner.** `ns.dnet` (Darknet, 22 fns), `ns.cloud` (purchased
> servers, 9 fns) and `ns.go.cheat` (6 fns) do not exist upstream, and purchased servers live on
> `ns.cloud.*` rather than `ns.purchaseServer`. Every claim below is taken from **this repo's**
> `.d.ts`, not from upstream docs.

---

## 1. Method, and one caveat that matters

Two passes:

1. **Parse** — brace-depth walk of `NetscriptDefinitions.d.ts`, collecting every depth-1 member of
   each top-level interface plus the `RAM cost: N GB` line from its JSDoc.
2. **Match** — regex sweep of `src/**/*.js` for `ns.<fn>(` and `ns.<ns>.<fn>(`.

**Caveat, and why the numbers here differ from a naive sweep:** matching on `ns.foo(` reports
false gaps. `rooter.js:15-19` and `nuke-all.js:12-16` reference the port openers as *values*
(`brutessh: ns.brutessh,`) — deliberately, per the comment at `rooter.js:11-13` and the guard in
`test/static-ram.test.js`, because Bitburner's static RAM analyzer only counts literal `ns.<name>`
text. A call-site regex misses all five and reports them as unmapped.

So every candidate gap was re-checked by **bare-identifier grep across `src/`**, and each hit
adjudicated by hand:

| Candidate | Verdict |
|---|---|
| `brutessh`, `ftpcrack`, `relaysmtp`, `httpworm`, `sqlinject` | **Used** — value references (`rooter.js`, `nuke-all.js`). Removed from the gap list. |
| `dnet.heartbleed` | **Unused** — appears only in a status string, `darknet-scan.js:90`. |
| `dnet.memoryReallocation` | **Unused** — named in a skip reason, `darknet.js:33` and `stasis.js:36`. |
| `stock.has4SData` | **Unused** — `stock-trader.js:9` is a *local* `has4SData(ns)` try/catch helper, not the API. |
| `format.number/ram/time`, `ns.self/exit/clear` | **Unused** — coincidental word matches in comments. |

No `const { ... } = ns` destructuring exists anywhere in `src/`, so no aliasing hides usage.

**RAM figures are the documented base costs from the `.d.ts`,** which are nominal in two places:

- **Singularity** is multiplied **16× / 4× / 1×** by Source-File 4 level outside BN4
  (`.d.ts:1910`). Every spec below quotes **all three**; the 16× column is what actually decides
  whether `daemon.js` can launch the script.
- **Corporation** is documented at a flat **20 GB per function**. `corp-manager.js` already
  references 20 of them, which nominally bills **~400 GB**. Either the doc is nominal or that
  manager has never launched. **Settle it in-game before acting on §5.5** —
  `ns.getScriptRam("/src/advanced/corp-manager.js")` and `ns.getFunctionRamCost(...)` are both
  free (0 GB), and the daemon's dashboard would show `Corporation: 🔒 LOCKED` if it never fits
  (`daemon.js:21-22` refuses launch on insufficient free home RAM, then locks after 3 tries).

---

## 2. Coverage by namespace

| Namespace | Used / Defined | Actionable gaps | Assessment |
|---|---:|---:|---|
| `ns` (top-level) | **61 / 107** | 6 | Core hacking fully mapped. Gaps are quality-of-life. |
| `ns.singularity` | **16 / 64** | 14 | Rep grinding + augs only. No TOR, no programs, no home upgrades, no crime, no company work. |
| `ns.dnet` (fork) | **6 / 22** | 7 | **Half-built pipeline.** Intel harvested, never acted on. See §5.2. |
| `ns.stock` | **13 / 29** | 8 | Trades well *with 4S*. Cannot buy its own unlocks; idles without 4S. |
| `ns.corporation` (+Office/Warehouse) | **19 / 63** | 11 | Weakest advanced manager. No boost materials, no MarketTA, no office growth. |
| `ns.sleeve` | **9 / 22** | 7 | Assigns tasks; never buys sleeves, memory, or reads back state. |
| `ns.bladeburner` | **16 / 41** | 6 | Acts well once joined. Cannot join, switch city, or size a team. |
| `ns.gang` | **15 / 26** | 3 | Solid. Task choice is hardcoded rather than derived from `getTaskStats`. |
| `ns.hacknet` | **16 / 21** | 2 | Near-complete. Missing cache upgrades (hash capacity ceiling). |
| `ns.cloud` (fork) | **7 / 9** | 1 | Buy + upgrade both implemented. RAM cap hardcoded instead of `getRamLimit()`. |
| `ns.go` + `GoAnalysis` + `GoCheat` | **5 / 23** | 3 | `ipvgo.js` uses the core namespace only. **All 10 analysis fns and all 6 cheats unused** — see the correction in §8. |
| `ns.codingcontract` | **4 / 8** | 1 | Solver covers the loop. `getContractTypes` would harden dispatch. |
| `ns.grafting` | **0 / 5** | 5 | Entire subsystem unautomated. |
| `ns.stanek` | **0 / 11** | 0* | Unreachable without the Stanek gift (BN13 / SF13). |
| `ns.formulas` | **0 / 3** | 3 | Sub-namespaces (`hacking`, `work`, `gang`, `dnet`, hacknet) entirely unused. |
| `ns.infiltration` | **0 / 2** | 0 | Read-only; infiltration itself is not scriptable. |
| `ns.ui` | **1 / 17** | 0 | Cosmetic. `openTail` is the only one worth having. |
| `ns.format` | **0 / 4** | 0 | Superseded by `lib/utils.js` (`formatMoney`/`formatRAM`/`formatTime`). |

\* Actionable *if* the gift is unlocked; counted as unreachable for the current save.

Totals exclude the `Formulas` sub-interfaces (`HackingFormulas` 9, `WorkFormulas` 6, `GangFormulas`
6, hacknet 14, dnet), which are counted only via their 3 top-level members — real unused surface is
larger than 288.

---

## 3. Corrections to the brief's assumed baseline

Three rows in the request's example matrix no longer match the code. Worth fixing before planning
against them:

| Brief says | Actually |
|---|---|
| Server Purchasing: "auto-buying 8GB servers", upgrades missing | `server-buyer.js:31-49` **already upgrades** — at the server cap it doubles the smallest server repeatedly while cash allows. Uses `ns.cloud.upgradeServer`. Real gap is smaller: the 1 PB cap is hardcoded (`DEFAULTS.maxPurchasedServerRAM`) instead of `ns.cloud.getRamLimit()` — documented as per-server max RAM (`.d.ts:4293`), 0.05 GB. |
| Stock Market: "portfolio viewer", TIX automation missing | `stock-trader.js` **already trades** — longs, shorts, forecast thresholds, per-cycle budget cap, commission-aware profit gate. Real gaps: it cannot *buy* WSE/TIX/4S access, and its entire trading body sits inside `if (use4S)` (`:97-159`), so **without 4S the manager runs forever and does nothing**. |
| Singularity: "faction invites check", auto-work missing | `faction-manager.js` **already auto-joins and auto-works**, with rep-need scoring and city-faction exclusivity. `augmentation-buyer.js` handles augs + NeuroFlux + install. Real gaps are elsewhere in Singularity: TOR/programs, home RAM, crime, donations. |
| Sleeves: "basic shock recovery" | Fair — plus sync, gym, crime, faction work, and aug purchases (`sleeve-manager.js:56-99`). Gaps are sleeve *acquisition* and memory. |
| Hacknet: "basic node purchasing" | Understated — payback-ratio ranking and hash spending (targeted `Reduce Minimum Security` / `Increase Maximum Money` + drain to money) are implemented. Only cache upgrades are missing. |

---

## 4. Gap matrix, priority-ranked

RAM columns are the **script's total static bill** (1.6 GB base + each distinct `ns` function
referenced), because that is what `daemon.js:18-22` gates on.

| # | Subsystem | Namespace | Unmapped functions | RAM @ SF4.1 / 4.2 / 4.3 | Gate | Priority |
|---|---|---|---|---|---|---|
| 1 | **TOR + darkweb programs** | `ns.singularity`, `ns` | `purchaseTor`, `purchaseProgram`, `hasTorRouter`, `getDarkwebProgramCost` | 65.8 / 17.8 / 5.8 GB | SF4 | **P0** |
| 2 | **Darknet cracking loop** | `ns.dnet` | `authenticate`, `heartbleed`, `memoryReallocation`, `openCache`, `getDarknetInstability`, `nextMutation`, `getServerRequiredCharismaLevel` | ~2.9 GB × threads (no SF mult) | fork Darknet + `DarkscapeNavigator.exe` | **P0** |
| 3 | **Home RAM / cores upgrader** | `ns.singularity` | `upgradeHomeRam`, `getUpgradeHomeRamCost`, `upgradeHomeCores`, `getUpgradeHomeCoresCost` | 146.1 / 38.1 / 11.6 GB (full) — 50.1 / 14.1 / 5.1 GB (RAM-only, no cost probe) | SF4 | **P0** |
| 4 | **Market access buyer** | `ns.stock` | `hasWseAccount`, `hasTixApiAccess`, `has4SData`, `has4SDataTixApi`, `purchaseWseAccount`, `purchaseTixApi`, `purchase4SMarketData`, `purchase4SMarketDataTixApi` | 12.3 GB (no SF mult) | none | **P1** |
| 5 | **Corp production levers** | `ns.corporation` | `buyMaterial`, `setMaterialMarketTA1/2`, `setProductMarketTA1/2`, `hireAdVert`, `upgradeOfficeSize`, `expandCity`, `purchaseUnlock`, `getUpgradeLevel`, `hasCorporation` | see §1 caveat — **measure first** | SF3 | **P1** |
| 6 | **Sleeve acquisition** | `ns.sleeve` | `purchaseSleeve`, `getSleeveCost`, `upgradeMemory`, `getMemoryUpgradeCost`, `getTask`, `setToBladeburnerAction`, `travel` | +28 GB on `sleeve-manager.js` (4 GB/fn) | SF10 | **P1** |
| 7 | Bladeburner bootstrap | `ns.bladeburner` | `joinBladeburnerDivision`, `joinBladeburnerFaction`, `inBladeburner`, `switchCity`, `getTeamSize`, `setTeamSize` | +20 GB on `bladeburner-manager.js` | SF6/7 | P2 |
| 8 | Gang task selection | `ns.gang` | `getTaskStats`, `getEquipmentStats`, `getEquipmentType` | +5 GB | SF2 | P2 |
| 9 | Hacknet hash capacity | `ns.hacknet` | `upgradeCache`, `getCacheUpgradeCost` | +1 GB | hacknet servers | P2 |
| 10 | Purchased-server RAM cap | `ns.cloud` | `getRamLimit` | +0.05 GB | none | P2 |
| 11 | Grafting | `ns.grafting` | all 5 | 21.6 GB (no SF mult) | SF10 (`.d.ts:6020`) | P2 |
| 12 | Formulas-backed batching | `ns.formulas` | `formulas.hacking.*`, `formulas.dnet.*` | 0 GB API, needs `Formulas.exe` | Formulas.exe | P2 |
| 13 | IPvGO analysis + cheats | `GoAnalysis`, `GoCheat` | `getChains`, `getLiberties`, `getControlledEmptyNodes`, `getStats`, all 6 `cheat.*` | 0 GB (`ipvgo.js` already pays for `go`) | none | P3 |
| 14 | Stanek's Gift | `ns.stanek` | all 11 | 20.45 GB | BN13 / SF13 | P3 |

**Not actionable** (documented here so they stop showing up as "gaps"): `ns.format.*` and
`sprintf`/`vsprintf` (superseded by `lib/utils.js`), `ns.ui.*` theming, `mockServer`/`mockPlayer`/
`mockPerson`, `exportGame`/`getSaveData`/`getUnlockedAchievements`, `b1tflum3`/`destroyW0r1dD43m0n`
(run-ending, must stay manual — same reasoning that keeps `augmentation-buyer.js` manual),
`createDummyContract`, `dnet.labreport`/`labradar` (easter eggs), `dnet.unleashStormSeed` (the
`.d.ts` calls it "catastrophic damage"), `gang.createGang`/`corporation.createCorporation`
(irreversible faction/BN commitments — keep manual), `ns.infiltration.*` (read-only).

---

## 5. Implementation specs

### 5.1 — P0 · TOR router + darkweb program buyer

**Target:** the missing prerequisite for `rooter.js`. The rooter can only open as many ports as it
has programs (`constants.js:41-47`, `rooter.js:6-8`); today those are acquired by hand, so root
coverage stalls behind manual shopping. In this fork it also gates the darknet:
`DarkscapeNavigator.exe` is a darkweb program, and `dnet.isDarknetServer` is documented as the one
dnet call that *doesn't* require it — implying the rest do. **This unblocks §5.2.**

**Prerequisites & RAM.** SF4. Static bill:

| Function | Base | @16× (SF4.1) | @4× | @1× |
|---|---:|---:|---:|---:|
| script base | 1.6 | 1.6 | 1.6 | 1.6 |
| `ns.hasTorRouter()` | 0.05 | 0.05 | 0.05 | 0.05 |
| `ns.fileExists()` | 0.10 | 0.10 | 0.10 | 0.10 |
| `ns.singularity.purchaseTor()` | 2.0 | 32.0 | 8.0 | 2.0 |
| `ns.singularity.purchaseProgram()` | 2.0 | 32.0 | 8.0 | 2.0 |
| **Total (lean)** | | **65.75** | **17.75** | **5.75** |
| `+ getDarkwebProgramCost()` (optional) | 0.5 | +8.0 | +2.0 | +0.5 |

Three things the snippet in the request needs changed:

1. **It never buys TOR and never checks for it.** Without the router, `purchaseProgram` silently
   fails every call, forever. Gate on `ns.hasTorRouter()` — top-level NS, **0.05 GB**, *not*
   multiplied — and call `purchaseTor()` when it's false. Do **not** gate on
   `getDarkwebPrograms()`: same information, 16 GB at SF4.1.
2. **Don't make it a persistent manager.** At 65.75 GB @ SF4.1 an 11th always-on manager would
   permanently hold more than twice `DEFAULTS.reservedHomeRAM` (32 GB) for a job that is finished
   after five purchases. Ship it as a **one-shot that exits**, launched on a slow cadence.
3. **`purchaseProgram(programName: ProgramName)` is a string-literal type, not `string`.** Under
   `checkJs` (`jsconfig.json`), `PROGRAMS[].name` as a plain `string[]` will not satisfy it, and
   `ProgramName` is declared but *not exported* from the `.d.ts` (`:9532`) so it cannot be
   imported. Use the derivation precedent already in `globals.d.ts:14-21`:
   ```ts
   type ProgramName = Parameters<NS["singularity"]["purchaseProgram"]>[0];
   ```
   then annotate `constants.js` `PROGRAMS` as `/** @type {{name: ProgramName, fn: string}[]} */`.
   (`ns.enums.ProgramName` also exists at runtime, `.d.ts:9138` — but the type alias costs 0 GB and
   matches how this repo already handles `GoOpponent`, `CrimeType`, etc.)

**Core loop** (one-shot, no `while`):
- **State:** `ns.hasTorRouter()`; then `ns.fileExists(p.name, "home")` per program.
- **Decision:** no router → `purchaseTor()`; return early if it fails (insufficient funds — retry
  next invocation). Then for each missing program, attempt purchase. `purchaseProgram` already
  returns `false` when unaffordable, so the cost probe is optional — omit it to save 8 GB and let
  the return value drive logging.
- **Action:** buy cheapest-first so a partial budget still yields ports (`BruteSSH` → `FTPCrack` →
  `relaySMTP` → `HTTPWorm` → `SQLInject`), then `DarkscapeNavigator.exe` if §5.2 is in play.
- **Exit** when all present, `tlog` a summary.

**Integration.** Two options, pick by RAM pressure:
- *(recommended)* `MANAGERS` entry in `constants.js:19` — `{ id: "programs", script:
  "/src/tools/program-buyer.js", name: "Program Buyer", priority: 2.5, phase: 2 }`. The daemon's
  existing relaunch machinery supplies the cadence for free — see **the one-shot cadence** below.
  The id also becomes a `manager-toggle.js` target at no extra cost.
- *(low-RAM alt)* fold into `rooter.js`'s 30 s cycle behind a "have I already got everything"
  short-circuit. Cheaper in wall-clock, but adds 64 GB to a **persistent** manager — worse than the
  one-shot at SF4.1, better at SF4.3.

#### The one-shot cadence, and what it does to the dashboard

Both §5.1 and §5.3 rely on the same trick, so trace it once (`daemon.js:120-134`). For a script
that exits immediately: cycle N launches it; N+1 sees it gone → `fails=1`, relaunch; N+2 →
`fails=2`, relaunch; N+3 → `fails=3` → `locked`; then nothing until `cycle % RELOCK_RETRY_CYCLES
=== 0` (60 cycles ≈ 5 min) clears the lock and the burst repeats.

Two consequences to accept deliberately:

1. **It runs 3× per burst, not once.** Both scripts must be idempotent — §5.1 is, via the
   `fileExists` guard; §5.3 is, because `upgradeHomeRam()` returns `false` once cash runs out.
   Do not add a one-shot here that isn't.
2. **It shows `🔒 LOCKED` for ~280 of every 300 seconds.** That state currently means *"missing
   Source File / feature unavailable"* (`daemon.js:112-113`), so a one-shot idling as LOCKED
   overloads the symbol — and §6's proposal to treat LOCKED as a "manager no longer fits in RAM"
   alarm would then fire on healthy one-shots.

Pick one and don't leave both readings live:

- **(a) Accept it** — cheapest. Add a `oneShot: true` flag to the `MANAGERS` entry and render
  those as `⏱ IDLE` instead of `🔒 LOCKED` in the daemon's dashboard block (`daemon.js:159-170`).
  A few lines, and LOCKED goes back to meaning exactly one thing.
- **(b) Keep it RUNNING** — end the script with a long `await ns.sleep()` instead of exiting. Reads
  clean on the dashboard, but holds 65.75 GB (§5.1) or 50.1 GB (§5.3) resident at SF4.1, which is
  the whole reason these are one-shots. Only sensible at SF4.3.

**Built: (a).** `lib/manager-health.js` `managerStatus()` renders `oneShot && locked` as `⏱ IDLE`;
`daemon.js` calls it instead of its inline ternary. A useful property fell out of this: a one-shot
that is *too big for home* never launches at all, so it never reaches `locked` — it shows as
`■ STOPPED (74.2 GB)` with its RAM bill, permanently distinguishable from a healthy idle one-shot.
That closes the §6 concern too: LOCKED is once again a single-meaning signal.

No `PORTS` entry (nothing to report continuously). No new config keys; optionally a
`DEFAULTS.programBuyerReservePercent` if you want it to leave cash for `server-buyer.js`.

**Open question:** whether `DarkscapeNavigator.exe`/`STORM_SEED.exe` appear in this fork's darkweb
catalogue at a buyable price. Confirm with `ns.singularity.getDarkwebPrograms()` from the terminal
once TOR is owned, before hardcoding them into `PROGRAMS`.

---

### 5.2 — P0 · Darknet authentication + heartbleed loop

> **Superseded in part — see [`DARKNET.md`](DARKNET.md) for the current state (2026-08-21).**
> This section describes the codebase *as audited on 2026-08-18*. Since then: **Stage A
> shipped** (`heartbleed` is called by `darknet-crack-worker.js:25`, so the "never called
> anywhere in `src/`" claim below now applies to `authenticate` only), and the **open
> question at the end of this section has partly been answered** — one `modelId → password`
> rule is known (`ZeroLogon` → `""`), and `formulas.dnet.getAuthenticateTime`'s
> `correctCharactersInPassword` parameter points at a timing oracle on `2G_cellular`
> servers. `DARKNET.md` §9 also documents the *actual* reason the pipeline stalls, which
> this section did not identify: the password store has no automated writer.

**Target:** finish the pipeline this repo already built two-thirds of. `darknet-probe-worker.js`
harvests exactly the fields a cracker consumes — `passwordHint`, `data`, `passwordLength`,
`passwordFormat`, `requiredCharisma` (`globals.d.ts:63-79`) — writes them to `MAP_FILE`, and then a
**human types the password** via `stasis.js <host> <password>` (`stasis.js:168`). `authenticate` and
`heartbleed` are never called anywhere in `src/`. The expensive half (discovery, topology merge,
stasis planning, exec routing) is done; the cheap half is missing.

Two more signals that the design already anticipated this: `darknet.js:33` defines a `blocked-ram`
skip reason described as *"would fit after `dnet.memoryReallocation()`"* — for a function the
codebase never invokes — and `formulas.dnet.getAuthenticateTime`/`getHeartbleedTime` (`.d.ts:6505`,
`:6517`) exist unused, which is precisely the timing model a cracker needs to size its thread count.

**Prerequisites & RAM.** No SF multiplier. `authenticate` requires the script to run **on a server
directly connected to the target**, so this is a worker deployed like
`darknet-probe-worker.js`, not a home manager:

| Function | RAM |
|---|---:|
| script base | 1.6 |
| `dnet.probe()` | 0.2 |
| `dnet.getServerDetails()` | 0.1 |
| `dnet.heartbleed()` | 0.6 |
| `dnet.authenticate()` | 0.4 |
| `ns.read`/`ns.write` | 0 |
| **Total per thread** | **2.9 GB** |

Both `authenticate` and `heartbleed` scale with thread count, so run it multi-threaded — total is
`2.9 × threads`. Sits comfortably alongside the existing 1.9 GB probe worker.

**Core loop:**
- **State:** `getServerDetails(host)` for `passwordHint`, `data`, `passwordLength`,
  `passwordFormat`, `modelId`, `requiredCharismaSkill`; `getDarknetInstability()` for the current
  `authenticationTimeoutChance` and duration multiplier; `loadPasswords()` to skip solved hosts.
- **Decision:** skip if `requiredCharismaSkill > player.skills.charisma` (heartbleed is documented
  as impossible above your charisma, and authentication "takes much longer"). Skip if instability
  is high enough that expected attempts × duration exceeds the mutation window — servers move.
- **Action:** `heartbleed(host, {peek: true})` first to read logs without consuming them; derive
  candidates from `passwordHint`/`data`, bounded by `passwordFormat` (`numeric` / `alphabetic` /
  `alphanumeric` / `ASCII` / `unicode`) and `passwordLength`; `authenticate(host, candidate,
  additionalMsec)` per candidate; on success `savePassword(ns, host, password)` — which is already
  written and already the registry `getStasisCandidates` reads.
- **Then:** `memoryReallocation(host)` on authenticated servers to convert `blocked-ram` skips into
  eligible stasis targets, and `openCache()` on any `.cache` files found.

**Don't pay twice for the same data.** Two of the nine unmapped dnet calls are redundant here:
`getBlockedRam` (0 GB) and `getDepth` (0.1 GB) both return fields `getServerDetails` already
carries, and `darknet.js:87-99` already reads them off that one call. Keep using
`getServerDetails`; the two standalone getters are only worth their RAM in a worker that needs
*just* one field and nothing else.

**Integration.** Extend `darknet-scan.js` rather than adding a manager — it already deploys probe
workers, merges reports, and owns `MAP_FILE`. Add a crack phase after the merge, reusing
`pickCrawlHosts` with `CRACK_WORKER_RAM`. New worker `/src/tools/darknet-crack-worker.js`
alongside the existing two. Report over `PORTS.DNET_PROBE` or a new `DNET_CRACK` id.

**Open question — do not hand-wave this.** There is **no evidence in the `.d.ts` that the password
is derivable** from hint + format + length. `modelId` is documented as *"intentionally
undocumented… you are supposed to experiment and discover the models"* (`.d.ts:4433-4436`), which
reads as: the mapping from model → vulnerability is a **player-discovered lookup table**, not an
algorithm. So spec this in two stages:

1. **Stage A (safe, do first):** an *intel* pass — `heartbleed(peek: true)` across every reachable
   known host, dumping logs to a data file next to `MAP_FILE`. Zero risk, and it's the only way to
   learn what the logs actually contain. Also records `modelId` → observed password shape.
2. **Stage B (build once A pays off):** the candidate generator, keyed off the model table Stage A
   produces. Feasibility is unknown until Stage A runs — a `unicode` password of length 12 is not
   brute-forceable and the honest answer may be "some servers stay manual."

---

### 5.3 — P0 · Home RAM / cores upgrader

**Target:** the daemon's own bottleneck. `daemon.js:18-22` refuses to launch any manager that
doesn't fit in free home RAM and locks it after 3 tries, and `DEFAULTS.reservedHomeRAM` holds back
32 GB on top. Home RAM is therefore the single gate on how many advanced managers can run at all —
and nothing in the suite ever buys more of it.

**Prerequisites & RAM.** SF4. The chicken-and-egg is real, so the cost probes are worth dropping:

| Variant | Functions | @16× | @4× | @1× |
|---|---|---:|---:|---:|
| Full | `upgradeHomeRam`, `getUpgradeHomeRamCost`, `upgradeHomeCores`, `getUpgradeHomeCoresCost`, `getPlayer` | 146.1 | 38.1 | 11.1 |
| RAM-only, no probe | `upgradeHomeRam`, `getPlayer` | 50.1 | 14.1 | 5.1 |
| RAM-only, no probe, no `getPlayer` | `upgradeHomeRam` | 49.6 | 13.6 | 4.6 |

`upgradeHomeRam()` returns `false` when unaffordable, so the cost lookup buys you nothing except a
budget reserve. **Start with the RAM-only variant** — at SF4.1 the full version costs more home RAM
than most early saves have free, which is exactly the problem it exists to solve.

**Core loop:** one-shot. `upgradeHomeRam()` in a loop while it returns `true` and a cash reserve
holds; log the new `getServerMaxRam("home")`. Add cores (and the cost probes) later, once home RAM
is large enough that the 146 GB variant is affordable — cores only help `grow`/`weaken` on home and
are a distant second to RAM.

**Integration.** Same one-shot-as-manager pattern as §5.1, including the LOCKED-vs-IDLE decision
documented there. Priority 2.6 (after the program buyer, before the server buyer, since home RAM
gates everything downstream). Config key: `DEFAULTS.homeUpgradeReservePercent` so it competes fairly
with `server-buyer.js` and `augmentation-buyer.js` for cash.

**Note:** this script *shrinks the free RAM it needs to run* every time it succeeds — it should
`ns.exit()` cleanly and let the daemon re-run it, never hold a loop open.

---

### 5.4 — P1 · Market access buyer + non-4S trading path

**Target:** two separate holes in `stock-trader.js`.

*(a) It cannot buy its own unlocks.* WSE account, TIX API, 4S data and 4S TIX API are all
purchasable from Netscript and none of the eight relevant calls are used. The manager instead
probes with a try/catch on `getForecast("ECP")` (`stock-trader.js:9-15`) and prints a warning.

*(b) Without 4S it does nothing at all.* Every buy and sell in the main loop is inside
`if (use4S)` (`:97-159`). With `use4S === false` the manager loops forever at 6 s, reads
`getSymbols()`/`getPosition()`/`getMaxShares()` per symbol, and never trades. That's a live
manager burning RAM for zero output — arguably a bug, not just a gap.

**Prerequisites & RAM.** No SF multiplier, no Source-File. Access buyer as a one-shot:

| Function | RAM |
|---|---:|
| base | 1.6 |
| `hasWseAccount`, `hasTixApiAccess`, `has4SData`, `has4SDataTixApi` | 0.05 × 4 = 0.2 |
| `purchaseWseAccount`, `purchaseTixApi`, `purchase4SMarketData`, `purchase4SMarketDataTixApi` | 2.5 × 4 = 10.0 |
| `getPlayer` | 0.5 |
| **Total** | **12.3 GB** |

**Core loop:** strictly ordered, each gated on cash and on the previous unlock —
WSE → TIX API → 4S data → 4S TIX API. 4S is the expensive one; gate it behind a
`DEFAULTS.stock4SBudgetFraction` of net worth so it doesn't starve server/aug purchases (the same
mistake `augmentation-buyer.js` already fixed for NeuroFlux in `059c5ae`).

**Also fix in `stock-trader.js`:** replace the three local try/catch probes with
`hasTixApiAccess()` / `has4SData()` (0.05 GB each, definitive), and add a non-4S branch —
momentum from a rolling `getPrice()` window (2 GB), with wider thresholds and a hard position cap,
since forecast is unavailable. Keep the existing commission-aware profit gate and per-cycle budget
decrement; both are correct.

**Integration.** `MANAGERS` entry `{ id: "market-access", priority: 5.5, phase: 4 }`, one-shot,
before the stock trader in priority order. No new port.

---

### 5.5 — P1 · Corporation production levers

**Measure RAM first** — see §1. If corp functions really bill 20 GB each, `corp-manager.js` is
already ~400 GB and this whole section is blocked on a redesign (split into per-concern one-shots,
each referencing 2-3 corp functions) rather than an extension.

**Target:** the manager hires, assigns jobs, expands warehouses, makes products, sells output, buys
upgrades and takes early investment. What it never does is the part that actually drives corp
revenue: **production boosts and price optimization**.

**Correctness finding, flag before extending:** `corp-manager.js:86-92` sells `Hardware`, `Robots`,
`AI Cores` and `Real Estate` whenever `stored > 0 && productionAmount > 0`. Those four are
**boost materials** — they multiply a division's production when *held*, not sold. The manager is
selling its own multipliers. Fix this before adding `buyMaterial`, or the new purchases feed
straight back into the sell loop.

**Unmapped, in payoff order:** `buyMaterial` (boost materials, per division/city),
`setMaterialMarketTA1`/`TA2` and `setProductMarketTA1`/`TA2` (automatic optimal pricing — the
single biggest revenue lever, and it replaces the hardcoded `"MP"` price in `sellProduct`/
`sellMaterial`), `hireAdVert` (awareness → demand), `upgradeOfficeSize` (the manager hires up to
`office.size` but never raises it, so headcount is permanently capped),
`getOfficeSizeUpgradeCost`/`getHireAdVertCost`, `expandCity` (currently single-city forever),
`purchaseUnlock`/`getUnlockCost` (MarketTA needs its unlock bought first), `getUpgradeLevel`
(`buyUpgrades` currently levels blind, with no cap), `hasCorporation`/`canCreateCorporation` (to
replace the try/catch probe at `:7-14`).

**Core loop additions:** per division/city → ensure warehouse → buy boost materials to a target
ratio → `setMaterialMarketTA2` once unlocked → raise office size while funds allow → `hireAdVert`
on a payback threshold. Keep the existing `funds * 0.05` / `funds * 0.1` fraction discipline.

**Integration.** Same script, same `PORTS.CORP_STATUS`. Add `DEFAULTS.corpBoostMaterialTargets`
(per-industry ratios) to `constants.js`.

---

### 5.6 — P1 · Sleeve acquisition and memory

**Target:** `sleeve-manager.js` reads `getNumSleeves()` **once, before the loop** (`:53`) and never
re-reads it, so a sleeve bought later in the run is never assigned work until the daemon restarts
the manager. It also never buys sleeves or memory.

**Prerequisites & RAM.** SF10. Sleeve functions are a flat 4 GB each, so each addition is
significant: `purchaseSleeve` + `getSleeveCost` + `upgradeMemory` + `getMemoryUpgradeCost` +
`getTask` + `travel` + `setToBladeburnerAction` = **+28 GB** on the existing manager.

**Core loop:** move `getNumSleeves()` inside the `while`. Buy a sleeve when
`getSleeveCost()` clears a cash-fraction threshold (each sleeve compounds — buy early, buy all).
Upgrade memory on the same rule (memory is permanent across resets — highest-value sleeve spend).
Use `getTask()` to skip redundant `setTo*` calls, which currently fire every 30 s regardless.
Add `setToBladeburnerAction` so sleeves feed §5.7 contracts instead of committing crime.

**Integration.** Same script. Add `DEFAULTS.sleeveBudgetPercent`.

---

### 5.7-5.14 — P2/P3, compact specs

| Item | Spec |
|---|---|
| **Bladeburner bootstrap** | The manager can act but not *enter*: `joinBladeburnerDivision()` then `joinBladeburnerFaction()` gated on `inBladeburner()` (0 GB) — which also replaces the try/catch probe at `:5-12`. Add `switchCity` when `getCityEstimatedPopulation` is low or chaos stays high after Diplomacy (currently it only ever runs Diplomacy in place), and `setTeamSize` for Operations/BlackOps success rates. +20 GB. |
| **Gang task selection** | `getBestTask` hardcodes four thresholds (`gang-manager.js:23-31`). `getTaskStats` (1 GB) exposes per-task money/respect/wanted coefficients — rank tasks by `moneyGain × wantedPenalty` against current member stats instead. `getEquipmentStats`/`getEquipmentType` (2 GB each) let `buyEquipment` prefer combat gear over cosmetic rather than buying everything under `money * 0.01`. |
| **Hacknet cache** | `hacknet-manager.js` spends hashes but never raises capacity. `upgradeCache` + `getCacheUpgradeCost` (0.5 GB each) — cache caps `hashCapacity()`, and once hashes cap, production is wasted between spend cycles. Same payback-ratio ranking the node upgrades already use. |
| **`cloud.getRamLimit`** | Documented as *"the maximum RAM that a cloud server can have"* (`.d.ts:4293`) — per-server, so it is the right replacement for `DEFAULTS.maxPurchasedServerRAM: 1048576` at `server-buyer.js:21,39`. 0.05 GB. Hardcoding is wrong if this fork's cap differs from vanilla's 1 PB or scales with progression. |
| **Grafting** | 0/5, gated on **SF10** — the same Source-File that already unlocks `sleeve-manager.js`, so if sleeves run, grafting is available *now*. `getGraftableAugmentations` + `getAugmentationGraftPrice` (21.6 GB for all five, no SF multiplier) — grafting buys augs *without faction rep*, which is exactly the constraint `faction-manager.js` spends its whole cycle grinding. Highest-leverage P2. Requires being in New Tokyo (needs `travelToCity`, also unmapped). Grafting occupies the player and blocks other work — must respect the same "don't override the player" rule as `manager-toggle.js`. |
| **Formulas** | `formulas.hacking.*` would replace the hand-rolled math in `batch-calculator.js` with exact values, and `formulas.dnet.getAuthenticateTime`/`getHeartbleedTime` are required to size §5.2's threads properly. Costs 0 GB but requires `Formulas.exe` on home — which §5.1 can buy. Gate every call behind `fileExists("Formulas.exe", "home")`. |
| **IPvGO** | ~~`ipvgo.js` uses `getValidMoves` only.~~ **Two errors here, corrected in §8:** the script never calls `getValidMoves` (the match came from the comment at `ipvgo.js:161` explaining why it avoids it), and `analysis.getChains`/`getLiberties`/`getControlledEmptyNodes` cost **16 GB each**, not 0 GB. What is genuinely free: `analysis.getStats` (0 GB) for per-opponent win rates, and `getMoveHistory`/`opponentNextTurn` (0 GB). `GoCheat` (6 fns) is unused; a failed cheat skips your turn and, after the first attempt, carries a ~10% chance of ejection from the subnet — it is not an automatic loss. |
| **Stanek** | 0/11 (20.45 GB for the full set), unreachable without the gift. Spec only if BN13/SF13 is in play: `acceptGift` is **irreversible and shrinks home RAM** — must stay a manual decision, like `augmentation-buyer.js install`. |

---

## 6. Reproducing this audit

The two parser passes are ~40 lines each; regenerate after any `.d.ts` sync (`npm run sync` pulls a
fresh definition file per `filesync.json`):

1. **Parse** `NetscriptDefinitions.d.ts` — walk top-level `(export )?interface X {`, track brace
   depth, collect depth-1 members matching `^\s{2}(readonly )?(\w+)\s*[(:]` plus the preceding
   `RAM cost: N GB` JSDoc line.
2. **Match** `src/**/*.js` for `ns\.(\w+)\.(\w+)\s*\(` and `ns\.(\w+)\s*\(`.
3. **Adjudicate** — for every candidate gap, grep the **bare identifier** across `src/` and
   hand-check each hit. This step is not optional; skipping it produced five false gaps on the
   first run (§1).

Worth adding as a permanent guard, alongside `test/static-ram.test.js`: a test asserting the
`MANAGERS` roster's total static RAM against a known-good budget, so a manager that silently stops
fitting in home RAM fails in CI instead of showing up as `🔒 LOCKED` on the dashboard. **This only
works if one-shots stop rendering as LOCKED first** — see §5.1's cadence note, otherwise the alarm
fires on healthy scripts every 5 minutes.

---

## 7. What was implemented (2026-08-18)

All **P0** and **P1** items from §5. Built test-first: the decision logic lives in pure,
unit-tested `lib/` modules and the `ns`-coupled scripts stay thin — the pattern
`lib/darknet.js` and `lib/batch-calculator.js` already established. **185 tests pass**
(107 before, +78), and `npm run check` is clean.

### New pure modules (tested)

| Module | Exports | Covers |
|---|---|---|
| `lib/manager-health.js` | `managerStatus`, `ramVerdict` | daemon status vocabulary; the LOCKED-vs-IDLE split |
| `lib/purchasing.js` | `spendableMoney`, `planPurchases` | shared budget walk — shopping vs. dependency-ladder semantics |
| `lib/programs.js` | `selectProgramsToBuy` | darkweb shopping list |
| `lib/market.js` | `planMarketUnlocks`, `momentumSignal`, `pushSample`, `shouldRealize` | WSE ladder; non-4S trading signal; shared loss tolerance |
| `lib/sleeves.js` | `planSleeveSpending`, `needsReassignment` | sleeve/memory budget; idempotent task assignment |
| `lib/corp.js` | `selectMaterialsToSell`, `planBoostPurchases`, `BOOST_MATERIALS` | boost-material hold rule; warehouse-bounded stocking |
| `lib/darknet.js` (extended) | `planCrackTargets`, `mergeHeartbleedLogs`, `CRACK_WORKER_RAM`, `LOGS_FILE` | Stage A crack targeting and log corpus |

### New scripts

| Script | Item | RAM | Notes |
|---|---|---|---|
| `tools/program-buyer.js` | §5.1 | 74.25 / 20.25 / 6.75 GB | one-shot; `hasTorRouter` gate, cheapest-first, tolerates programs this BitNode doesn't stock |
| `tools/home-upgrader.js` | §5.3 | 50.15 / 14.15 / 5.15 GB | one-shot; no cost probe (saves 24 GB at SF4.1), spend tracked off the wallet |
| `tools/market-access.js` | §5.4 | 12.3 GB | one-shot; prices from `getConstants()` (0 GB), ladder semantics |
| `tools/corp-boost.js` | §5.5 | see caveat | one-shot; `bulkPurchase` not `buyMaterial`, MarketTA2 enabled |
| `tools/darknet-crack-worker.js` | §5.2 | 2.2 GB | peek-only heartbleed; target passed as an arg to avoid `getServerDetails` |
| `tools/ram-report.js` | §1 caveat | 1.9 GB | manager verdicts + `getFunctionRamCost` per-function costs |

### Modified

- **`daemon.js`** — status rendering delegates to `managerStatus()`; one-shots read `⏱ IDLE`.
- **`lib/constants.js`** — four `oneShot` MANAGERS entries at fractional priorities, `DARKWEB_EXTRAS`,
  `PORTS.DNET_CRACK`, and the new budget keys. `PROGRAMS` is now typed `ProgramName[]`.
- **`globals.d.ts`** — `ProgramName`, `SleeveTask`, `CorpCityName`, `CorpMaterialName` derived via
  `Parameters<>` (the aliases aren't exported from the `.d.ts`), plus the `CrackReport` port payload.
- **`advanced/stock-trader.js`** — real `has4SData()`/`getConstants()` probes replace try/catch
  guesswork; commission is read from the game; **the dead non-4S path now trades on momentum**.
  Both paths share one loss rule (`shouldRealize`): the momentum branch first shipped without
  the `profit > -MIN_PROFIT` gate the 4S branch has three lines above it, which would have let
  the *fallback* trader dump on a 2% dip and pay commission twice to realise the loss.
- **`advanced/sleeve-manager.js`** — sleeve count re-read each cycle (was read once, so sleeves
  bought mid-run were never assigned); assignment is idempotent via `getTask()`; buys sleeves
  and memory.
- **`advanced/corp-manager.js`** — **stopped selling boost materials.**
- **`tools/darknet-scan.js`** — new `crack` mode.

### Verified vs. unverified

**Verified here:** all pure logic (185 tests), type-checking under `checkJs`, and the
`static-ram.test.js` guard against dynamic `ns[...]` access. Two API-shape bugs were caught by
reading the definitions rather than by tests: `sleeve.purchaseSleeve`/`upgradeMemory` return a
`Result` object, not a boolean, so `if (result)` would have logged every attempt as a success;
and `buyMaterial` sets a per-second *rate* that would have kept buying after a one-shot exits.

**Not verified — needs the game.** Nothing here has been run against a live save. Specifically:

1. **Corporation RAM (§5.5).** Still the open question from §1. If the 20 GB-per-call figure is
   real, `corp-manager.js` is ~400 GB and has never launched, and `corp-boost.js` (~120 GB) will
   only run on a large home. `run src/tools/ram-report.js api` settles it in one call. The boost
   *logic* is tested and the boost-material bug fix is live regardless — that fix costs no RAM.
2. **`DarkscapeNavigator.exe` / `Formulas.exe` darkweb availability.** `program-buyer.js` skips a
   program the darkweb doesn't stock rather than failing, so a wrong guess is harmless, but the
   catalogue should be confirmed with `getDarkwebPrograms()` once TOR is owned.
3. **Momentum thresholds.** 4%/2% over a 20-sample window is a starting point, not a tuned figure.
   It is intentionally conservative — without a forecast, every position pays commission twice.
   Note the asymmetry is deliberate (exit faster than you enter) but untested against real price
   series; `shouldRealize` stops it from realising large losses, not from churning small ones.
4. **`corpBoostTargets` key order is priority order** (documented at both the constant and
   `planBoostPurchases`). The current order suits Agriculture. If a division's dominant
   multiplier is Real Estate, move it to the front or it gets starved on a small warehouse.

### Deliberately not built

**Stage B of §5.2 — the password generator.** Stage A (log capture) shipped; the generator did
not. The evidence still doesn't support it: `modelId` is documented as intentionally
undocumented, so there is no basis for deriving a password from hint + format + length. Building
a guesser now would mean inventing a mapping the game says you're meant to discover. `crack` mode
builds the corpus that would justify it; if a pattern emerges, the generator becomes a small
addition on top of `planCrackTargets` and `mergeHeartbleedLogs`.

P2/P3 items (§5.7-5.14) were out of scope for this pass and remain open.

---

## 8. What was implemented — P2/P3 (2026-08-18)

All eight §5.7-5.14 items. **255 tests pass** (189 after the P0/P1 pass, +66), `npm run check` clean.

### Two corrections to this audit, found while implementing

Both concern §5.13, and both were my own errors:

1. **`ipvgo.js` never called `analysis.getValidMoves`.** The usage scan matched the string inside
   the comment at `ipvgo.js:161` that explains why the script *avoids* it. This is exactly the
   false-positive class §1 warns about — but the adjudication pass there only re-checked functions
   reported as *missing*, never those reported as *used*, so a comment could inflate coverage
   without being caught. `GoAnalysis` was 0/10 used, not 1/10; the §2 row is corrected.
2. **The analysis functions are not free.** `getChains`, `getLiberties` and
   `getControlledEmptyNodes` cost **16 GB each** — I recorded them as 0 GB. Wiring all three in
   would have added 48 GB to a script that already declines `getValidMoves` at 8 GB. The
   recommendation was therefore unsound as written, and was not followed.

Method lesson worth keeping: re-check the *used* list by bare identifier too, not just the missing
list, and pull the RAM figure for anything a recommendation depends on.

### Shipped

| Item | What changed | Notes |
|---|---|---|
| **§5.10 `cloud.getRamLimit`** | `server-buyer.js` exports `pickPurchaseRam` / `pickUpgradeTarget`, both reading the live per-server ceiling. `DEFAULTS.maxPurchasedServerRAM` deleted. | Stub-tested. |
| **§5.9 Hacknet cache** | `pickCacheUpgrade` buys capacity when the hash bar sits ≥80% full. Runs *before* `spendHashes`, which would otherwise drain the evidence. | Payback ranking deliberately not used — cache adds no production. |
| **§5.7 Bladeburner** | `inBladeburner()` replaces the try/catch probe; joins division then faction; relocates on a population/chaos score with a 1.25× margin; commits the squad via `setTeamSize` on Operations and Black Ops. | `pickBestCity`/`teamSizeFor` stub-tested. |
| **§5.8 Gang** | Task ranking uses `formulas.gang.moneyGain/respectGain/wantedLevelGain` when `Formulas.exe` is owned; equipment ranked by usable stat gain per dollar via `getEquipmentStats`/`getEquipmentType`. | See "no invented math" below. |
| **§5.13 IPvGO (analysis)** | Per-opponent W/L, streak and bonus reported after each game via `analysis.getStats()` (0 GB), weakest opponent called out. | The 16 GB analysis calls were declined — see corrections above. |
| **§5.13 IPvGO (cheats)** | Opt-in `run ipvgo.js cheat`. Cheat runs in `tools/ipvgo-cheat-worker.js`. | See "cheat design" below. |
| **§5.14 Stanek** | `tools/stanek.js` — status, greedy `place`, continuous `charge`. | **`acceptGift` is not referenced anywhere**, so no script can accept the gift. |
| **§5.11 Grafting** | `tools/grafting.js` (manual), plus a guard in `faction-manager.js`. | See "grafting interaction" below. |

### Three decisions worth recording

**No invented math (§5.8).** The plan was to rank gang tasks from `getTaskStats` weights against
member stats. That means reproducing the game's scaling formula from memory, and a wrong constant
would silently produce worse assignments than the four-threshold ladder it replaced. Instead:
`formulas.gang.*` is exact and takes precisely the three objects the manager already holds, so it
became the real implementation, and the **existing ladder is the unchanged fallback** when
`Formulas.exe` isn't owned. `selectBestTask` is tested against supplied gains and derives nothing.
This also gives `program-buyer.js` buying `Formulas.exe` a visible payoff.

**Grafting interaction (§5.11).** `graftAugmentation` cancels current work, and
`faction-manager.js` calls `workForFaction` every 30 s — so the daemon would have cancelled every
graft within half a minute. Grafting reports as its own work type (`GraftingTask`, `type:
"GRAFTING"`), so the manager now detects an in-progress graft and leaves it alone. Without that
guard the tool would have been useless, and no unit test would have revealed it.

**Cheat design (§5.13).** Static RAM is charged for every `ns.<fn>` the *source* mentions, so an
`if (cheating)` guard saves nothing — every player would pay 10 GB for `removeRouter` and the two
probes, including those without SF-14.2 for whom the calls only throw. The cheat therefore runs in
a worker (11.6 GB, transient), leaving `ipvgo.js` +1 GB for `ns.run`. It fires at one point only:
when the fill stage is exhausted and the script was **about to pass anyway**, so a failed cheat
costs a turn that was already being given up. The residual risk is the documented ~10% ejection
chance on failures after the first attempt, which is why `shouldCheat` applies a higher bar
(90% vs 55%) from the second attempt on.

### Deliberately not done

**§5.12 Formulas in `batch-calculator.js` — considered and declined.** `formulas.hacking.growThreads`
is exact where `ns.growthAnalyze` approximates, but the gap is a few threads per batch, and
`batch-calculator.js` drives every HWGW batch the suite dispatches — up to `hwgwMaxBatches` per
target per cycle through a timing-critical landing sequence. A Formulas-gated branch there means
two code paths through the income engine, with the live one depending on whether `Formulas.exe`
happens to have been bought yet — so the tested path and the running path could silently diverge.
The reasoning is recorded at the top of `lib/formulas.js` so it isn't re-litigated. The Formulas
budget went to gang ranking instead, where there was no existing behaviour to regress.

`formulas.dnet.getHeartbleedTime` for sizing the crack worker's threads is still open — the crack
loop currently runs single-threaded, which is correct but slow. Worth doing once §5.2 Stage A has
produced a corpus and the loop is proven.

**`GoCheat.playTwoMoves` and the other four cheat functions** are unwired. `removeRouter` is the
one that fits the "about to pass anyway" trigger; the others need a strategy change to be useful,
which is a bigger question than API coverage.

### Caught in review, after the first pass

Three fixes landed after the implementation was first called done:

- **A failed cheat used to loop back into the cheat path.** `tryCheat` returned true for both
  "played" and "failed", and the caller `continue`d — so a failed cheat sent the fill stage round
  again, found nothing again, and fired another cheat in the same turn, each carrying its own
  ejection risk, until the decaying odds finally fell below the threshold. Only "played" returns
  true now; a failure falls through and passes, which is what the script did before cheats existed.
- **A test that could not fail.** `pickBestCity is deterministic when every city is identical`
  called the same pure function twice with the same stub and compared the results. The real
  hazard is different — `getCityEstimatedPopulation` is an *estimate* that jitters — and the
  guard against it is `CITY_SWITCH_MARGIN`, which that test never touched. Replaced with
  `shouldSwitchCity`, extracted and tested at and around the margin.
- `ipvgo.js` had its imports above the file header comment, unlike every other file in the repo.

### Still unverified without the game

Everything from §7 stands, plus: the Bladeburner city score (`population / (1 + chaos)`) is a
stated heuristic, not a game formula; the Stanek fragment ranking prefers hacking types on the
assumption this suite lives on hacking income; and no cheat has ever been played, so the ~10%
ejection figure is quoted from the API docs rather than observed.
