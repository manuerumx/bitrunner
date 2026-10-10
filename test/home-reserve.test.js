import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";
import { homeReserveRAM } from "/src/lib/config.js";
import { DEFAULTS } from "/src/lib/constants.js";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

const nsWith = (hasCorp) => ({ corporation: { hasCorporation: () => hasCorp } });

test("without a corporation home keeps the plain reserve", () => {
  assert.equal(homeReserveRAM(nsWith(false)), DEFAULTS.reservedHomeRAM);
});

// The hacker fills home down to the reserve. The corp tools are one-shots of 82-152 GB the
// daemon launches only into free home RAM, so with 32 GB free corp-office.js never ran: no
// tea, morale fell to 10, the warehouses filled with unsold Plants, and profit collapsed.
test("with a corporation home also keeps room for the corp tools", () => {
  assert.equal(homeReserveRAM(nsWith(true)), DEFAULTS.reservedHomeRAM + DEFAULTS.corpReservedHomeRAM);
});

function walk(dir) {
  const files = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) files.push(...walk(full));
    else if (entry.endsWith(".js")) files.push(full);
  }
  return files;
}

test("nothing subtracts the home reserve without homeReserveRAM", () => {
  for (const file of walk(join(ROOT, "src"))) {
    if (file.endsWith(join("lib", "config.js"))) continue;
    const source = readFileSync(file, "utf8");
    assert.ok(!/-\s*DEFAULTS\.reservedHomeRAM/.test(source), `${relative(ROOT, file)} subtracts DEFAULTS.reservedHomeRAM directly`);
  }
});
