# Darknet Quickstart

**The one-line answer to "why do I never get past one connection":** the crawler can only
launch a probe *from* a server whose password is already in
`/data/darknet-passwords.txt`, and nothing in this suite can obtain a password on its own.
Until you type one in by hand, every scan is pinned to home, and home has exactly one
darknet neighbour — `darkweb`. That is the whole bug. It is a missing input, not a broken
script.

This page is the fix, step by step. Requirements checklist:
[DARKNET-REQUIREMENTS.md](DARKNET-REQUIREMENTS.md). Design rationale:
[DARKNET.md](DARKNET.md).

> **Version:** Bitburner **3.0.1**. `ns.dnet` does not exist in 2.x, so nothing written for
> 2.x applies, and the official `dev`-branch docs are *ahead* of us (they document
> `dnet.freezeServer`, which 3.0.1 does not have). The authority is
> `NetscriptDefinitions.d.ts` at the repo root.

---

## Three rules that explain every darknet failure

1. **The darknet can only be explored from inside it.** `probe()`, `heartbleed()` and
   `authenticate()` reach only servers *directly connected* to the machine the script is
   running on. That is why we ship tiny workers out and have them report home over ports.
2. **A host becomes usable exactly when its password is in the store.** The password file
   *is* the registry. No password → the host is inert, no matter how well it is mapped.
3. **Only one command writes that store:** `stasis.js link <host> <password>`. That is you,
   at the keyboard. Everything else in the pipeline reads it.

Rules 2 and 3 together are the deadlock you are sitting in.

---

## Step 0 — Confirm you have darknet access

```
run /src/tools/stasis.js
```

If you see `Darknet API unavailable — get darknet access (DarkscapeNavigator.exe) first.`
stop here and go get it: TOR router, then `buy DarkscapeNavigator.exe`, or let
`run /src/tools/program-buyer.js` do both (needs SF-4).

If you see `=== Stasis links: 0 / N ===` you are in. Note that **N** — it is your global
link cap, and the only way to raise it is finding augmentations deep in the darknet.

---

## Step 1 — First scan

```
run /src/tools/darknet-scan.js
```

Expect exactly one host. This is correct, not a failure:

```
darknet-scan: probed home + 0/0 servers, map now 1 hosts (1 new) → /data/darknet-map.txt

=== Newly discovered ===
  darkweb — model <ModelId>, depth 0, difficulty ...
      password: <format> × <length>, heartbleed charisma ≥ ...
      hint: ...
```

`0/0 servers` is the deadlock in numbers: **zero crawl hosts were eligible**, because the
password store is empty. Home probed its own neighbourhood and stopped.

---

## Step 2 — Read what you have

```
run /src/tools/darknet-scan.js intel
```

This prints every mapped host you have *no* password for, shallowest first, with its model
ID, password format, length, hint, `data` field, and the charisma bar for `heartbleed`.
Right now that is one row: `darkweb`.

---

## Step 3 — Get the first password ← **the step you are missing**

You need `darkweb`'s password. Try the cheap thing first (3a), then gather what the API
will tell you (3b, 3c), then do the actual puzzle (3d).

### 3a. Try the empty password

The only server model this repo has evidence for is **`ZeroLogon`**, and ZeroLogon servers
authenticate on the **empty string**:

```
run /src/tools/stasis.js link darkweb ""
```

**Read the output carefully.** You are not looking for the link to succeed — the link half
needs 13.6 GB free on `darkweb` and will very likely fail. You are looking for this line:

```
password for darkweb saved to /data/darknet-passwords.txt
```

That line is the win. `stasis.js` saves the password whenever the **session** succeeded,
even when the `scp`/`exec` half then failed. A `✗ darkweb: exec refused…` followed by
`password … saved` means **you are unblocked** — go to Step 4. Run **3c** first anyway:
Step 5 depends on `darkweb` having room for the probe worker.

If the session itself failed you get `✗ darkweb: session failed — … (code 401)` and
*no* saved line. `401` is `AuthFailure`: wrong password. Continue below.

### 3b. Read the server's model

If `""` was rejected, the next question is which model `darkweb` runs — similar models have
similar vulnerabilities, and the game deliberately leaves the model list undocumented so
you discover it by experiment. `intel` prints it as the first field of every host's line:

```
run /src/tools/darknet-scan.js intel
```

```
  darkweb — model <ModelId>, depth 0, difficulty ...
      password: numeric × 4, heartbleed charisma ≥ 12
      hint: ...
```

**Write down every model ID you ever see.** Exactly one strategy is known so far —
`ZeroLogon` → empty password — and those observations are the raw material for the table
that would let a script do this for you ([DARKNET.md](DARKNET.md) §9).

### 3c. Check the target has room

Step 5 needs **≥ 1.9 GB free on `darkweb`** — the probe worker's size. On a darknet server
used RAM includes the owner's *blocked* RAM, so a host with plenty of nominal RAM can have
nothing available. No tool reports this, so check it now. `nano /dnfree.js`, paste, save:

```js
/** @param {NS} ns */
export async function main(ns) {
  for (const host of ns.dnet.probe()) {
    ns.tprint(`${host}: ${ns.getServerMaxRam(host) - ns.getServerUsedRam(host)} GB free`);
  }
}
```

```
run /dnfree.js
```

It costs 1.9 GB (1.6 base + `probe` 0.2 + `getServerMaxRam` 0.05 + `getServerUsedRam` 0.05).

### 3d. Solve the hint

`passwordHint` and `data` are puzzles by design. Format and length narrow the search:
`numeric × 4` is 10,000 candidates; `unicode × 12` is not something you brute-force. There
is no shortcut in this repo — cracking is the human's job, and the tools exist to hand you
every clue the API will give up.

When you have it:

```
run /src/tools/stasis.js link darkweb <password>
```

---

## Step 4 — Verify the store took it

```
run /src/tools/stasis.js
```

This line should be **gone** from the output:

```
  · darkweb: no stored password — run: stasis.js link <host> <password>
```

You can also read the file directly in the terminal:

```
cat /data/darknet-passwords.txt
```

An entry of `"darkweb": ""` is valid and correct — the empty string is a real password.

---

## Step 5 — Scan again

```
run /src/tools/darknet-scan.js
```

**First, the precondition.** The crawler will only deploy to `darkweb` if it has **≥ 1.9 GB
free** there (the probe worker's size). If Step 3c showed less than that, this scan will
print `✗ darkweb: couldn't run the probe worker (RAM or exec route)` and the map will not
grow. That is a *different* wall from the one you started at: you are no longer blocked on
the password, you are blocked on RAM. Freeing an owner's blocked RAM needs
`ns.dnet.memoryReallocation()`, which **this suite does not call anywhere** — so there is no
scripted way through it today. Nothing else in these steps is wasted; the password stays
stored and pays off the moment that host has room.

With the RAM available, `pickCrawlHosts()` finds `darkweb` eligible (online + password +
exec route + ≥ 1.9 GB free), ships `darknet-probe-worker.js` there, and the worker reports
`darkweb`'s neighbours back on port 12:

```
darknet-scan: probed home + 1/1 servers, map now 7 hosts (6 new) → /data/darknet-map.txt

=== Newly discovered ===
  <host> — model <ModelId>, depth 1, difficulty ...
  ...
```

**`1/1` instead of `0/0` is the signal that the deadlock is broken.** Every host you crack
from here becomes another vantage point, and the map grows one ring per cracked host.

---

## Step 6 — Pin what you cannot afford to lose

```
run /src/tools/stasis.js auto
```

Darknet servers move, restart, and go offline permanently on a mutation cycle. A stasis
link freezes one in place **and** becomes a permanent remote-exec route to it. Slots are
globally capped, so the planner ranks candidates **deepest first** (hardest to re-find),
then by difficulty.

Existing links are sticky — they hold their slot forever. To reallocate one:

```
run /src/tools/stasis.js unlink <host>
```

---

## Step 7 — Harvest intel on the next ring

```
run /src/tools/darknet-scan.js crack
```

Despite the name this **guesses nothing**. It ships a 2.2 GB worker to each cracked host
and calls `heartbleed(neighbour, {peek: true})` — which needs no password, and with `peek`
consumes nothing. Captured lines merge into `/data/darknet-logs.txt` without duplicates.

Charisma is the gate here: targets above your charisma are refused outright by the API and
filtered out before the attempt. If you see

```
Nothing to scrape: every mapped server is cracked, offline, or above your charisma.
```

train charisma, or scan wider first.

---

## The loop, from here on

```
  darknet-scan.js            crawl from every cracked host → map grows
        │
        ├─► darknet-scan.js intel     read hints / format / length / charisma bar
        ├─► darknet-scan.js crack     heartbleed corpus → /data/darknet-logs.txt
        │
        ▼
  crack a password  ← still manual
        │
        ▼
  stasis.js link <host> <pw>          password enters the store
        │
        ▼
  stasis.js auto                      pin the deepest keepers
        │
        ▼
  darknet-scan.js                     now crawls from the new host — one ring deeper
```

Each cracked password widens the next scan's reach, because that host becomes a vantage
point for both `probe()` and `heartbleed()`.

---

## Symptom → cause → fix

| What you see | What it means | What to do |
|---|---|---|
| `Darknet API unavailable` | no `DarkscapeNavigator.exe` | buy it (TOR first), or `run src/tools/program-buyer.js` |
| `probed home + 0/0 servers` | **the deadlock** — password store empty | Step 3 |
| Map never grows past `darkweb` | same thing | Step 3 |
| `session failed — … (code 401)` | `AuthFailure` — wrong password | it is not that password; back to Step 3b/3c |
| `session failed — … (code 503)` | `ServiceUnavailable` — the server went offline | it may be gone permanently; the map entry is kept on purpose |
| `couldn't run the probe worker (RAM or exec route)` | under 1.9 GB free there, or no exec route | nothing to do yet — freeing owner RAM needs `memoryReallocation()`, which is not implemented |
| `<host>: no-password` | mapped but not cracked | that is the normal resting state of an uncracked host |
| `<host>: no-exec-route` | `scp` reaches it, `exec` does not | needs a direct connection, a backdoor, or an existing stasis link |
| `<host>: blocked-ram` | the owner's processes hold the RAM | informational dead end today — `memoryReallocation()` is not called anywhere |
| `<host>: stationary` | fixed story server, cannot move | correct to skip: a link there is a wasted slot |
| `<host>: no-slot` | eligible, but the global cap is full | `stasis.js unlink` something, or find deep-darknet augmentations |
| `Stasis links: 1 / 1` | that **is** your cap | only deep-darknet augmentations raise it |
| `no probe report after 15s` | worker did not fit, server restarted mid-run, or it died | re-run; the mutation cycle kills running scripts |
| `Nothing to scrape: … above your charisma` | charisma gate | train charisma, or map wider first |

**Response codes**, from `DarknetResponseCodeType` in `NetscriptDefinitions.d.ts`: `200`
Success · `351` DirectConnectionRequired · `401` AuthFailure · `403` Forbidden · `404`
NotFound · `408` RequestTimeOut · `451` NotEnoughCharisma · `453` StasisLinkLimitReached ·
`454` NoBlockRAM · `455` PhishingFailed · `503` ServiceUnavailable.

A `session failed — … (code N)` line always comes from `connectToSession`, which works at
*any* distance — so `351` cannot appear there. `351` belongs to the direct-connection calls
(`authenticate`, `heartbleed`), which this suite only reaches from inside a worker.

---

## What this suite will not do for you

`ns.dnet.authenticate()` is never called anywhere in `src/`. Nothing here guesses, derives,
or brute-forces a password — the game states that server models are *intentionally
undocumented* and that you are meant to discover them by experiment. The tools map the net,
hoard every clue the API will surrender, and remember what you learn across mutations.
**The cracking is yours.**

If you want to close that gap, [DARKNET.md](DARKNET.md) §9 lays out the open leads: the
model-ID table (one known entry — `ZeroLogon` → `""`), the `formulas.dnet.getAuthenticateTime`
timing-oracle hypothesis for `2G_cellular` servers, and the response codes that a real
cracking loop would have to branch on.
