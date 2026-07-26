import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";
import { PROGRAMS } from "/src/lib/constants.js";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SRC = join(ROOT, "src");

// Bitburner's static RAM analyzer only counts functions referenced as literal
// `ns.<name>` text. A dynamic lookup like `ns[fn]` runs fine but is invisible
// to the analyzer, so its RAM cost never lands in the allocation and the
// script dies mid-run with "Dynamic RAM usage calculated to be greater than
// RAM allocation" — at whatever later call happens to cross the budget.

function walk(dir) {
  const files = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) files.push(...walk(full));
    else if (entry.endsWith(".js")) files.push(full);
  }
  return files;
}

// `ns` as a whole identifier only — must not match `factions[` etc.
const NS_MAP_ACCESS = /(?<![A-Za-z0-9_$])ns\s*\[/;

test("no script accesses ns functions via map lookup", () => {
  for (const file of walk(SRC)) {
    const source = readFileSync(file, "utf8");
    assert.doesNotMatch(
      source,
      NS_MAP_ACCESS,
      `${relative(ROOT, file)}: ns[...] map access bypasses the static RAM calculation`,
    );
  }
});

// The two rooting scripts invoke the port openers through a lookup table, so
// each opener must also appear as literal ns.<fn> for the analyzer to see.
const ROOTING_SCRIPTS = ["src/tools/nuke-all.js", "src/managers/rooter.js"];

for (const script of ROOTING_SCRIPTS) {
  test(`${script} references every port opener as literal ns.<fn>`, () => {
    const source = readFileSync(join(ROOT, script), "utf8");
    for (const prog of PROGRAMS) {
      assert.match(
        source,
        new RegExp(`ns\\.${prog.fn}\\b`),
        `missing literal ns.${prog.fn} — static RAM analyzer won't charge for it`,
      );
    }
  });
}
