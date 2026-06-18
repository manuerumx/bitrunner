# Remote API file sync

Edit the scripts in this repo with your normal editor and have them pushed
into Bitburner automatically over the **Remote File API (RFA)** — a WebSocket
channel the game opens to a local tool.

## How it works

Bitburner is the WebSocket **client**; the sync tool is the **server**. The
game connects out to it and they exchange JSON-RPC 2.0 messages
(`pushFile`, `getFileNames`, `getDefinitionFile`, ...). This repo uses the
official [`bitburner-filesync`](https://github.com/bitburner-official/bitburner-filesync)
tool, configured in [`filesync.json`](../filesync.json).

## One-time setup

Nothing to install — the npm scripts run the tool through `npx`. You only need
Node + npm (already present via nvm).

> **Run it inside WSL, not a Windows shell.** This repo lives on the WSL
> filesystem. Windows `npm`/`cmd.exe` can't handle the `\\wsl.localhost\...`
> UNC path and will bail to `C:\Windows`. Always start the sync from an Ubuntu
> (WSL) terminal. Bitburner on Windows still reaches it on `localhost:12525`
> thanks to WSL2 localhost forwarding.

## Daily use

1. In a **WSL/Ubuntu** terminal, start the sync server from the repo root:
   ```bash
   cd ~/development/bitrunner
   npm run sync
   ```
   It prints `Server is ready, running on 12525!` and waits.
2. In Bitburner: **Options → Remote API**, set **hostname** `localhost` and
   **port** `12525`, then **Connect**. You should see `Connection made!` in the
   terminal.
3. Edit any `.js` under `src/`. On save it is pushed into the game instantly.

To preview what would sync without connecting the game:
```bash
npm run sync:dry
```

## Why the config looks the way it does

- `scriptsFolder: "."` — the repo root maps to the game's `home` root, so
  `src/lib/config.js` on disk becomes `/src/lib/config.js` in game. This must
  stay `.` because the scripts reference each other with absolute paths like
  `import ... from "/src/lib/utils.js"` and `ns.exec("/src/grow.js", ...)`.
- `pushAllOnConnection: true` — the whole suite is uploaded the moment the game
  connects, so you don't have to touch every file to seed a fresh save.
- `allowDeletingFiles: false` — deleting a file on disk does **not** delete it
  in game. Flip to `true` if you want disk to be the source of truth.
- `exclude` — keeps `node_modules`, `.git`, `docs`, and editor folders out of
  the sync even though the root is the watched folder.
- `definitionFile.update: true` — on connect, the tool pulls
  `NetscriptDefinitions.d.ts` (the NS API typings for *your* game version) into
  the repo root. Combined with [`jsconfig.json`](../jsconfig.json) and the
  `NS` shim (see [Type checking](#type-checking-no-migration-no-build-step)),
  `/** @param {NS} ns */` gives full autocomplete on `ns.`.

## Type checking (no migration, no build step)

The scripts stay plain `.js`, but the editor and `tsc` type-check them against
the NS API — catching typos, wrong argument counts, and bad enum strings before
you run anything in game.

```bash
npm run check     # runs `tsc -p jsconfig.json` (no files emitted, just checking)
```

The **whole suite** is checked (`"checkJs": true` in
[`jsconfig.json`](../jsconfig.json)) and currently passes clean. Treat a
non-zero exit as a regression to fix before syncing.

`strictNullChecks` was evaluated (2026-06-18) and **deferred**: it surfaces ~40
errors that are almost all inference noise — empty-array `never[]` literals,
`shift()` results that are guarded by `while (queue.length)` at runtime, and
`Server` fields that the NS defs mark optional — rather than real bugs. Not
worth the scattered `?? 0` / `!` annotations today; revisit if more values get
concrete types.

The strict enum string types (faction work, gym stat, crime, bladeburner
actions) the game validates at runtime are exposed globally in
[`globals.d.ts`](../globals.d.ts), so a wrong literal is a red squiggle instead
of a runtime crash.

How the typing resolves:

- [`globals.d.ts`](../globals.d.ts) re-exposes `NS` (and `Server`, `Player`) in
  global scope. The pulled `NetscriptDefinitions.d.ts` is a *module* (it has
  `export`s), so its types aren't global on their own — this shim is what makes
  `/** @param {NS} ns */` resolve without an import. Add a line there when you
  reference another Netscript type in JSDoc.
- `paths: { "/*": ["./*"] }` in [`jsconfig.json`](../jsconfig.json) teaches
  `tsc` to resolve the in-game absolute imports (`"/src/lib/utils.js"`) to the
  files on disk.

Note: the **game does not type-check** — since v2.7.0 it natively transpiles
`.js/.jsx/.ts/.tsx`, but it strips types and runs the code regardless of errors.
Type safety lives entirely in your editor / `npm run check`.

## Unit tests (no game required)

The pure logic — contract solvers, HWGW batch math, formatters — is tested with
the built-in Node test runner, no Bitburner needed:

```bash
npm test
```

Tests live in [`test/`](../test) (excluded from game sync). Because the scripts
import each other with game-root absolute paths (`/src/...`), a small ESM resolve
hook ([`test/loader-hooks.mjs`](../test/loader-hooks.mjs), wired in via
`NODE_OPTIONS` in the `test` script) maps those onto real files so Node can load
them. These caught a real bug — Find Largest Prime Factor returned 1 for numbers
like 100 — which is exactly what they guard against.

## Pre-commit hook

A version-controlled hook in [`.githooks/`](../.githooks) runs `npm run check`
and `npm test` and blocks the commit if either fails. Activate it once per clone:

```bash
git config core.hooksPath .githooks
```

Bypass for one commit with `git commit --no-verify`. If `node` isn't on the
hook's PATH it skips with a warning rather than blocking.

## What else the RFA can do

`bitburner-filesync` only uses the file-push subset. The full RFA also exposes:
`getFile`, `getAllFiles`, `getFileMetadata`, `deleteFile`, `getFileNames`,
`getAllServers`, `calculateRam` (static RAM cost of a script),
`getDefinitionFile`, and `getSaveFile` (export the whole save). A custom tool
could use these for two-way sync, external RAM budgeting, save backups, or a
live server-map dashboard. See the
[official Remote API docs](https://github.com/bitburner-official/bitburner-src/blob/dev/src/Documentation/doc/en/programming/remote_api.md).
