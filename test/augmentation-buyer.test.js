import { test } from "node:test";
import assert from "node:assert/strict";
import { main } from "/src/advanced/augmentation-buyer.js";
import { AUG_STATS_FILE } from "/src/lib/augmentations.js";

// Just enough of ns.flags for the buyer: "--name value" pairs, the rest positional in `_`.
function parseFlags(schema, args) {
  const out = Object.fromEntries(schema);
  out._ = [];
  for (let i = 0; i < args.length; i++) {
    const arg = String(args[i]);
    if (arg.startsWith("--")) out[arg.slice(2)] = args[++i];
    else out._.push(args[i]);
  }
  return out;
}

// Minimal Bitburner mock: every queued purchase (including each NeuroFlux
// Governor level) multiplies all augmentation prices by 1.9x, matching the
// game's generic price escalation. Without that escalation buyNeuroFlux's
// while(true) loop would never terminate.
function makeMockNs({ money, factionRep, augCatalog, args }) {
  const purchases = [];
  const state = { money, installed: false };
  const owned = [];
  const runs = [];
  const files = {};
  let queued = 0;

  const currentPrice = (aug) => augCatalog[aug].price * Math.pow(1.9, queued);

  const ns = {
    args,
    flags: (schema) => parseFlags(schema, args),
    // Stands in for aug-stats-worker.js: writes the catalog's stats and exits at once.
    run(script, _threads, ...names) {
      runs.push(script);
      files[AUG_STATS_FILE] = JSON.stringify(Object.fromEntries(names.map((n) => [n, augCatalog[n].stats ?? {}])));
      return 1;
    },
    isRunning: () => false,
    sleep: async () => {},
    read: (file) => files[file] ?? "",
    disableLog() {},
    print() {},
    tprint() {},
    getPlayer: () => ({ money: state.money, factions: Object.keys(factionRep) }),
    singularity: {
      getCurrentWork() {
        return null;
      },
      getOwnedAugmentations() {
        return [...owned];
      },
      getAugmentationsFromFaction(faction) {
        return Object.keys(augCatalog).filter((a) => augCatalog[a].factions.includes(faction));
      },
      getAugmentationRepReq(aug) {
        return augCatalog[aug].repReq;
      },
      getAugmentationPrice(aug) {
        return currentPrice(aug);
      },
      getFactionRep(faction) {
        return factionRep[faction];
      },
      purchaseAugmentation(faction, aug) {
        if (!augCatalog[aug].factions.includes(faction)) return false;
        if (factionRep[faction] < augCatalog[aug].repReq) return false;
        const price = currentPrice(aug);
        if (state.money < price) return false;
        state.money -= price;
        queued++;
        purchases.push(aug);
        if (aug !== "NeuroFlux Governor") owned.push(aug);
        return true;
      },
      installAugmentations() {
        state.installed = true;
      },
    },
  };

  return { ns, purchases, state, runs };
}

const CATALOG = {
  BitWire: { price: 10e6, repReq: 3750, factions: ["CyberSec"] },
  "Synaptic Enhancement Implant": { price: 7.5e6, repReq: 2500, factions: ["CyberSec"] },
  "NeuroFlux Governor": { price: 750e3, repReq: 500, factions: ["CyberSec"] },
};

const REP = { CyberSec: 10000 };

test("plain install never buys NeuroFlux Governor (keeps leftover money for future augs)", async () => {
  const { ns, purchases, state } = makeMockNs({
    money: 100e6,
    factionRep: REP,
    augCatalog: CATALOG,
    args: ["install"],
  });

  await main(ns);

  assert.deepEqual(
    purchases.filter((a) => a === "NeuroFlux Governor"),
    [],
    "NFG must not be bought on a plain install run",
  );
  assert.ok(purchases.includes("BitWire"), "regular augs still get bought");
  assert.ok(state.money > 0, "leftover money is kept, not dumped into NFG");
  assert.equal(state.installed, false);
});

test("install reset dumps leftover money into NFG after regular augs, then installs", async () => {
  const { ns, purchases, state } = makeMockNs({
    money: 100e6,
    factionRep: REP,
    augCatalog: CATALOG,
    args: ["install", "reset"],
  });

  await main(ns);

  const nfgCount = purchases.filter((a) => a === "NeuroFlux Governor").length;
  assert.ok(nfgCount > 0, "NFG dump happens on reset");
  assert.ok(
    purchases.indexOf("BitWire") < purchases.indexOf("NeuroFlux Governor"),
    "regular augs are bought before the NFG dump",
  );
  assert.equal(state.installed, true);
});

test("install nfg dumps into NFG without installing (manual-install workflow)", async () => {
  const { ns, purchases, state } = makeMockNs({
    money: 100e6,
    factionRep: REP,
    augCatalog: CATALOG,
    args: ["install", "nfg"],
  });

  await main(ns);

  assert.ok(purchases.filter((a) => a === "NeuroFlux Governor").length > 0);
  assert.equal(state.installed, false);
});

test("install reset still dumps into NFG and installs when no regular aug is affordable", async () => {
  const { ns, purchases, state } = makeMockNs({
    money: 5e6, // below both regular augs, enough for a few NFG levels
    factionRep: REP,
    augCatalog: CATALOG,
    args: ["install", "reset"],
  });

  await main(ns);

  assert.ok(purchases.filter((a) => a === "NeuroFlux Governor").length > 0);
  assert.equal(state.installed, true);
});

// Price is 1.9x per purchase, so the order decides what $30m buys: most-expensive-first gets
// Neurotrainer ($20m) and then can't afford Augmented Targeting ($8m x 1.9).
const PREF_CATALOG = {
  Neurotrainer: { price: 20e6, repReq: 0, factions: ["CyberSec"], stats: { charisma_exp: 1.1 } },
  "Augmented Targeting": { price: 8e6, repReq: 0, factions: ["CyberSec"], stats: { dexterity: 1.1 } },
  "NeuroFlux Governor": { price: 750e3, repReq: 0, factions: ["CyberSec"] },
};

test("default order is most-expensive-first and never runs the stats worker", async () => {
  const { ns, purchases, runs } = makeMockNs({
    money: 30e6,
    factionRep: REP,
    augCatalog: PREF_CATALOG,
    args: ["install"],
  });

  await main(ns);

  assert.deepEqual(purchases, ["Neurotrainer"]);
  assert.deepEqual(runs, []);
});

test("--prefer buys augs boosting the preferred category first", async () => {
  const { ns, purchases, runs } = makeMockNs({
    money: 30e6,
    factionRep: REP,
    augCatalog: PREF_CATALOG,
    args: ["install", "--prefer", "combat"],
  });

  await main(ns);

  assert.equal(purchases[0], "Augmented Targeting");
  assert.equal(runs.length, 1, "stats come from the one-shot worker");
});

test("--prefer still honours positional install/reset after the flag", async () => {
  const { ns, purchases, state } = makeMockNs({
    money: 30e6,
    factionRep: REP,
    augCatalog: PREF_CATALOG,
    args: ["--prefer", "combat", "install", "reset"],
  });

  await main(ns);

  assert.equal(purchases[0], "Augmented Targeting");
  assert.equal(state.installed, true);
});

test("--prefer with an unknown category buys nothing", async () => {
  const { ns, purchases } = makeMockNs({
    money: 30e6,
    factionRep: REP,
    augCatalog: PREF_CATALOG,
    args: ["install", "--prefer", "hax"],
  });

  await main(ns);

  assert.deepEqual(purchases, []);
});

test("--prefer falls back to the default order when the worker cannot start", async () => {
  const { ns, purchases } = makeMockNs({
    money: 30e6,
    factionRep: REP,
    augCatalog: PREF_CATALOG,
    args: ["install", "--prefer", "combat"],
  });
  ns.run = () => 0;

  await main(ns);

  assert.deepEqual(purchases, ["Neurotrainer"]);
});
