import { register } from "node:module";

// Install the resolve hook (maps "/src/..." game paths to disk) before any test
// file is loaded. Wired in via NODE_OPTIONS="--import ./test/setup.mjs" so it
// also applies inside the per-file child processes the test runner spawns.
register("./loader-hooks.mjs", import.meta.url);
