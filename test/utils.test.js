import { test } from "node:test";
import assert from "node:assert/strict";
import { formatMoney, formatRAM, formatTime, formatPercent } from "/src/lib/utils.js";

test("formatMoney", () => {
  assert.equal(formatMoney(0), "$0");
  assert.equal(formatMoney(500), "$500");
  assert.equal(formatMoney(999), "$999");
  assert.equal(formatMoney(1500), "$1.50k");
  assert.equal(formatMoney(1_000_000), "$1.00m");
  assert.equal(formatMoney(2_500_000_000), "$2.50b");
  assert.equal(formatMoney(-2500), "-$2.50k");
});

test("formatRAM", () => {
  assert.equal(formatRAM(512), "512.0 GB");
  assert.equal(formatRAM(1024), "1.0 TB");
  assert.equal(formatRAM(2048), "2.0 TB");
  assert.equal(formatRAM(1024 * 1024), "1.0 PB");
});

test("formatTime", () => {
  assert.equal(formatTime(500), "500ms");
  assert.equal(formatTime(1500), "1s");
  assert.equal(formatTime(60000), "1m 0s");
  assert.equal(formatTime(65000), "1m 5s");
  assert.equal(formatTime(3_661_000), "1h 1m 1s");
});

test("formatPercent", () => {
  assert.equal(formatPercent(0), "0.0%");
  assert.equal(formatPercent(0.1234), "12.3%");
  assert.equal(formatPercent(1), "100.0%");
});
