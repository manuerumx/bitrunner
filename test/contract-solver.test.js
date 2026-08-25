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

test("Square Root", () => {
  assert.equal(solve("Square Root", 0n), "0");
  assert.equal(solve("Square Root", 16n), "4"); // perfect square
  assert.equal(solve("Square Root", 2n), "1"); // 1.414... rounds down
  assert.equal(solve("Square Root", 3n), "2"); // 1.732... rounds up
  // Straddle the k+0.5 midpoint at contract scale: k²+k is below it (rounds down
  // to k), k²+k+1 is above it (rounds up to k+1). Ties are impossible since
  // (k+0.5)² is never an integer.
  const k = 10n ** 100n;
  assert.equal(solve("Square Root", k * k + k), k.toString());
  assert.equal(solve("Square Root", k * k + k + 1n), (k + 1n).toString());
  // A real 201-digit contract input; expected value computed independently
  // with Python's math.isqrt plus nearest-integer rounding.
  assert.equal(
    solve(
      "Square Root",
      118847015994321514905746087878996244591102145499959407693682076430852315765037840129132788771100287168964537481927379018105191681404591681302016130506656469595762942422025536561612851797949778638464519n
    ),
    "10901697849157328158981951240161710083844436327427228157030717228421332334757527960415837777955862845"
  );
});

// Signature (NetscriptDefinitions.d.ts:9602):
//   "Largest Rectangle in a Matrix": [(1 | 0)[][], [[number, number], [number, number]]]
// Input is a 0/1 grid, answer is [[topRow, leftCol], [bottomRow, rightCol]] inclusive.
// 1 is the obstacle and 0 is fillable, matching how "Unique Paths in a Grid II" and
// "Shortest Path in a Grid" read the same encoding in this same file.
test("Largest Rectangle in a Matrix", () => {
  // Whole grid is free.
  assert.deepEqual(solve("Largest Rectangle in a Matrix", [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]), [
    [0, 0],
    [2, 3],
  ]);
  // A 2x2 block of zeros in the corner, walled off by ones.
  assert.deepEqual(solve("Largest Rectangle in a Matrix", [[0, 0, 1], [0, 0, 1], [1, 1, 1]]), [
    [0, 0],
    [1, 1],
  ]);
  // Single row: the widest run of zeros wins, not the first one.
  assert.deepEqual(solve("Largest Rectangle in a Matrix", [[0, 1, 0, 0, 0]]), [[0, 2], [0, 4]]);
  assert.deepEqual(solve("Largest Rectangle in a Matrix", [[0]]), [[0, 0], [0, 0]]);
});

// A tall-thin rectangle can beat a short-wide one, which is the case a "widest run per row"
// shortcut gets wrong — the answer has to consider every (top, bottom) row pair.
test("Largest Rectangle in a Matrix prefers area over width", () => {
  const grid = [
    [0, 0, 0, 1],
    [1, 0, 0, 1],
    [1, 0, 0, 1],
  ];
  // The 3-wide top row is area 3; the 2x3 column block is area 6.
  assert.deepEqual(solve("Largest Rectangle in a Matrix", grid), [[0, 1], [2, 2]]);
});

// Property test against brute force. Every rectangle the solver returns must be in bounds,
// contain no 1, and have exactly the maximum achievable area — which pins down the answer
// far more tightly than the hand-picked grids above.
test("Largest Rectangle in a Matrix matches brute force on random grids", () => {
  const bruteMaxArea = (m) => {
    let best = 0;
    for (let r1 = 0; r1 < m.length; r1++)
      for (let r2 = r1; r2 < m.length; r2++)
        for (let c1 = 0; c1 < m[0].length; c1++)
          for (let c2 = c1; c2 < m[0].length; c2++) {
            let ok = true;
            for (let r = r1; r <= r2 && ok; r++)
              for (let c = c1; c <= c2 && ok; c++) if (m[r][c] !== 0) ok = false;
            if (ok) best = Math.max(best, (r2 - r1 + 1) * (c2 - c1 + 1));
          }
    return best;
  };

  // Deterministic LCG so a failure is reproducible rather than a flake.
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

  for (let trial = 0; trial < 500; trial++) {
    const rows = 1 + Math.floor(rnd() * 5);
    const cols = 1 + Math.floor(rnd() * 5);
    const density = rnd();
    const grid = Array.from({ length: rows }, () =>
      Array.from({ length: cols }, () => (rnd() < density ? 1 : 0))
    );
    const want = bruteMaxArea(grid);
    const got = solve("Largest Rectangle in a Matrix", grid);
    const label = JSON.stringify(grid);

    if (want === 0) continue; // no zero-rectangle exists; see the note in the solver
    const [[r1, c1], [r2, c2]] = got;
    assert.ok(r1 >= 0 && c1 >= 0 && r2 < rows && c2 < cols, `out of bounds ${label}`);
    assert.ok(r1 <= r2 && c1 <= c2, `inverted corners ${label}`);
    for (let r = r1; r <= r2; r++) {
      for (let c = c1; c <= c2; c++) {
        assert.equal(grid[r][c], 0, `rectangle covers an obstacle at [${r},${c}] in ${label}`);
      }
    }
    assert.equal((r2 - r1 + 1) * (c2 - c1 + 1), want, `not maximal for ${label}`);
  }
});
