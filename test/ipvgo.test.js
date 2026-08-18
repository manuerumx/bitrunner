import { test } from "node:test";
import assert from "node:assert/strict";
import {
  newGameState,
  computeBounds,
  cellAt,
  getNextPoint,
  edgePoint,
  shaftPoint,
  createBasePoints,
  findBaseCandidates,
  baseMult,
  tryMove,
  calculateCounterMult,
  calculateCrowdMult,
  processBase,
  processColumns,
  processExpansion,
  processBaseCleanup,
  processFill,
} from "/src/tools/ipvgo.js";

// Boards are arrays of column strings, board[x][y], matching ns.go.getBoardState().
const EMPTY9 = Array(9).fill(".".repeat(9));

function makeState(board, extra = {}) {
  const state = newGameState();
  state.board = board;
  computeBounds(state);
  return Object.assign(state, extra);
}

function mockNs({ failMoves = [] } = {}) {
  const moves = [];
  const prints = [];
  return {
    moves,
    prints,
    print: (msg) => prints.push(String(msg)),
    go: {
      makeMove: async (x, y) => {
        if (failMoves.some(([fx, fy]) => fx === x && fy === y)) {
          throw new Error("invalid move");
        }
        moves.push([x, y]);
        return { type: "move", x: null, y: null };
      },
    },
  };
}

test("computeBounds finds the bounding box of empty cells", () => {
  const state = newGameState();
  state.board = ["#####", "#...#", "#...#", "#...#", "#####"];
  computeBounds(state);
  assert.equal(state.minI, 1);
  assert.equal(state.maxI, 3);
  assert.equal(state.minJ, 1);
  assert.equal(state.maxJ, 3);
});

test("computeBounds covers a fully open board", () => {
  const state = newGameState();
  state.board = EMPTY9;
  computeBounds(state);
  assert.equal(state.minI, 0);
  assert.equal(state.maxI, 8);
  assert.equal(state.minJ, 0);
  assert.equal(state.maxJ, 8);
});

test("cellAt returns the cell or undefined off-board", () => {
  const state = makeState(["X.", "O#"]);
  assert.equal(cellAt(state, 0, 0), "X");
  assert.equal(cellAt(state, 0, 1), ".");
  assert.equal(cellAt(state, 1, 1), "#");
  assert.equal(cellAt(state, 2, 0), undefined);
  assert.equal(cellAt(state, -1, 0), undefined);
  assert.equal(cellAt(state, 0, 5), undefined);
});

test("getNextPoint steps one cell in each direction", () => {
  assert.deepEqual(getNextPoint({ x: 2, y: 2 }, 0), { x: 2, y: 1 });
  assert.deepEqual(getNextPoint({ x: 2, y: 2 }, 1), { x: 1, y: 2 });
  assert.deepEqual(getNextPoint({ x: 2, y: 2 }, 2), { x: 2, y: 3 });
  assert.deepEqual(getNextPoint({ x: 2, y: 2 }, 3), { x: 3, y: 2 });
});

test("edgePoint and shaftPoint map base directions onto the frozen bounds", () => {
  const state = makeState(EMPTY9.slice(0, 5).map((c) => c.slice(0, 5)));
  assert.deepEqual(edgePoint(state, 0, 2), { x: 2, y: 0 });
  assert.deepEqual(shaftPoint(state, 0, 2), { x: 2, y: 1 });
  assert.deepEqual(edgePoint(state, 1, 2), { x: 0, y: 2 });
  assert.deepEqual(shaftPoint(state, 1, 2), { x: 1, y: 2 });
  assert.deepEqual(edgePoint(state, 2, 2), { x: 2, y: 4 });
  assert.deepEqual(shaftPoint(state, 2, 2), { x: 2, y: 3 });
  assert.deepEqual(edgePoint(state, 3, 2), { x: 4, y: 2 });
  assert.deepEqual(shaftPoint(state, 3, 2), { x: 3, y: 2 });
});

test("createBasePoints lays edge-row points across the span", () => {
  const state = makeState(EMPTY9);
  createBasePoints(state, 1, 3, 0);
  assert.deepEqual(state.basePoints, [
    { x: 1, y: 0 },
    { x: 2, y: 0 },
    { x: 3, y: 0 },
  ]);
});

// --- findBaseCandidates: flank-aware viability threshold ---

function boardWithEdgeStreak(from, to, flankChar) {
  // 9x9, only (x, 0..1) open for x in [from, to]; flank columns get flankChar on both rows
  const cols = [];
  for (let x = 0; x < 9; x++) {
    if (x >= from && x <= to) {
      cols.push(".." + "X".repeat(7));
    } else if ((x === from - 1 || x === to + 1) && flankChar !== "X") {
      cols.push(flankChar + flankChar + "X".repeat(7));
    } else {
      cols.push("X".repeat(9));
    }
  }
  return cols;
}

test("rejects interior streaks of length 4 (columns would consume 2 of 4 base points)", () => {
  const state = makeState(boardWithEdgeStreak(2, 5, "X"));
  assert.deepEqual(findBaseCandidates(state), []);
});

test("accepts interior streaks of length 5", () => {
  const state = makeState(boardWithEdgeStreak(2, 6, "X"));
  const candidates = findBaseCandidates(state);
  assert.ok(
    candidates.some((c) => c.direction === 0 && c.start === 2 && c.end === 6),
    `expected a direction-0 candidate spanning 2..6, got ${JSON.stringify(candidates)}`
  );
});

test("accepts a length-4 streak ending at the board edge (one flank off-board)", () => {
  const state = makeState(boardWithEdgeStreak(5, 8, "X"));
  const candidates = findBaseCandidates(state);
  assert.ok(
    candidates.some((c) => c.direction === 0 && c.start === 5 && c.end === 8),
    `expected a direction-0 candidate spanning 5..8, got ${JSON.stringify(candidates)}`
  );
});

test("accepts a length-4 streak flanked by dead nodes (no columns needed)", () => {
  const state = makeState(boardWithEdgeStreak(2, 5, "#"));
  const candidates = findBaseCandidates(state);
  assert.ok(
    candidates.some((c) => c.direction === 0 && c.start === 2 && c.end === 5),
    `expected a direction-0 candidate spanning 2..5, got ${JSON.stringify(candidates)}`
  );
});

// --- tryMove: invalid moves must not crash the script ---

test("tryMove returns true and records a successful move", async () => {
  const ns = mockNs();
  assert.equal(await tryMove(ns, 3, 4), true);
  assert.deepEqual(ns.moves, [[3, 4]]);
});

test("tryMove returns false and logs when makeMove throws", async () => {
  const ns = mockNs({ failMoves: [[3, 4]] });
  assert.equal(await tryMove(ns, 3, 4), false);
  assert.deepEqual(ns.moves, []);
  assert.ok(ns.prints.some((p) => p.includes("3,4")));
});

// --- scoring helpers ---

test("baseMult keeps the original lane tiers", () => {
  const state = makeState(Array(13).fill(".".repeat(13)));
  // vertical movement (perpendicular coord x), base on a horizontal edge: symmetric tiers
  assert.equal(baseMult(0, 5, 0, 0, state), 1);
  assert.equal(baseMult(1, 5, 0, 0, state), 1.5);
  assert.equal(baseMult(6, 5, 0, 0, state), 2);
  assert.equal(baseMult(11, 5, 2, 2, state), 1.5);
  assert.equal(baseMult(12, 5, 2, 2, state), 1);
  // base along minI: low side widened to three cheap lanes
  assert.equal(baseMult(2, 5, 0, 1, state), 1);
  assert.equal(baseMult(3, 5, 0, 1, state), 1.5);
  assert.equal(baseMult(6, 5, 0, 1, state), 2);
  assert.equal(baseMult(12, 5, 0, 1, state), 1);
  // base along maxI: mirrored
  assert.equal(baseMult(10, 5, 2, 3, state), 1);
  assert.equal(baseMult(9, 5, 2, 3, state), 1.5);
  assert.equal(baseMult(1, 5, 2, 3, state), 1.5);
  // horizontal movement (perpendicular coord y)
  assert.equal(baseMult(5, 0, 1, 1, state), 1);
  assert.equal(baseMult(5, 1, 3, 1, state), 1.5);
  assert.equal(baseMult(5, 2, 1, 0, state), 1);
  assert.equal(baseMult(5, 3, 1, 0, state), 1.5);
  assert.equal(baseMult(5, 6, 3, 2, state), 2);
});

test("calculateCounterMult counts the open corridor ahead", () => {
  const state = makeState(EMPTY9);
  assert.equal(calculateCounterMult(state, { x: 2, y: 2, direction: 2 }), 6);
  assert.equal(calculateCounterMult(state, { x: 2, y: 2, direction: 0 }), 2);
});

test("calculateCrowdMult halves the rate per own neighbor ahead", () => {
  const board = EMPTY9.slice();
  board[1] = ".".repeat(3) + "X" + ".".repeat(5); // (1,3) = 'X'
  board[3] = ".".repeat(3) + "X" + ".".repeat(5); // (3,3) = 'X'
  const state = makeState(board);
  assert.equal(calculateCrowdMult(state, { x: 2, y: 2, direction: 2 }), 0.25);
  assert.equal(calculateCrowdMult(state, { x: 5, y: 5, direction: 2 }), 1);
});

// --- stage 1: base shaft ---

test("processBase plays the first shaft stone one row inside the edge", async () => {
  const ns = mockNs();
  const state = makeState(EMPTY9);
  assert.equal(await processBase(ns, state), true);
  assert.equal(ns.moves.length, 1);
  assert.equal(state.baseIndex, 1);
  assert.ok(state.primaryStack.length >= 2, "expects lateral + outward seeds");
});

test("processBase abandons the candidate instead of crashing when the move is rejected", async () => {
  const state = makeState(EMPTY9);
  const ns = mockNs({ failMoves: [[0, 1]], });
  // force the direction-0 candidate so the first shaft stone is (0,1)
  state.candidate = { length: 9, direction: 0, start: 0, end: 8 };
  assert.equal(await processBase(ns, state), true);
  assert.deepEqual(ns.moves, []);
  assert.equal(state.candidate, null);
  assert.equal(state.stage, 1);
});

// --- stage 2: divider records the eye only after the move succeeds ---

function dividerState(board) {
  return makeState(board, {
    stage: 2,
    substage: 2,
    baseDirection: 0,
    baseStart: 1,
    baseEnd: 5,
    basePoints: [1, 2, 3, 4, 5].map((x) => ({ x, y: 0 })),
  });
}

test("processColumns divider splits the base points into two eyes", async () => {
  const ns = mockNs();
  const state = dividerState(EMPTY9);
  assert.equal(await processColumns(ns, state), true);
  assert.deepEqual(ns.moves, [[2, 0]]); // second empty base point
  assert.equal(state.stage, 3);
  assert.equal(state.eyes.length, 1);
  assert.deepEqual(state.eyes[0].firstEye, [{ x: 1, y: 0 }]);
  assert.deepEqual(state.eyes[0].secondEye, [3, 4, 5].map((x) => ({ x, y: 0 })));
});

test("processColumns abandons the candidate when the divider move is rejected", async () => {
  const ns = mockNs({ failMoves: [[2, 0]] });
  const state = dividerState(EMPTY9);
  assert.equal(await processColumns(ns, state), true);
  assert.deepEqual(ns.moves, []);
  assert.equal(state.eyes.length, 0);
  assert.equal(state.stage, 1);
});

// --- stage 3: expansion ---

test("processExpansion extends the straight line and seeds side branches", async () => {
  const ns = mockNs();
  const state = makeState(EMPTY9, {
    stage: 3,
    baseDirection: 0,
    nextStraightPoint: { x: 2, y: 2, direction: 2 },
  });
  assert.equal(await processExpansion(ns, state), true);
  assert.deepEqual(ns.moves, [[2, 3]]);
  assert.deepEqual(state.nextStraightPoint, { x: 2, y: 3, direction: 2 });
  assert.equal(state.primaryStack.length, 2);
});

test("processExpansion returns to candidate search when nothing is playable", async () => {
  const ns = mockNs();
  const board = Array(9).fill("X".repeat(9));
  const state = makeState(board, {
    stage: 3,
    baseDirection: 0,
    nextStraightPoint: null,
    primaryStack: [{ x: 1, y: 1, direction: 3, baseMult: 1 }],
  });
  assert.equal(await processExpansion(ns, state), true);
  assert.deepEqual(ns.moves, []);
  assert.equal(state.stage, 1);
});

test("processExpansion skips a rejected move and tries the stack instead", async () => {
  const ns = mockNs({ failMoves: [[2, 3]] });
  const state = makeState(EMPTY9, {
    stage: 3,
    baseDirection: 0,
    nextStraightPoint: { x: 2, y: 2, direction: 2 },
    primaryStack: [{ x: 0, y: 0, direction: 3, baseMult: 1 }],
  });
  assert.equal(await processExpansion(ns, state), true);
  assert.deepEqual(ns.moves, [[1, 0]]);
  assert.equal(state.nextStraightPoint.direction, 3);
});

// --- stage 4: eye cleanup ---

test("processBaseCleanup fills surplus eye cells one move per call", async () => {
  const ns = mockNs();
  const board = EMPTY9.slice();
  const state = makeState(board, { stage: 4 });
  state.eyes.push({
    firstEye: [{ x: 1, y: 0 }],
    secondEye: [{ x: 3, y: 0 }, { x: 4, y: 0 }],
    done: false,
  });
  assert.equal(await processBaseCleanup(ns, state), true);
  assert.deepEqual(ns.moves, [[3, 0]]);
  assert.equal(state.eyePoints.length, 0, "eye not settled yet");
});

test("processBaseCleanup settles eyes once and never duplicates eye points", async () => {
  const ns = mockNs();
  const state = makeState(EMPTY9, { stage: 4 });
  state.eyes.push({
    firstEye: [{ x: 1, y: 0 }],
    secondEye: [{ x: 4, y: 0 }],
    done: false,
  });
  assert.equal(await processBaseCleanup(ns, state), true);
  assert.equal(state.eyePoints.length, 1);
  assert.equal(state.eyes[0].done, true);
  assert.equal(state.stage, 5);
  // re-entry (e.g. after a later base is built) must not re-push the same eye
  state.stage = 4;
  await processBaseCleanup(ns, state);
  assert.equal(state.eyePoints.length, 1);
});

test("processBaseCleanup handles an occupied eye without spinning or protecting it", async () => {
  const ns = mockNs();
  const board = EMPTY9.slice();
  board[1] = "O" + ".".repeat(8);
  board[2] = "O" + ".".repeat(8);
  const state = makeState(board, { stage: 4 });
  state.eyes.push({
    firstEye: [{ x: 1, y: 0 }, { x: 2, y: 0 }], // both occupied, nothing fillable
    secondEye: [{ x: 4, y: 0 }],
    done: false,
  });
  assert.equal(await processBaseCleanup(ns, state), true);
  assert.deepEqual(ns.moves, []);
  assert.equal(state.eyes[0].done, true);
  assert.equal(state.eyePoints.length, 0, "a broken eye must not be protected");
  assert.equal(state.stage, 5);
});

// --- stage 5: fill ---

test("processFill fills the first empty cell that is not a protected eye", async () => {
  const ns = mockNs();
  const board = ["...", "...", "..."];
  const state = makeState(board, { stage: 5 });
  state.eyePoints.push({
    firstEyePoint: { x: 0, y: 0 },
    secondEyePoint: { x: 0, y: 1 },
  });
  assert.equal(await processFill(ns, state), true);
  assert.deepEqual(ns.moves, [[0, 2]]);
});

test("processFill reports completion when nothing is fillable", async () => {
  const ns = mockNs();
  const board = ["XXX", "XXX", "XXX"];
  const state = makeState(board, { stage: 5, minI: 0, maxI: 2, minJ: 0, maxJ: 2 });
  assert.equal(await processFill(ns, state), false);
  assert.equal(state.stage, 5, "no phantom stage-6 state");
});

test("processFill skips rejected moves and keeps scanning", async () => {
  const ns = mockNs({ failMoves: [[0, 0]] });
  const board = ["..X", "X.X", "XXX"];
  const state = makeState(board, { stage: 5 });
  assert.equal(await processFill(ns, state), true);
  assert.deepEqual(ns.moves, [[0, 1]]);
});
