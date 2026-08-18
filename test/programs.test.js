import { test } from "node:test";
import assert from "node:assert/strict";
import { selectProgramsToBuy } from "/src/lib/programs.js";

// The darkweb catalogue is ordered cheapest-first so a partial budget still buys the
// programs that open the most ports per dollar — rooter.js can use any subset it has.
test("selectProgramsToBuy returns missing programs in catalogue order", () => {
  const catalog = ["BruteSSH.exe", "FTPCrack.exe", "relaySMTP.exe"];
  assert.deepEqual(selectProgramsToBuy(catalog, []), catalog);
});

test("selectProgramsToBuy skips programs already on home", () => {
  const catalog = ["BruteSSH.exe", "FTPCrack.exe", "relaySMTP.exe"];
  assert.deepEqual(selectProgramsToBuy(catalog, ["FTPCrack.exe"]), [
    "BruteSSH.exe",
    "relaySMTP.exe",
  ]);
});

test("selectProgramsToBuy buys nothing when every program is owned", () => {
  const catalog = ["BruteSSH.exe", "FTPCrack.exe"];
  assert.deepEqual(selectProgramsToBuy(catalog, catalog), []);
});

test("selectProgramsToBuy handles an empty catalogue", () => {
  assert.deepEqual(selectProgramsToBuy([], ["BruteSSH.exe"]), []);
});
