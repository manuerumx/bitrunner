# Infiltration: why it is not automatable

**Verdict:** infiltration cannot be automated in Bitburner 3.0.1, for two independent
reasons — either one sufficient on its own.

1. The game **detects synthetic keyboard events and punishes them deliberately**: it sets
   your damage to your entire current HP, hospitalizes you, aborts the run, and pops a
   toast reading *"Do not try to automate infiltration!"*
2. The Netscript API has **no infiltration verbs at all** — `ns.infiltration` is two
   read-only lookups.

This document records the evidence, and analyses the automation script that circulates for
this, because its failure mode is dangerous in a non-obvious way (§3).

> **Provenance.** Everything below was read from the upstream source at **tag `v3.0.1`**,
> the version this repo targets — not from the `dev` branch, which is ahead of us and
> differs (see [DARKNET-REQUIREMENTS.md](DARKNET-REQUIREMENTS.md) §0 for a worked example
> of that drift). File and line references are to that tag. §5 lists them.

---

## 1. The game detects and punishes automation

This is the part that moots everything else, so it comes first.

**The detector** — `src/Infiltration/ui/InfiltrationRoot.tsx:73-77`:

```ts
const press = (event: KeyboardEvent) => {
  if (!event.isTrusted || !(event instanceof KeyboardEvent)) {
    state.onFailure({ automated: true });
    return;
  }
  state.stage.onKey(event);
};
```

**The punishment** — `src/Infiltration/Infiltration.ts:139-151`:

```ts
onFailure(options?: { automated?: boolean }): void {
  this.results += "✗";
  this.clearTimeouts();
  this.stage = new CountdownModel(this);
  Player.receiveRumor(FactionName.ShadowsOfAnarchy);
  let damage = calculateDamageAfterFailingInfiltration(this.startingSecurityLevel);
  // Kill the player immediately if they use automation, so it's clear they're not meant to
  if (options?.automated) {
    damage = Player.hp.current;
    setTimeout(() => {
      SnackbarEvents.emit("You were hospitalized. Do not try to automate infiltration!", ToastVariant.WARNING, 5000);
    }, 500);
  }
  if (Player.takeDamage(damage)) {
    this.cancel();
    return;
  }
  ...
```

### The full consequence chain, traced rather than inferred

The code comment and the toast both say "hospitalized", but the report should not rest on a
comment. Following it through `PlayerObjectGeneralMethods.ts:265-290`:

| Step | Code | Result |
|---|---|---|
| 1 | `new KeyboardEvent(...)` + `dispatchEvent` | `isTrusted === false` — guaranteed by the DOM spec, not a quirk |
| 2 | `InfiltrationRoot.tsx:74` | branch taken → `onFailure({ automated: true })` |
| 3 | `damage = Player.hp.current` | overwrites the normal formula — the `WKSharmonizer` 0.5× mitigation is bypassed |
| 4 | `takeDamage`: `this.hp.current -= amt` | HP lands on exactly **0** |
| 5 | `if (this.hp.current <= 0) { this.hospitalize(false); return true; }` | hospitalized, returns `true` |
| 6 | `hospitalize()` | charges the hospitalization fee, restores HP to max, emits a toast |
| 7 | back in `onFailure`: `if (Player.takeDamage(damage)) { this.cancel(); return; }` | **the infiltration is aborted** — the whole run is lost |

So one synthetic keypress costs you: the run, a `✗` on the record, your full HP, and money.
Twice over in toasts, the game tells you why.

### Why `isTrusted` is not something to route around

`isTrusted` is `false` on every event constructed in script and dispatched via
`dispatchEvent` — that is what the property is specified to mean. It is not a bug, a
version quirk, or a selector problem. The check is defeatable in principle, as most
client-side checks are, but the developers attached an in-game penalty and an explicit
instruction to it. **This repo treats that as a design decision and does not automate
infiltration.**

---

## 2. There is no API surface for it either

`ns.infiltration` in 3.0.1 — the whole interface:

| Function | RAM | Returns |
|---|---:|---|
| `getPossibleLocations()` | 0 GB | `{city, name}[]` |
| `getInfiltration(location)` | 15 GB | `{location, reward: {tradeRep, sellCash, SoARep}, difficulty, maxClearanceLevel, startingSecurityLevel}` |

Both are lookups. There is no start, no advance, no answer, no collect — and no
Singularity equivalent either. Every other subsystem this repo automates exposes verbs
that *do* something (`dnet.setStasisLink`, `singularity.purchaseProgram`,
`gang.setMemberTask`). Infiltration exposes none, and that omission is consistent with §1.

[API-COVERAGE-AUDIT.md](API-COVERAGE-AUDIT.md) already recorded `ns.infiltration` as
`0 / 2` used and "not actionable". That entry is correct but understates the situation: it
is not merely that the API is read-only, it is that the game defends the gap.

---

## 3. The script that circulates for this

A ~98-line DOM-driven script does the rounds for this. It is worth analysing because of how
it fails: **as written it is a harmless no-op, and "fixing" the obvious bug converts it into
something that hospitalizes you.**

### It never does anything

The loop gates on this:

```js
const headers = Array.from(doc.querySelectorAll("h4"));
const infHeader = headers.find(h => h.textContent.includes("Infiltrating"));
if (!infHeader) { /* print "waiting..." */ continue; }
```

There is no `<h4>` containing "Infiltrating" on the infiltration screen. Per
`InfiltrationRoot.tsx`, the only `<h4>` elements rendered are the `Progress` results strip
and each minigame's own instruction line; the panel header is `Level N / M` (an `<h5>`),
and the idle state is `<h2>Not currently infiltrating!</h2>`. `infHeader` is therefore
always `undefined` and the script prints "waiting" forever.

### Behind that gate, the instruction strings do not match

All eight verified directly against the `v3.0.1` tarball:

| Script looks for | Game actually renders | Source |
|---|---|---|
| `"Match the directional arrow"` | `Match the symbols!` | `Cyberpunk2077Game.tsx:42` |
| `"Type the characters"` | *(no such string anywhere)* | — |
| `"Enter the code"` | `Enter the Code!` — capital C, so `.includes()` misses | `CheatCodeGame.tsx:19` |
| `"Mine the node"` | `Remember all the mines!` / `Mark all the mines!` | `MinesweeperGame.tsx:40` |
| `"Approaching guard"` | `Guarding ...` / `Distracted!` / `Alerted!` | `SlashGame.tsx:30-32` |
| `"Type it backward"` | ✅ `Type it backward` (just `Type it` with `ChaosOfDionysus`) | `BackwardGame.tsx:20` |
| `"Cut the wire"` | ✅ substring of `Cut the wires with the following properties! (keyboard 1 to 9)` | `WireCuttingGame.tsx:19-20` |
| — | `Close the brackets` — **not handled** | `BracketGame.tsx:16` |
| — | `Say something nice about the guard` — **not handled** | `BribeGame.tsx:47` |

Two of nine games are addressed by name. The wire-cutting handler is wrong regardless: it
presses `idx + 1` for each `<p>` containing "Cut", but those are the *question* lines
("cut wires colored red"), not wire positions — the wires render in a separate grid. And
there is no debounce, so on its 50 ms loop the typing games would retype the whole word
about twenty times a second.

### Two things that look like bugs and are not

- **The malformed `code` / `keyCode`.** `` `Key${key.toUpperCase()}` `` yields `"Key "` for
  space and `"Key1"` for digits, which are wrong — but harmless. `Infiltration/utils.ts:14`
  switches on `event.key`, which the script sets correctly.
- **`eval("document")` is deliberate and it works.** It hides DOM access from Bitburner's
  static RAM analyzer, which otherwise charges a flat **25 GB** (`Dom: 25`,
  `RamCostGenerator.ts:12`, against a `Base: 1.6`). That is why the script costs ~1.6 GB
  instead of ~26.6 GB.

### The trap

Because the gate at the top never matches, this script is currently inert. A reader who
spots that bug, fixes the selector, and runs it will land a synthetic keypress on a live
minigame — and get §1. **Do not "fix" this script.** The selector bug is the only thing
standing between it and a hospitalization.

---

## 4. What the API does permit

Recorded as findings, not as plans. Neither is built.

- **Target ranking is fully scriptable.** `getPossibleLocations()` plus `getInfiltration()`
  give reward (`tradeRep` / `sellCash` / `SoARep`) against `difficulty`,
  `maxClearanceLevel` and `startingSecurityLevel` — the same expected-value shape as
  `lib/crime.js`. That would let you choose which runs are worth playing by hand, with no
  DOM coupling and nothing to break on a game update. Mind the 15 GB per `getInfiltration()`
  call: one pass, print, exit.
- **A read-only screen assistant would not trip the guard.** The detector lives on the
  `keydown` path only; a script that reads the DOM and displays the answer without ever
  calling `dispatchEvent` never reaches it. The games where that would help most are the
  ones whose difficulty is *reading* rather than reflexes — `Cyberpunk2077` (symbol
  matching), `Minesweeper` (mine memorisation) and `Backward` (the answer is plain text in
  the DOM, only visually mirrored by `transform: scaleX(-1)`). Untested; noted because it
  is the boundary of what §1 actually forbids, not as a recommendation.

Both still pay the 25 GB DOM charge unless they use the `eval` evasion described above.

---

## 5. Sources

All at tag `v3.0.1` of `bitburner-official/bitburner-src`:

| Claim | File:line |
|---|---|
| `isTrusted` detector | `src/Infiltration/ui/InfiltrationRoot.tsx:73-77` |
| Automated-failure penalty | `src/Infiltration/Infiltration.ts:139-151` |
| `takeDamage` → hospitalize | `src/PersonObjects/Player/PlayerObjectGeneralMethods.ts:265-279` |
| `hospitalize` cost / HP restore | `src/PersonObjects/Player/PlayerObjectGeneralMethods.ts:281-290` |
| Key dispatch reads `event.key` | `src/Infiltration/utils.ts:13-31` |
| DOM RAM charge (`Dom: 25`, `Base: 1.6`) | `src/Netscript/RamCostGenerator.ts:11-12` |
| Minigame instruction strings | `src/Infiltration/ui/*.tsx` (per-row above) |
| `ns.infiltration` surface | `NetscriptDefinitions.d.ts:6753-6773` (this repo) |
