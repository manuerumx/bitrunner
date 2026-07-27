import { test } from "node:test";
import assert from "node:assert/strict";
import { formatAugStats, mergeAugEntries, classifyAug, formatRep } from "/src/tools/list-augs.js";

test("formatAugStats shows only non-neutral multipliers as percent deltas", () => {
  const stats = {
    hacking: 1.05,
    strength: 1,
    hacking_exp: 1.15,
    hacking_speed: 1.03,
  };
  assert.equal(formatAugStats(stats), "+5% hacking, +15% hacking exp, +3% hacking speed");
});

test("formatAugStats handles negative deltas and fractional percents", () => {
  assert.equal(formatAugStats({ hacking: 0.95 }), "-5% hacking");
  assert.equal(formatAugStats({ faction_rep: 1.125 }), "+12.5% faction rep");
});

test("formatAugStats returns empty string when all multipliers are neutral", () => {
  assert.equal(formatAugStats({ hacking: 1, strength: 1 }), "");
  assert.equal(formatAugStats({}), "");
});

test("mergeAugEntries dedupes by name and keeps the faction with the most rep", () => {
  const merged = mergeAugEntries([
    { name: "BitWire", faction: "CyberSec", price: 10e6, repReq: 3750, factionRep: 5000 },
    { name: "BitWire", faction: "NiteSec", price: 10e6, repReq: 3750, factionRep: 12000 },
    { name: "Synaptic Enhancement Implant", faction: "CyberSec", price: 7.5e6, repReq: 2500, factionRep: 5000 },
  ]);

  assert.equal(merged.length, 2);
  const bitwire = merged.find((a) => a.name === "BitWire");
  assert.equal(bitwire.bestFaction, "NiteSec");
  assert.equal(bitwire.bestRep, 12000);
  assert.deepEqual(bitwire.factions, ["CyberSec", "NiteSec"]);
});

test("classifyAug: owned states win, then rep gate, then money gate", () => {
  const aug = { price: 10e6, repReq: 5000, bestRep: 1000 };
  assert.equal(classifyAug(aug, 100e6, "installed"), "INSTALLED");
  assert.equal(classifyAug(aug, 100e6, "purchased"), "PENDING");
  assert.equal(classifyAug(aug, 100e6, null), "NEED REP");
  assert.equal(classifyAug({ ...aug, bestRep: 5000 }, 1e6, null), "NEED $");
  assert.equal(classifyAug({ ...aug, bestRep: 5000 }, 100e6, null), "READY");
});

test("formatRep abbreviates large numbers without a currency sign", () => {
  assert.equal(formatRep(0), "0");
  assert.equal(formatRep(950), "950");
  assert.equal(formatRep(3750), "3.75k");
  assert.equal(formatRep(1.2e6), "1.20m");
});
