import { test } from "node:test";
import assert from "node:assert/strict";
import { main } from "/src/advanced/augmentation-buyer.js";

// Minimal Bitburner mock: every queued purchase (including each NeuroFlux
// Governor level) multiplies all augmentation prices by 1.9x, matching the
// game's generic price escalation. Without that escalation buyNeuroFlux's
// while(true) loop would never terminate.
function makeMockNs({ money, factionRep, augCatalog, args }) {
  const purchases = [];
  const state = { money, installed: false };
  const owned = [];
  let queued = 0;

  const currentPrice = (aug) => augCatalog[aug].price * Math.pow(1.9, queued);

  const ns = {
    args,
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

  return { ns, purchases, state };
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
