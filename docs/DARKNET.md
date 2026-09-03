# The Darknet Subsystem

**Scope:** every script under `src/` that touches `ns.dnet` — `lib/darknet.js`,
`tools/darknet-scan.js`, `tools/darknet-probe-worker.js`, `tools/darknet-crack-worker.js`,
`tools/stasis.js`, `tools/stasis-worker.js`.
**Status:** mapping, stasis linking and heartbleed intel are built and tested. Password
*discovery* is not — see §9.

> **Just want to use it?** Start with [DARKNET-QUICKSTART.md](DARKNET-QUICKSTART.md) — the
> step-by-step walkthrough, including the manual step that unsticks a scan pinned at one
> hop. The prerequisite checklist is [DARKNET-REQUIREMENTS.md](DARKNET-REQUIREMENTS.md).
> This document is the *why*.

> **Short version.** The darknet can only be explored from *inside* it: almost every
> `ns.dnet` call reaches only servers directly connected to the machine the script is
> running on. So we ship small workers out to darknet servers and have them report home
> over ports. Everything we learn lands in three JSON files under `/data/`. The one thing
> the pipeline cannot yet do is *obtain a password on its own*, which is why it stalls at
> home until a human seeds the store. §9 explains exactly why.

---

## 1. Why the darknet needs its own architecture

Four API constraints shape every design decision here. They are the reason this subsystem
looks nothing like `hack-coordinator.js`.

| Constraint | Consequence |
|---|---|
| **`probe()`, `authenticate()`, `heartbleed()`, `memoryReallocation()` and `induceServerMigration()` only reach servers _directly connected_ to the current server.** | The net cannot be mapped from home. We must run code *on* darknet servers. Hence the workers. |
| **`setStasisLink()` acts only on the server the script is running on.** | Linking is not something home can do to a remote host; `stasis-worker.js` exists solely to be the thing standing on the target. |
| **Sessions are per-PID.** A session belongs to one script instance, not to the player. | Authenticating in the terminal grants scripts nothing. Every run must re-establish its own session from a stored password. This is why `/data/darknet-passwords.txt` is the centre of the whole design. |
| **The net mutates on a cycle.** Servers move, restart (killing running scripts), go offline — often permanently — and new ones appear. | Nothing about the topology can be cached as truth. Stale map entries are *kept*, because a host that mutated out of view is not necessarily gone. Stasis links exist to pin the hosts worth keeping. |

Two more rules worth memorising, because they explain otherwise-baffling failures:

- **`scp()` works at any distance** (needs a session on the destination), but **`exec()`
  additionally needs a route**: a direct connection, an installed backdoor, or an existing
  stasis link. You can therefore copy files to a server you cannot start a script on.
- **`heartbleed()` needs no password** — it is the only way to learn something about a
  server you have not cracked. But it refuses outright if the server's required charisma
  exceeds yours.

---

## 2. The pieces

```
home                                    darknet server
────────────────────────────────        ────────────────────────────────
tools/darknet-scan.js  ──scp+exec──►  tools/darknet-probe-worker.js   1.9 GB
   crawl / intel / crack                  probe() neighbours ──┐
                                                               │ Port 12
tools/darknet-scan.js  ──scp+exec──►  tools/darknet-crack-worker.js  2.2 GB
   crack mode                             heartbleed(peek) ─────┐
                                                               │ Port 13
tools/stasis.js        ──scp+exec──►  tools/stasis-worker.js         13.6 GB
   status / auto / link / unlink          setStasisLink() ─────┐
                                                               │ Port 11
lib/darknet.js  ◄──────── pure logic + file I/O ───────────────┘
   planners, mergers, parsers, the password store
```

`lib/darknet.js` holds everything testable: the stasis planner, the map merger, the log
merger, the crack-target planner, password resolution, and the file read/write helpers.
All 37 darknet tests in `test/darknet.test.js` target that module — the tools themselves
are thin I/O shells around it.

### Data files (in-game, under `/data/`)

| File | Constant | Contents |
|---|---|---|
| `/data/darknet-passwords.txt` | `PASSWORD_FILE` | `{host: password}`. **Doubles as the registry of known servers** — a host is actionable exactly when we know its password. |
| `/data/darknet-map.txt` | `MAP_FILE` | `{host: {modelId, depth, difficulty, hint, data, passwordFormat, passwordLength, requiredCharisma, isStationary, isOnline, seenFrom, neighbors}}`. Last-seen topology plus cracking intel. |
| `/data/darknet-logs.txt` | `LOGS_FILE` | `{host: {logs: [...]}}`. The heartbleed corpus, accumulated without duplicates. |

### Ports

| Port | Payload | Direction |
|---|---|---|
| 11 `DNET_STASIS` | `StasisResult` — link/unlink verdict | stasis-worker → stasis.js |
| 12 `DNET_PROBE` | `ProbeReport` — neighbour intel | probe-worker → darknet-scan.js |
| 13 `DNET_CRACK` | `CrackReport` — scraped logs | crack-worker → darknet-scan.js |

Port 12 and 13 use **queue semantics** (`pushPortData`, no clear) so several workers
reporting at once cannot clobber each other. Port 11 uses latest-state
(`writePortData`) because only one link operation is ever in flight. Payload shapes are
declared in `globals.d.ts` so producer and consumer are typechecked against one contract.

---

## 3. `tools/darknet-scan.js` — mapping

```
run /src/tools/darknet-scan.js          crawl, update the map, print discoveries
run /src/tools/darknet-scan.js intel    cracking intel for every uncracked server
run /src/tools/darknet-scan.js crack    heartbleed every reachable uncracked server
```

The default (crawl) mode does this:

1. **Probe home directly.** `buildLocalReport(ns, "home", ns.dnet.probe())` — home's own
   neighbourhood needs no worker. In practice this is just `darkweb`.
2. **Pick crawl hosts.** `pickCrawlHosts(getStasisCandidates(ns))` keeps every known
   server that is online, **has a stored password**, has an exec route, and has ≥1.9 GB
   free.
3. **Deploy a prober to each.** `connectToSession(host, password)` → `scp` the worker and
   its import chain → `exec` → wait up to 15 s for a report on port 12.
4. **Merge.** `mergeDarknetMap()` folds every report in: the prober's own entry gets a
   fresh neighbour list, and each neighbour's intel is upserted with `seenFrom` set to the
   prober. Hosts absent from this round are left untouched.
5. **Save and report** to `/data/darknet-map.txt`, printing anything newly discovered.

`intel` mode just pretty-prints the uncracked half of the map, shallowest first.

---

## 4. `tools/darknet-crack-worker.js` — heartbleed intel

`crack` mode is **Stage A** of the cracking pipeline: build a corpus of what darknet
server logs actually say.

`planCrackTargets()` chooses `(from, target)` pairs. Because `heartbleed()` only reaches
directly-connected servers, every target needs a vantage point — the already-cracked host
whose probe report saw it, recorded as `seenFrom`. It then applies two hard filters
straight from the API docs (skip anything above your charisma; skip offline hosts) and
orders easiest-first, so a run cut short spends its time where it is most likely to return
something.

The worker calls `heartbleed(target, {peek: true, logsToCapture})`. **Peek is deliberate:**
peeking reads the most recent lines without consuming them, so a repeat capture can never
destroy intel this run has not yet stored. `mergeHeartbleedLogs()` then appends only lines
not already on file.

**This stage deliberately never calls `authenticate()`.** The `.d.ts` says the server model
list is *"intentionally undocumented… you are supposed to experiment and discover the
models"*, so there was no evidence a password could be derived from hint + format + length.
Building the corpus was meant to answer that question. See §9 for where that now stands.

---

## 5. `tools/stasis.js` — pinning servers

```
run /src/tools/stasis.js                      status: links vs limit, candidates, skip reasons
run /src/tools/stasis.js auto                 fill every free slot with the best candidates
run /src/tools/stasis.js link <host> [pw]     link one server (password saved on success)
run /src/tools/stasis.js unlink <host>        remove a link, freeing a global slot
```

A stasis link pins a darknet server so the mutation cycle cannot move it or take it
offline, **and** doubles as a permanent remote-exec route. Links are globally capped
(`getStasisLinkLimit()`, raised by deep-darknet augmentations), so `planStasisLinks()`
decides who deserves a slot.

Existing links are **sticky** — they occupy slots and are never swapped out. Eligible
candidates are ranked **deepest first** (hardest to re-find if the net mutates them away),
then by difficulty, then hostname for determinism.

Ineligible candidates get a machine-readable skip reason, and the order of the checks in
`SKIP_CHECKS` matters — the first failing check names the reason, so reasons stay stable
for tests and status output:

| Reason | Meaning |
|---|---|
| `linked` | already linked |
| `offline` | offline, possibly permanently |
| `stationary` | fixed story server — it cannot move, so a link is wasted |
| `no-password` | not in the password store |
| `no-exec-route` | needs a direct connection, backdoor, or existing link |
| `blocked-ram` | would fit if the owner's RAM were freed via `memoryReallocation()` |
| `no-ram` | under 13.6 GB free on the target |
| `no-slot` | eligible, but the global cap is full |

`stasis-worker.js` is the thing that actually calls `setStasisLink()`, because that
function only acts on its own host. It reports on port 11; `applyLink()` also falls back
to checking the authoritative link list, since the worker can die before reporting if the
server restarts mid-call.

---

## 6. RAM budgets

Workers are sized to the *byte*, because darknet servers are small and every extra
function call narrows how many hosts a worker can land on. The recurring trick: **pass the
hostname in as an argument** rather than calling `ns.getHostname()` (0.05 GB) or
`getServerDetails()` (0.1 GB) for it.

| Script | Base | Calls | Total |
|---|---:|---|---:|
| `darknet-probe-worker.js` | 1.6 | `probe` 0.2 + `getServerDetails` 0.1 | **1.9 GB** |
| `darknet-crack-worker.js` | 1.6 | `heartbleed` 0.6 | **2.2 GB** |
| `stasis-worker.js` | 1.6 | `setStasisLink` 12 | **13.6 GB** |
| `darknet-demo.js` (reference) | 1.6 | `probe` 0.2 + `getServerDetails` 0.1 + `authenticate` 0.4 + `scp` 0.6 + `exec` 1.3 | **4.2 GB** |

Ports are free. The demo row is there for contrast: a self-replicating script has to carry
`scp` + `exec` everywhere it goes, which more than doubles its footprint and *narrows* the
set of servers it can land on compared to our reporter workers.

---

## 7. The full loop

```
       ┌─ run darknet-scan.js ──────────────────────────────────┐
       │  probe home → deploy probers to cracked hosts → merge   │
       └────────────────────────┬───────────────────────────────┘
                                ▼
                    /data/darknet-map.txt
                                │
             ┌──────────────────┴──────────────────┐
             ▼                                     ▼
   run darknet-scan.js intel            run darknet-scan.js crack
   (read hints, formats, lengths)       (heartbleed → /data/darknet-logs.txt)
             │                                     │
             └──────────────┬──────────────────────┘
                            ▼
                  crack a password  ← THE MANUAL STEP (§9)
                            │
                            ▼
        run stasis.js link <host> <password>   → password stored
                            │
                            ▼
        run stasis.js auto     (pin the best candidates)
                            │
                            ▼
        run darknet-scan.js    (now crawls *from* the new host — deeper)
```

Each cracked host widens the next scan's reach, because it becomes a vantage point for
both `probe()` and `heartbleed()`.

---

## 8. Troubleshooting

**"Darknet API unavailable"** — you need `DarkscapeNavigator.exe`. Both tools probe for it
by calling `getStasisLinkLimit()` in a `try` before doing anything else.

**Everything runs from home; no worker is ever deployed.** The password store is empty.
See §9 — this is the expected behaviour of the current design, not a malfunction.

**A host shows `no-exec-route`.** `scp` reached it but `exec` will not. It needs a direct
connection, a backdoor, or a stasis link. Note you can still `scp` there.

**A host shows `blocked-ram`.** The server owner's processes are hogging RAM.
`ns.dnet.memoryReallocation()` frees some — **we do not call it anywhere yet**, so this is
currently an informational dead end.

**Probe/crack reports never arrive.** Both wait 15 s. Common causes: the worker did not fit
(check `exec` returned non-zero), the server restarted mid-run (the mutation cycle kills
running scripts), or a stale report from a dead run is sitting on the port — both modes
`clearPort` on entry to prevent this.

---

## 9. The bootstrap problem — read this before "fixing" anything

The pipeline is not broken. It is **unseeded**, and the gap is one missing edge in the
dependency graph:

```
darknet-scan.js:230   crawlHosts = pickCrawlHosts(getStasisCandidates(ns))
lib/darknet.js:230    filter(c => c.isOnline && c.hasPassword && ...)
lib/darknet.js:325    hasPassword: host in store          ← /data/darknet-passwords.txt
lib/darknet.js:240    savePassword()   ← the only writer
stasis.js:170         savePassword(ns, host, resolved.password)   ← the only caller
```

**The only thing that can write the password store is a human typing
`stasis.js link <host> <password>`.** With an empty store, `pickCrawlHosts()` returns
nothing, no worker is ever deployed, and the crawler is pinned to home permanently.
`crack` mode appears to half-work only because `crackRemote()` short-circuits
`from === "home"`, letting it reach home's direct neighbours and no further.

`ns.dnet.authenticate()` — the one API that can *discover* a password — is **not called
anywhere in `src/`**. That is the missing edge.

Manual authentication in the game terminal does not help, because sessions are per-PID: it
grants scripts nothing and never touches the store.

### Fixed 2026-08-21 (working tree, not committed): empty passwords are now storable

`stasis.js` resolved its password with a truthiness check (`passwordArg ?? store[host]`,
then `if (!password) return`). That made the **empty string** — a real password, used by
every `ZeroLogon`-model server — indistinguishable from "no password known", so a
ZeroLogon host could not be entered into the store at all. Since the store gates the whole
crawler, that single check was enough to keep it at home even for a user who knew the
password.

Password resolution now lives in `resolveLinkPassword()` in `lib/darknet.js` (pure, seven
tests). `lib/darknet.js` was always correct here — `hasPassword: host in store` handles
`""` properly — the bug was confined to the CLI entry path.

```
run /src/tools/stasis.js link darkweb ""     # now works
```

### Still open

1. **No password discovery.** A seeder that walks home's `probe()` list and calls
   `authenticate(host, password)` against a `modelId → password` table would close the
   deadlock. The table currently has exactly one known entry: **`ZeroLogon` → `""`**
   (from `tools/darknet-demo.js`, the reference script shipped with the API docs).
2. **The model table itself is still empty.** `modelId` *is* now persisted — every probe
   report carries it into `MAP_FILE`, and `darknet-scan.js intel` prints it as the first
   field of each host's line, so model IDs accumulate as a side effect of crawling. What
   does not exist is the `modelId → password strategy` table those observations feed:
   today it would have exactly one row, `ZeroLogon` → `""`. A seeder that reads the map and
   tries the known strategy per model is the remaining half of this lead.
3. **A timing oracle probably exists.** `formulas.dnet.getAuthenticateTime()` takes a
   `correctCharactersInPassword` parameter documented as *"only used for `2G_cellular`
   model servers"*. If authentication time varies with how many characters are right, that
   model can be cracked character-by-character — **O(length × charset)** instead of
   charset^length. This is a hypothesis with a free test (`getAuthenticateTime` is 0 GB and
   changes no game state): sweep `k` from 0 to `passwordLength` and check for monotonicity.
4. **Response codes are logged but never branched on.** A timing attack makes this a
   correctness requirement, not polish: `RequestTimeOut (408)` means the sample must be
   **discarded**, not treated as a wrong password; `NotEnoughCharisma (451)` is a hard
   skip; `DirectConnectionRequired (351)` means `seenFrom` is stale. `getDarknetInstability()`
   (0 GB) reports how often 408 will fire.
5. **Unused value levers.** Of 22 `dnet` functions we call 7 — `probe`, `getServerDetails`,
   `connectToSession`, `heartbleed`, `setStasisLink`, `getStasisLinkLimit`,
   `getStasisLinkedServers`. The other 15 are never called: `authenticate`,
   `memoryReallocation`, `openCache`, `phishingAttack`, `promoteStock`,
   `induceServerMigration`, `getDarknetInstability`, `nextMutation`,
   `getServerRequiredCharismaLevel`, `getBlockedRam`, `getDepth`, `isDarknetServer`,
   `unleashStormSeed`, plus the `labreport` / `labradar` easter eggs.

   Two are deliberate omissions, not gaps: `getBlockedRam` (0 GB) and `getDepth` (0.1 GB)
   both return fields `getServerDetails` already carries, and we read them off that one
   call. `unleashStormSeed` is described in the `.d.ts` as causing "catastrophic damage".

   Worth noting individually:
   - **`phishingAttack()`** (2 GB) yields money *and* charisma, and charisma is the gate on
     heartbleed depth — so idle darknet RAM converts directly into progress on what is
     blocking us. It only runs from scripts on darknet servers.
   - **`memoryReallocation()`** (1 GB) turns our own `blocked-ram` skip reason into eligible
     stasis targets. We wrote the skip reason for a function we never call.
   - **`openCache()`** (2 GB) returns a `karmaLoss`, and a spreading loop multiplies it —
     check the direction that moves you relative to gang/faction goals before automating it.
   - **`nextMutation()`** (0 GB) is the semantically correct wait instead of `sleep()`, but
     it fires on *global* mutations, most of which are not locally visible — a wake signal,
     not a rate limiter.
   - **`promoteStock()`** changes stock *volatility*, not forecasts, so `stock-trader.js`
     cannot consume it as a signal as-is.

---

## 10. About `tools/darknet-demo.js`

This is the reference script from the API docs, kept for study. **It is not part of the
pipeline and should not be run unattended.** It is architecturally the opposite of ours: a
self-propagating worm that runs on each server, probes its own neighbours, authenticates
edge-by-edge, and copies itself onward. It needs no map precisely because it only ever
touches what is adjacent to it.

**The file itself was removed from `src/` on 2026-08-21** — `filesync.json` syncs everything
under `src/` into the game, and an auto-spreading loop with no kill switch does not belong
next to the tools. Its two load-bearing parts are preserved here verbatim, because they are
the only `modelId` evidence we have:

```js
// The model table — one known entry.
switch (details.modelId) {
  case "ZeroLogon":
    return authenticateWithNoPassword(ns, hostname);

  default:
    ns.tprint(`Unrecognized modelId: ${details.modelId}`);   // ← the discovery mechanism
    return false;
}

// ZeroLogon servers always have an empty password.
const authenticateWithNoPassword = async (ns, hostname) => {
  const result = await ns.dnet.authenticate(hostname, "");
  return result.success;
};
```

The `default:` branch is the important half: every unknown model it meets is a name we did
not have. Running the demo once from a vantage point and reading its output is still the
cheapest way to harvest model IDs — but that job belongs to the seeder in §9, which can do
it without spreading.

It also guarded its session correctly, which is worth copying: `getServerDetails()` first,
skip if `!isConnectedToCurrentServer || !isOnline`, and return early if `hasSession` is
already true rather than re-authenticating.

Known defects, if you do run it: it ignores `scp`/`exec` return values (so it fails to
spread silently when a target lacks its 4.2 GB), never persists a password, loops forever
on a 5 s timer with no kill switch, and ignores `result.code` entirely.

The two designs are complementary rather than competing. Worm-style edge-walking is how
you reach depth; the store, map and planner are how you *remember* it across mutations. A
worm instance can `pushPortData` home exactly like our probe worker does — ports are
global, so reporting home from depth 5 costs nothing.

---

## 11. Test coverage

`test/darknet.test.js` — 38 tests, all against pure functions in `lib/darknet.js`:
`parsePasswordStore`, `planStasisLinks` (every skip reason and the ranking), `buildCandidate`,
`pickCrawlHosts`, `mergeDarknetMap`, `planCrackTargets`, `mergeHeartbleedLogs`,
`resolveLinkPassword`.

The rule the subsystem tries to hold: **pure logic lives in `lib/darknet.js` and is tested;
the tools hold only sequencing and I/O.** Extracting `resolveLinkPassword()` is what made
the §9 bug testable at all — it had been an inline truthiness check in `main()`, in a file
with no coverage.

The boundary is not perfectly clean, and it is worth naming where it leaks. `stasis.js:161-172`
still decides things: the "no password known" branch, and the `resolved.shouldSave &&
result !== "no-session"` gate that only stores a password once a session has proved it.
That conjunction is real logic sitting in an untested shell — the same shape as the bug
that started this. If it grows another condition, extract it too.

```bash
npm test        # 322 tests
npm run check   # tsc against jsconfig.json
```
