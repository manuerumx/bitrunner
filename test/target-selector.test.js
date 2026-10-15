import { test } from "node:test";
import assert from "node:assert/strict";
import { hwgwTargetCount } from "/src/lib/target-selector.js";

test("hwgwTargetCount scales with the free pool at 256 GB per target", () => {
  assert.equal(hwgwTargetCount(256 * 20, 100), 20);
});

test("hwgwTargetCount keeps at least 3 targets on a small pool", () => {
  assert.equal(hwgwTargetCount(100, 100), 3);
});

// A 9.5 PB pool used to stop at 10 targets and leave 99% of its RAM idle.
test("hwgwTargetCount is capped by the configured maximum, not a fixed 10", () => {
  assert.equal(hwgwTargetCount(9.5e6, 100), 100);
  assert.equal(hwgwTargetCount(9.5e6, 10), 10);
});
