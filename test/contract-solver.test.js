import { test } from "node:test";
import assert from "node:assert/strict";
import { SOLVERS } from "/src/managers/contract-solver.js";

// Convenience: solve by contract-type name.
const solve = (type, data) => SOLVERS[type](data);
const sorted = (arr) => [...arr].sort();

test("Find Largest Prime Factor", () => {
  assert.equal(solve("Find Largest Prime Factor", 17), 17); // prime
  assert.equal(solve("Find Largest Prime Factor", 48), 3); // 2^4 * 3
  assert.equal(solve("Find Largest Prime Factor", 100), 5); // 2^2 * 5^2 (largest prime squared)
  assert.equal(solve("Find Largest Prime Factor", 98), 7); // 2 * 7^2
  assert.equal(solve("Find Largest Prime Factor", 13195), 29); // 5*7*13*29
});

test("Subarray with Maximum Sum", () => {
  assert.equal(solve("Subarray with Maximum Sum", [-2, 1, -3, 4, -1, 2, 1, -5, 4]), 6);
  assert.equal(solve("Subarray with Maximum Sum", [-5, -2, -8]), -2);
});

test("Total Ways to Sum", () => {
  assert.equal(solve("Total Ways to Sum", 4), 4);
  assert.equal(solve("Total Ways to Sum", 5), 6);
});

test("Total Ways to Sum II", () => {
  assert.equal(solve("Total Ways to Sum II", [4, [1, 2]]), 3);
  assert.equal(solve("Total Ways to Sum II", [10, [1, 2, 3, 4]]), 23);
});

test("Spiralize Matrix", () => {
  assert.deepEqual(
    solve("Spiralize Matrix", [[1, 2, 3], [4, 5, 6], [7, 8, 9]]),
    [1, 2, 3, 6, 9, 8, 7, 4, 5]
  );
});

test("Array Jumping Game", () => {
  assert.equal(solve("Array Jumping Game", [2, 3, 1, 1, 4]), 1);
  assert.equal(solve("Array Jumping Game", [3, 2, 1, 0, 4]), 0);
});

test("Array Jumping Game II", () => {
  assert.equal(solve("Array Jumping Game II", [2, 3, 1, 1, 4]), 2);
  assert.equal(solve("Array Jumping Game II", [0]), 0);
});

test("Merge Overlapping Intervals", () => {
  assert.deepEqual(
    solve("Merge Overlapping Intervals", [[1, 3], [2, 6], [8, 10], [15, 18]]),
    [[1, 6], [8, 10], [15, 18]]
  );
});

test("Generate IP Addresses", () => {
  assert.deepEqual(solve("Generate IP Addresses", "1111"), ["1.1.1.1"]);
});

test("Algorithmic Stock Trader I-IV", () => {
  assert.equal(solve("Algorithmic Stock Trader I", [7, 1, 5, 3, 6, 4]), 5);
  assert.equal(solve("Algorithmic Stock Trader II", [7, 1, 5, 3, 6, 4]), 7);
  assert.equal(solve("Algorithmic Stock Trader III", [3, 3, 5, 0, 0, 3, 1, 4]), 6);
  assert.equal(solve("Algorithmic Stock Trader IV", [2, [2, 4, 1]]), 2);
});

test("Minimum Path Sum in a Triangle", () => {
  assert.equal(
    solve("Minimum Path Sum in a Triangle", [[2], [3, 4], [6, 5, 7], [4, 1, 8, 3]]),
    11
  );
});

test("Unique Paths in a Grid I", () => {
  assert.equal(solve("Unique Paths in a Grid I", [3, 3]), 6);
  assert.equal(solve("Unique Paths in a Grid I", [2, 2]), 2);
});

test("Unique Paths in a Grid II", () => {
  assert.equal(solve("Unique Paths in a Grid II", [[0, 0, 0], [0, 1, 0], [0, 0, 0]]), 2);
});

test("Sanitize Parentheses in Expression", () => {
  assert.deepEqual(sorted(solve("Sanitize Parentheses in Expression", "()())()")), [
    "(())()",
    "()()()",
  ]);
});

test("Find All Valid Math Expressions", () => {
  assert.deepEqual(sorted(solve("Find All Valid Math Expressions", ["123", 6])), [
    "1*2*3",
    "1+2+3",
  ]);
});

test("HammingCodes round-trips (encode then decode)", () => {
  const enc = SOLVERS["HammingCodes: Integer to Encoded Binary"];
  const dec = SOLVERS["HammingCodes: Encoded Binary to Integer"];
  for (const n of [4, 21, 100, 1000, 8675309]) {
    assert.equal(dec(enc(n)), n);
  }
});

test("HammingCodes corrects a single-bit error", () => {
  const enc = SOLVERS["HammingCodes: Integer to Encoded Binary"];
  const dec = SOLVERS["HammingCodes: Encoded Binary to Integer"];
  const encoded = enc(100).split("");
  encoded[3] = encoded[3] === "0" ? "1" : "0"; // flip one bit
  assert.equal(dec(encoded.join("")), 100);
});

test("Proper 2-Coloring of a Graph", () => {
  assert.deepEqual(
    solve("Proper 2-Coloring of a Graph", [4, [[0, 1], [1, 2], [2, 3], [3, 0]]]),
    [0, 1, 0, 1]
  );
  // Odd cycle is not bipartite.
  assert.deepEqual(solve("Proper 2-Coloring of a Graph", [3, [[0, 1], [1, 2], [2, 0]]]), []);
});

test("Compression I: RLE", () => {
  assert.equal(solve("Compression I: RLE Compression", "aaaaabccc"), "5a1b3c");
  assert.equal(solve("Compression I: RLE Compression", "aaaaaaaaaaaa"), "9a3a"); // run capped at 9
});

test("Compression II: LZ Decompression", () => {
  assert.equal(solve("Compression II: LZ Decompression", "1a91"), "aaaaaaaaaa");
});

test("Compression III: LZ round-trips and is optimal length", () => {
  const compress = SOLVERS["Compression III: LZ Compression"];
  const decompress = SOLVERS["Compression II: LZ Decompression"];
  for (const s of ["aaaaaaaaaa", "abracadabra", "aaaabbbbcccc", "x", "mississippi"]) {
    assert.equal(decompress(compress(s)), s, `round-trip failed for "${s}"`);
  }
  assert.equal(compress("aaaaaaaaaa").length, 4); // optimal "1a91"
  assert.equal(compress(""), "");
});

test("Encryption I: Caesar Cipher", () => {
  assert.equal(solve("Encryption I: Caesar Cipher", ["ABCDE", 3]), "XYZAB");
});

test("Encryption II: Vigenère Cipher", () => {
  assert.equal(solve("Encryption II: Vigenère Cipher", ["ABCD", "B"]), "BCDE");
});

test("Total Number of Primes", () => {
  assert.equal(solve("Total Number of Primes", [0, 20]), 8); // contract's own example
  assert.equal(solve("Total Number of Primes", [0, 1]), 0); // 0 and 1 are not prime
  assert.equal(solve("Total Number of Primes", [2, 2]), 1); // bounds are inclusive
  assert.equal(solve("Total Number of Primes", [4, 4]), 0);
  assert.equal(solve("Total Number of Primes", [10, 20]), 4); // 11, 13, 17, 19
  assert.equal(solve("Total Number of Primes", [0, 1000000]), 78498); // known pi(10^6)
  // High offset at the spec's upper bound: pi(5e6) - pi(4e6) = 348513 - 283146.
  assert.equal(solve("Total Number of Primes", [4000000, 5000000]), 65367);
});

test("Shortest Path in a Grid", () => {
  assert.equal(solve("Shortest Path in a Grid", [[0, 0, 0], [0, 0, 0]]), "RRD");
  assert.equal(solve("Shortest Path in a Grid", [[0, 1], [1, 0]]), ""); // blocked
});
