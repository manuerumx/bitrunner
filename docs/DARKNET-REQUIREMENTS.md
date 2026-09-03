# Darknet: Requirements

Everything you need **before** the darknet tools do anything useful, and what each
individual command needs on top of that. Read
[DARKNET-QUICKSTART.md](DARKNET-QUICKSTART.md) first if you just want the steps;
this file is the checklist you come back to when a step refuses to work.

Design rationale lives in [DARKNET.md](DARKNET.md) — that document explains *why* the
subsystem is shaped this way. This one only lists what must be true.

---

## 0. Version warning — read before you search the web

This repo targets **Bitburner 3.0.1**. The darknet (`ns.dnet`) is new; anything written
for Bitburner **2.x** — the wiki, Reddit threads, Steam guides, most YouTube — predates it
entirely and will not mention it.

The official API markdown on the `bitburner-src` **`dev` branch is ahead of 3.0.1** and
documents functions that do not exist in our build. Confirmed example:

| Function | On `dev` docs | In 3.0.1 (`NetscriptDefinitions.d.ts`) |
|---|---|---|
| `dnet.freezeServer(host)` | documented | **absent** — zero occurrences |

**The authority for this repo is `NetscriptDefinitions.d.ts` at the repo root.** It is the
`.d.ts` that ships with the build we run. When a web page and that file disagree, the file
wins. To check whether something exists at all:

```bash
grep -n "freezeServer" NetscriptDefinitions.d.ts     # no output = not in 3.0.1
```

3.0.1 ships **22** `dnet` functions: the 20 real ones plus the `labreport` / `labradar`
easter eggs. This suite calls 7 of them.

---

## 1. Hard prerequisites — nothing runs without these

| # | Requirement | How to check | How to get it |
|---|---|---|---|
| 1 | **TOR router** | terminal: `buy -l` lists darkweb stock | `run src/tools/program-buyer.js` (needs SF-4), or buy it in-game from the city location that sells it |
| 2 | **`DarkscapeNavigator.exe`** on home | terminal: `ls` on home | `buy DarkscapeNavigator.exe` after TOR, or `run src/tools/program-buyer.js` |
| 3 | **A BitNode where the darkweb stocks it** | `run src/tools/program-buyer.js dry` — a missing program is skipped, not an error | nothing to do; it is not stocked everywhere |

`DarkscapeNavigator.exe` is the API gate. `dnet.isDarknetServer()` is documented as the one
`dnet` call that does *not* require it, which implies every other one does. Both tools test
the gate the same way — a `getStasisLinkLimit()` call inside a `try` — and print:

```
Darknet API unavailable — get darknet access (DarkscapeNavigator.exe) first.
```

`src/lib/constants.js` lists it in `DARKWEB_EXTRAS`, so `program-buyer.js` buys it
automatically after the port openers.

---

## 2. Per-command requirements

Home-side RAM is the script's **static bill**: 1.6 GB script base plus every distinct `ns`
function reachable through its import chain. These are computed from the RAM costs in
`NetscriptDefinitions.d.ts`; verify in-game with the terminal's `mem` command, which is
authoritative:

```
mem /src/tools/stasis.js
mem /src/tools/darknet-scan.js
```

| Command | Free RAM on home | Free RAM on the target | Also needs |
|---|---:|---:|---|
| `darknet-scan.js` (crawl) | ~6.35 GB | 1.9 GB per crawl host | ≥1 stored password to get past `darkweb` |
| `darknet-scan.js intel` | ~6.35 GB | — | a non-empty `/data/darknet-map.txt` |
| `darknet-scan.js crack` | ~6.35 GB | 2.2 GB on the vantage host | charisma ≥ each target's `requiredCharisma`; a `seenFrom` vantage point in the map |
| `stasis.js` (status) | ~5.75 GB | — | — |
| `stasis.js auto` | ~5.75 GB | 13.6 GB per target | free slot + password + exec route + online + non-stationary |
| `stasis.js link <host> [pw]` | ~5.75 GB | 13.6 GB | a password (the store write survives an exec failure — see §8) |
| `stasis.js unlink <host>` | ~5.75 GB | 13.6 GB | a stored password |

Home-side breakdown, if you want to check the arithmetic:

| | `darknet-scan.js` | `stasis.js` |
|---|---:|---:|
| script base | 1.60 | 1.60 |
| `ns.getServer` (via `lib/darknet.js`) | 2.00 | 2.00 |
| `ns.exec` | 1.30 | 1.30 |
| `ns.scp` | 0.60 | 0.60 |
| `ns.getPlayer` (charisma, for `crack`) | 0.50 | — |
| `ns.dnet.probe` | 0.20 | — |
| `ns.dnet.getServerDetails` | 0.10 | 0.10 |
| `ns.dnet.connectToSession` | 0.05 | 0.05 |
| `ns.isRunning` | — | 0.10 |
| **total** | **6.35 GB** | **5.75 GB** |

Everything else these scripts touch is free: `tprint`, `print`, `sleep`, `args`, `read`,
`write`, `getScriptName`, all port functions, `dnet.getStasisLinkLimit`,
`dnet.getStasisLinkedServers`.

### Worker RAM, on the darknet server

Workers are sized to the byte, because darknet servers are small and every extra call
narrows the set of hosts a worker can land on. The recurring trick is passing the hostname
in as an argument instead of calling `ns.getHostname()` (0.05 GB).

| Worker | Base | Calls | Total |
|---|---:|---|---:|
| `darknet-probe-worker.js` | 1.6 | `probe` 0.2 + `getServerDetails` 0.1 | **1.9 GB** |
| `darknet-crack-worker.js` | 1.6 | `heartbleed` 0.6 | **2.2 GB** |
| `stasis-worker.js` | 1.6 | `setStasisLink` 12 | **13.6 GB** |

A target's free RAM is `maxRam - usedRam`, and on a darknet server **`usedRam` includes the
owner's blocked RAM**. That is why a server with plenty of nominal RAM can still report
`blocked-ram`.

---

## 3. Requirements the API imposes on the design

Four constraints from `NetscriptDefinitions.d.ts` explain nearly every failure you will hit.

| Constraint | What it means for you |
|---|---|
| `probe()`, `authenticate()`, `heartbleed()`, `memoryReallocation()` and `induceServerMigration()` **only reach directly-connected servers** | The net cannot be mapped from home. Code has to run *on* darknet servers — hence the workers. |
| `setStasisLink()` **only acts on the server the script runs on** | Home cannot link a remote host. `stasis-worker.js` exists purely to be the thing standing on the target. |
| **Sessions are per-PID**, not per-player | Authenticating in the terminal grants your scripts nothing. Every run re-establishes its own session from the stored password. |
| **The net mutates on a cycle** — servers move, restart (killing running scripts), go offline (often permanently), and new ones appear | No topology can be cached as truth. Stale map entries are kept deliberately. Stasis links are how you pin what you care about. |

Two more that cause otherwise-baffling failures:

- **`scp()` works at any distance** (it needs a session on the destination), but **`exec()`
  additionally needs a route**: a direct connection, an installed backdoor, or an existing
  stasis link. You can copy files to a server you cannot start a script on.
- **`heartbleed()` needs no password** — the only way to learn something about a server you
  have not cracked. But it refuses outright above your charisma.

---

## 4. Charisma requirements

Charisma is the second gate after `DarkscapeNavigator.exe`, and it is the one that decides
how *deep* you can go.

| Where it bites | Effect |
|---|---|
| `heartbleed(host)` | **Hard refusal** if `requiredCharismaSkill > your charisma` — `NotEnoughCharisma (451)`. `planCrackTargets()` filters these out before trying. |
| `authenticate(host, pw)` | Not a requirement, but authentication "takes much longer" below the server's level, and the docs say it becomes *impossible* on certain deep servers. |
| `memoryReallocation()` | Amount of RAM recovered scales with charisma. |
| `induceServerMigration()` | Effect scales with charisma. |

Each mapped host records its bar as `requiredCharisma` in `/data/darknet-map.txt`;
`darknet-scan.js intel` prints it as `heartbleed charisma ≥ N`. `crack` mode prints your
current charisma in its summary line, so you can see how far short you are.

Ways to raise it: university courses, faction/company work, and `dnet.phishingAttack()`
(2 GB, runs only from a script *on* a darknet server, yields money **and** charisma —
**not implemented in this suite**, see [DARKNET.md](DARKNET.md) §9).

---

## 5. Stasis link slots

- The cap is global: `ns.dnet.getStasisLinkLimit()` (0 GB). `stasis.js` prints it as
  `=== Stasis links: N / LIMIT ===`.
- **The only way to raise it is finding special augmentations in the deep darknet.** There
  is no purchase, no upgrade, no script.
- Our planner treats existing links as **sticky** — they hold their slot and are never
  swapped out. To reallocate a slot you must `stasis.js unlink <host>` yourself.
- Links are worth spending on **non-stationary** servers only. A stationary story server
  cannot move, so pinning it wastes a slot; the planner skips those with reason
  `stationary`.

---

## 6. Files and ports the subsystem requires

Created on demand in-game; a missing file is never fatal (parsed tolerantly to `{}`).

| File | Constant | Contents | Written by |
|---|---|---|---|
| `/data/darknet-passwords.txt` | `PASSWORD_FILE` | `{host: password}` — **and the registry of actionable servers** | `stasis.js link` **only** |
| `/data/darknet-map.txt` | `MAP_FILE` | last-seen topology + cracking intel per host | `darknet-scan.js` (crawl) |
| `/data/darknet-logs.txt` | `LOGS_FILE` | heartbleed corpus, deduplicated | `darknet-scan.js crack` |

| Port | Payload | Direction | Semantics |
|---|---|---|---|
| 11 `DNET_STASIS` | `StasisResult` | stasis-worker → `stasis.js` | latest-state (one op in flight) |
| 12 `DNET_PROBE` | `ProbeReport` | probe-worker → `darknet-scan.js` | queue (parallel workers) |
| 13 `DNET_CRACK` | `CrackReport` | crack-worker → `darknet-scan.js` | queue |

Payload shapes are declared in `globals.d.ts`, so producer and consumer are typechecked
against one contract.

---

## 7. What is **not** required

Worth stating, because each of these costs people time:

- **No Source File.** The darknet tools need none. SF-4 only matters because
  `program-buyer.js` uses Singularity to buy `DarkscapeNavigator.exe` for you — you can buy
  it by hand instead.
- **No backdoor**, for `scp`. Backdoors only matter as one of the three `exec` routes.
- **Terminal authentication does not help.** Sessions are per-PID; typing a password into
  the terminal grants your scripts nothing and never touches the store.
- **`ns.scan()` does not see darknet servers**, so `src/tools/connect.js` and
  `src/tools/analyze.js` are useless here. Use `ns.dnet.probe()`.
- **You do not need a stasis link on `darkweb`** to crawl through it. The crawler only
  needs its password plus 1.9 GB free there; `darkweb` is directly connected to home, which
  already satisfies the exec route.

---

## 8. The requirement the pipeline cannot satisfy itself

**A password must reach `/data/darknet-passwords.txt` before the crawler leaves home.**

The only writer is `savePassword()`, whose only caller is `stasis.js link <host> <password>`
— a human typing a password. `ns.dnet.authenticate()`, the one API that can *discover* a
password, is not called anywhere in `src/`. With an empty store, `pickCrawlHosts()` returns
nothing, no worker is ever deployed, and the map never grows past home's neighbours.

Two details that matter when you satisfy it by hand:

- **The empty string is a real password.** `ZeroLogon`-model servers authenticate on `""`.
  Password resolution (`resolveLinkPassword()`) handles it correctly — pass it as
  `link <host> ""`.
- **The store write survives a failed link.** `stasis.js link` saves the password whenever
  the *session* succeeded, even if `scp`/`exec` then failed for want of 13.6 GB on the
  target. Look for `password for <host> saved to /data/darknet-passwords.txt`, not for the
  link verdict.

See [DARKNET-QUICKSTART.md](DARKNET-QUICKSTART.md) §3 for how to actually get that first
password, and [DARKNET.md](DARKNET.md) §9 for the full analysis and the open leads
(model-ID table, the `getAuthenticateTime` timing-oracle hypothesis, response-code
branching).
