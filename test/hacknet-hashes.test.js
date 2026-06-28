import { test } from "node:test";
import assert from "node:assert/strict";
import { bestHashTarget, spendHashes } from "/src/managers/hacknet-manager.js";

// Flat topology: home connects to every server, every server connects back to home — enough for
// scanNetwork's BFS to reach them all.
function makeScan(serverNames) {
  return (h) => (h === "home" ? serverNames : ["home"]);
}

test("bestHashTarget picks the richest rooted server, skipping unrooted", () => {
  const servers = {
    poor: { money: 1e6, root: true },
    rich: { money: 1e12, root: true },
    richest_unrooted: { money: 1e15, root: false },
  };
  const ns = {
    scan: makeScan(Object.keys(servers)),
    hasRootAccess: (h) => servers[h].root,
    getServerMaxMoney: (h) => servers[h].money,
  };
  assert.equal(bestHashTarget(ns), "rich");
});

test("spendHashes is a no-op when the BitNode has no hash capacity", () => {
  const ns = { hacknet: { hashCapacity: () => 0 } };
  assert.deepEqual(spendHashes(ns, 2), { target: null, targeted: 0, money: 0 });
});

test("spendHashes caps target upgrades per cycle, then drains the rest to money", () => {
  let hashes = 100;
  const spent = [];
  const cost = (name) => (name === "Sell for Money" ? 4 : 10);
  const ns = {
    scan: makeScan(["n00"]),
    hasRootAccess: () => true,
    getServerMaxMoney: () => 1e9,
    hacknet: {
      hashCapacity: () => 1000,
      numHashes: () => hashes,
      getHashUpgrades: () => ["Sell for Money", "Reduce Minimum Security", "Increase Maximum Money"],
      hashCost: (name) => cost(name),
      spendHashes: (name, target) => {
        if (hashes < cost(name)) return false;
        hashes -= cost(name);
        spent.push({ name, target });
        return true;
      },
    },
  };

  const r = spendHashes(ns, 2);

  // 2 of each targeted upgrade (perCycle cap), bought against the richest server.
  assert.equal(r.target, "n00");
  assert.equal(r.targeted, 4);
  assert.equal(spent.filter((s) => s.name === "Reduce Minimum Security").length, 2);
  assert.equal(spent.filter((s) => s.name === "Increase Maximum Money").length, 2);
  assert.ok(spent.slice(0, 4).every((s) => s.target === "n00"));

  // 100 - 4*10 = 60 left, drained at 4 hashes each -> 15 "Sell for Money", down to 0.
  assert.equal(r.money, 15);
  assert.equal(hashes, 0);
});

test("spendHashes skips target upgrades the BitNode doesn't offer, still drains to money", () => {
  let hashes = 20;
  const ns = {
    scan: makeScan(["n00"]),
    hasRootAccess: () => true,
    getServerMaxMoney: () => 1e9,
    hacknet: {
      hashCapacity: () => 1000,
      numHashes: () => hashes,
      getHashUpgrades: () => ["Sell for Money"], // no targeted upgrades available
      hashCost: () => 4,
      spendHashes: () => {
        if (hashes < 4) return false;
        hashes -= 4;
        return true;
      },
    },
  };

  const r = spendHashes(ns, 2);
  assert.equal(r.targeted, 0);
  assert.equal(r.money, 5); // 20 / 4
  assert.equal(hashes, 0);
});
