/**
 * Automated IPvGO subnet player.
 *
 * Strategy per game: build a two-eyed base against a board edge (shaft one row
 * inside the edge, sealing columns at both ends, a divider splitting the edge
 * row into two eyes), expand outward from the base, then fill every remaining
 * empty node except the protected eye points and pass until the game ends.
 *
 * Board coordinates follow ns.go.getBoardState(): board[x][y], 'X' = own
 * router, 'O' = opponent, '.' = empty, '#' = dead node.
 */

import { pickCheatTarget, summarizeGoStats } from "/src/lib/go.js";
import { consumePortData, PORTS } from "/src/lib/port-registry.js";

// Games an opponent needs before its win rate is worth calling out — one loss out of one
// game is not a weakness, it's a sample size of one.
const MIN_GAMES_FOR_RECORD = 3;

// Cheating is delegated to a worker so this script never pays its 10 GB. See tryCheat.
const CHEAT_WORKER = "/src/tools/ipvgo-cheat-worker.js";
const CHEAT_TIMEOUT_MS = 10000;

/** @type {GoOpponent[]} */
const OPPONENTS = [
  "Netburners",
  "Slum Snakes",
  "The Black Hand",
  "Tetrads",
  "Daedalus",
  "Illuminati",
];

const BOARD_SIZE = 13;
const MAX_GAMES = 10000;
const MAX_TURN_ITERATIONS = 5000;

// Directions: 0 = -y, 1 = -x, 2 = +y, 3 = +x. Base direction k also names the
// edge the base hugs: 0 = minJ row, 1 = minI column, 2 = maxJ row, 3 = maxI column.
const DIRS = [
  { dx: 0, dy: -1 },
  { dx: -1, dy: 0 },
  { dx: 0, dy: 1 },
  { dx: 1, dy: 0 },
];

/**
 * Running record after a finished game. ns.go.analysis.getStats() costs 0 GB, so this is
 * free reporting — the win/loss tracking the script previously had no notion of.
 *
 * The weakest opponent is called out because that is where the strategy is actually
 * failing; the per-faction bonus is what the wins are for.
 *
 * @param {NS} ns
 * @param {string} justPlayed
 */
function printRecord(ns, justPlayed) {
  const rows = summarizeGoStats(ns.go.analysis.getStats());
  const mine = rows.find((r) => r.opponent === justPlayed);
  if (mine && mine.winRate !== null) {
    ns.print(
      `  ${justPlayed}: ${mine.wins}W-${mine.losses}L (${(mine.winRate * 100).toFixed(0)}%), ` +
        `streak ${mine.winStreak} (best ${mine.highestWinStreak}), bonus +${mine.bonusPercent}%`
    );
  }
  const weakest = rows.find((r) => r.winRate !== null && r.played >= MIN_GAMES_FOR_RECORD);
  if (weakest && weakest.opponent !== justPlayed) {
    ns.print(`  weakest: ${weakest.opponent} at ${(weakest.winRate * 100).toFixed(0)}%`);
  }
}

/**
 * Spend a turn on a cheat instead of passing.
 *
 * The cheat itself runs in tools/ipvgo-cheat-worker.js rather than here: Bitburner charges
 * static RAM for every `ns.<fn>` the source mentions, so referencing removeRouter (8 GB)
 * and the two cheat probes (1 GB each) in this file would bill 10 GB on every run for
 * everyone — including players without Source-File 14.2, for whom the calls only throw.
 * Delegating costs this script 1 GB (ns.run) and pays the rest only while cheating.
 *
 * @param {NS} ns
 * @param {{board: string[]}} state
 * @returns {Promise<boolean>} whether the turn was consumed
 */
async function tryCheat(ns, state) {
  const target = pickCheatTarget(state.board);
  if (!target) return false;

  ns.clearPort(PORTS.GO_CHEAT);
  if (ns.run(CHEAT_WORKER, 1, target.x, target.y) === 0) {
    ns.print("WARN: cheat worker would not start (needs ~11.6 GB free)");
    return false;
  }

  const deadline = Date.now() + CHEAT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const report = /** @type {GoCheatReport | null} */ (consumePortData(ns, PORTS.GO_CHEAT));
    if (report) {
      ns.print(`${report.status === "played" ? "INFO" : "WARN"}: cheat ${report.status} — ${report.message}`);
      // Only a SUCCESSFUL cheat earns another pass through the stages — it emptied a node
      // the fill stage can now claim. A failed cheat must NOT loop back: the fill stage
      // would find nothing again and come straight back here, firing cheat after cheat in
      // one turn, each carrying its own ejection risk, until the odds finally decayed
      // below the threshold. The turn is spent either way, so fall through and pass —
      // which is exactly what the script did before cheating existed.
      return report.status === "played";
    }
    await ns.sleep(100);
  }
  ns.print("WARN: cheat worker did not report back");
  return false;
}

/** @param {NS} ns */
export async function main(ns) {
  // Opt-in: cheating risks ejection from the subnet and needs Source-File 14.2.
  //   run /src/tools/ipvgo.js cheat
  const cheating = ns.args.map(String).includes("cheat");
  if (cheating) ns.print("INFO: cheating enabled (needs SF-14.2; ~10% ejection risk on a failed retry)");

  let gameCounter = 0;
  let opponentIndex = 0;
  game: while (true) {
    if (gameCounter++ > MAX_GAMES) {
      ns.alert("Too many games reached!");
      return;
    }
    ns.go.resetBoardState(OPPONENTS[opponentIndex % OPPONENTS.length], BOARD_SIZE);

    const state = newGameState();
    state.board = ns.go.getBoardState();
    computeBounds(state);

    let turnCounter = 0;
    while (true) {
      if (ns.go.getCurrentPlayer() == "None") {
        const result = ns.go.getGameState();
        const opponent = ns.go.getOpponent();
        const won = result.blackScore > result.whiteScore;
        ns.print(
          `${won ? "SUCCESS" : "INFO"}: vs ${opponent}: ${result.blackScore} - ${result.whiteScore}`
        );
        // getStats/getMoveHistory are 0 GB, so the running record is free to report.
        printRecord(ns, opponent);
        opponentIndex++; // rotate only after a finished game
        continue game;
      }
      if (turnCounter++ > MAX_TURN_ITERATIONS) {
        ns.print("WARN: turn watchdog tripped, restarting game");
        state.stage = 666;
      }
      state.board = ns.go.getBoardState();
      if (state.stage == 1 && (await processBase(ns, state))) {
        continue;
      }
      if (state.stage == 2 && (await processColumns(ns, state))) {
        continue;
      }
      if (state.stage == 3 && (await processExpansion(ns, state))) {
        continue;
      }
      if (state.stage == 4 && (await processBaseCleanup(ns, state))) {
        continue;
      }
      if (state.stage == 5 && (await processFill(ns, state))) {
        continue;
      }
      if (state.stage == 666) { // No stable base is possible, restart the game
        await ns.sleep(500); // Board generation is seeded by time; retry the SAME
                             // opponent on a fresh seed instead of skipping it
        continue game;
      }
      // Nothing left to play. If cheating is enabled, spend the turn trying to break an
      // opponent contact point instead of passing: a failed cheat costs a skipped turn,
      // which is exactly the turn we were about to give up voluntarily. (The residual
      // cost is the ~10% ejection chance that applies after the first attempt — which is
      // why the worker re-checks the odds against a higher bar from then on.)
      if (cheating && (await tryCheat(ns, state))) {
        continue;
      }

      await ns.go.passTurn();
      state.stage = 5; // Some opponents might do a suicide even after your passing
    }
  }
}

export function newGameState() {
  return {
    stage: 1,
    substage: 0,
    candidate: null,
    eyes: [],
    eyePoints: [],
    baseIndex: 0,
    primaryStack: [],
    nextStraightPoint: null,
    basePoints: [],
    board: null,
  };
}

// Bounds are computed ONCE per game from the initial empty cells and stay
// frozen: construction state (candidate spans, basePoints) lives in absolute
// coordinates, so a per-turn bounding box would shift under a half-built base.
export function computeBounds(state) {
  let minI = state.board.length;
  let maxI = -1;
  let minJ = state.board.length;
  let maxJ = -1;
  for (let i = 0; i < state.board.length; ++i) {
    const column = state.board[i];
    for (let j = 0; j < column.length; ++j) {
      if (column[j] != ".") {
        continue;
      }
      if (i < minI) minI = i;
      if (i > maxI) maxI = i;
      if (j < minJ) minJ = j;
      if (j > maxJ) maxJ = j;
    }
  }
  state.minI = minI;
  state.maxI = maxI;
  state.minJ = minJ;
  state.maxJ = maxJ;
}

export function cellAt(state, x, y) {
  const column = state.board[x];
  return column === undefined ? undefined : column[y];
}

export function isPartOfGrid(state, point) {
  const cell = cellAt(state, point.x, point.y);
  return cell == "O" || cell == "." || cell == "X";
}

export function getNextPoint(point, direction) {
  return { x: point.x + DIRS[direction].dx, y: point.y + DIRS[direction].dy };
}

export function edgePoint(state, direction, i) {
  if (direction == 0) return { x: i, y: state.minJ };
  if (direction == 1) return { x: state.minI, y: i };
  if (direction == 2) return { x: i, y: state.maxJ };
  return { x: state.maxI, y: i };
}

export function shaftPoint(state, direction, i) {
  if (direction == 0) return { x: i, y: state.minJ + 1 };
  if (direction == 1) return { x: state.minI + 1, y: i };
  if (direction == 2) return { x: i, y: state.maxJ - 1 };
  return { x: state.maxI - 1, y: i };
}

// makeMove throws on invalid moves (suicide, ko); a rejected move must never
// kill the script, so every move goes through here. Deliberately not using
// ns.go.analysis.getValidMoves(): it costs 8 GB of RAM.
export async function tryMove(ns, x, y) {
  try {
    await ns.go.makeMove(x, y);
    return true;
  } catch (e) {
    ns.print(`WARN: move rejected at ${x},${y}: ${String(e).split("\n")[0]}`);
    return false;
  }
}

export async function processBase(ns, state) {
  if (state.candidate == null) {
    const candidates = findBaseCandidates(state);
    if (candidates.length == 0) {
      state.stage = state.eyes.length == 0 ? 666 : 4;
      return false;
    }
    moveToNextCandidate(state);
    state.candidate = candidates[0];
  }

  const candidate = state.candidate;
  state.baseDirection = candidate.direction;
  state.baseStart = candidate.start;
  if (candidate.start + state.baseIndex > candidate.end) {
    finishBase(state, candidate.end);
    return false;
  }

  const point = shaftPoint(state, candidate.direction, candidate.start + state.baseIndex);
  if (cellAt(state, point.x, point.y) != ".") {
    if (state.baseIndex >= 5) { // blocked, but long enough to seal as-is
      finishBase(state, state.baseStart + state.baseIndex - 1);
      return false;
    }
    moveToNextCandidate(state);
    return true;
  }

  const seeds = [];
  if (state.baseIndex == 0 || candidate.start + state.baseIndex == candidate.end) {
    const alongX = candidate.direction == 0 || candidate.direction == 2;
    const lateral = alongX ? (state.baseIndex == 0 ? 1 : 3) : state.baseIndex == 0 ? 0 : 2;
    seeds.push({ x: point.x, y: point.y, direction: lateral, baseMult: 1 });
  }
  const outward = (candidate.direction + 2) % 4;
  seeds.push({
    x: point.x,
    y: point.y,
    direction: outward,
    baseMult: baseMult(point.x, point.y, outward, candidate.direction, state),
  });

  if (!(await tryMove(ns, point.x, point.y))) {
    moveToNextCandidate(state);
    return true;
  }
  state.primaryStack.push(...seeds);
  state.baseIndex++;
  return true;
}

function finishBase(state, end) {
  state.baseEnd = end;
  createBasePoints(state, state.candidate.start, end, state.candidate.direction);
  state.stage = 2;
  state.substage = 0;
}

export async function processColumns(ns, state) {
  if (state.substage == 0) { // Start base column
    const spent = await placeColumn(ns, state, true);
    if (spent !== null) {
      return spent;
    }
    state.substage = 1;
  }

  if (state.substage == 1) { // End base column
    const spent = await placeColumn(ns, state, false);
    if (spent !== null) {
      return spent;
    }
    state.substage = 2;
  }

  // Middle divider: split the edge row into two eyes at the second empty point
  let empties = 0;
  for (const point of state.basePoints) {
    if (cellAt(state, point.x, point.y) == ".") {
      empties++;
    }
  }
  if (empties < 3) {
    moveToNextCandidate(state);
    return true;
  }

  let counter = 0;
  for (let i = 0; i < state.basePoints.length; ++i) {
    const point = state.basePoints[i];
    if (cellAt(state, point.x, point.y) != ".") {
      continue;
    }
    counter++;
    if (counter != 2) {
      continue;
    }
    if (!(await tryMove(ns, point.x, point.y))) {
      moveToNextCandidate(state);
      return true;
    }
    state.eyes.push({
      firstEye: state.basePoints.slice(0, i),
      secondEye: state.basePoints.slice(i + 1),
      done: false,
    });
    state.stage = 3;
    state.candidate = null;
    return true;
  }
  return false;
}

// Returns true/false when the turn is resolved, or null to fall through to the
// next substage (flank off-board or dead: no sealing column needed there).
async function placeColumn(ns, state, isStart) {
  const checkPoint = edgePoint(state, state.baseDirection, isStart ? state.baseStart - 1 : state.baseEnd + 1);
  if (!isPartOfGrid(state, checkPoint)) {
    return null;
  }
  const columnPoint = findColumnPoint(state, isStart);
  if (columnPoint == null || !(await tryMove(ns, columnPoint.x, columnPoint.y))) {
    moveToNextCandidate(state);
    return true;
  }
  const alongX = state.baseDirection == 0 || state.baseDirection == 2;
  const columnDirection = isStart ? (alongX ? 1 : 0) : alongX ? 3 : 2;
  state.primaryStack.push({
    x: columnPoint.x,
    y: columnPoint.y,
    direction: columnDirection,
    baseMult: baseMult(columnPoint.x, columnPoint.y, columnDirection, state.baseDirection, state),
  });
  state.substage = isStart ? 1 : 2;
  return true;
}

function findColumnPoint(state, isStart) {
  while (state.basePoints.length > 0) {
    const point = isStart ? state.basePoints.shift() : state.basePoints.pop();
    if (cellAt(state, point.x, point.y) == ".") {
      return point;
    }
  }
  return null;
}

export function moveToNextCandidate(state) {
  state.candidate = null;
  state.stage = 1;
  state.baseIndex = 0;
  state.primaryStack = [];
  state.nextStraightPoint = null;
}

// Every iteration either spends the turn or strictly consumes pending work
// (nulls the straight point / pops the stack), so the loop is bounded by the
// stack size — no watchdog needed.
export async function processExpansion(ns, state) {
  while (state.nextStraightPoint != null || state.primaryStack.length > 0) {
    if (state.nextStraightPoint != null) {
      const direction = state.nextStraightPoint.direction;
      const nextPoint = getNextPoint(state.nextStraightPoint, direction);
      if (cellAt(state, nextPoint.x, nextPoint.y) == "." && (await tryMove(ns, nextPoint.x, nextPoint.y))) {
        generateNewPoints(state, nextPoint, direction);
        return true;
      }
      state.nextStraightPoint = null;
      continue;
    }

    for (const point of state.primaryStack) {
      point.rate = point.baseMult * calculateCounterMult(state, point) * calculateCrowdMult(state, point);
    }
    state.primaryStack.sort((a, b) => a.rate - b.rate);

    const point = state.primaryStack.pop();
    const nextPoint = getNextPoint(point, point.direction);
    if (cellAt(state, nextPoint.x, nextPoint.y) == "." && (await tryMove(ns, nextPoint.x, nextPoint.y))) {
      generateNewPoints(state, nextPoint, point.direction);
      return true;
    }
  }
  moveToNextCandidate(state);
  return true;
}

export function generateNewPoints(state, nextPoint, direction) {
  state.nextStraightPoint = { x: nextPoint.x, y: nextPoint.y, direction };

  for (const turn of [1, 3]) {
    const sideDirection = (direction + turn) % 4;
    state.primaryStack.push({
      x: nextPoint.x,
      y: nextPoint.y,
      direction: sideDirection,
      baseMult: baseMult(nextPoint.x, nextPoint.y, sideDirection, state.baseDirection, state),
    });
  }
}

export function calculateCounterMult(state, point) {
  let counter = 0;
  let next = getNextPoint(point, point.direction);
  while (cellAt(state, next.x, next.y) == ".") {
    counter++;
    next = getNextPoint(next, point.direction);
  }
  return counter;
}

export function calculateCrowdMult(state, point) {
  let crowdMult = 1;
  const ahead = getNextPoint(point, point.direction);
  for (const turn of [1, 3]) {
    const side = getNextPoint(ahead, (point.direction + turn) % 4);
    if (cellAt(state, side.x, side.y) == "X") {
      crowdMult *= 0.5;
    }
  }
  return crowdMult;
}

// One fill per call. When nothing is fillable anywhere, settle every pending
// eye: record the surviving empty point per side, or give the eye up (an eye
// segment held by opponent stones frees up via capture once its liberties are
// filled; if that never happens, protecting it would spin forever).
export async function processBaseCleanup(ns, state) {
  for (const eye of state.eyes) {
    if (eye.done) {
      continue;
    }
    for (const side of [eye.firstEye, eye.secondEye]) {
      while (side.length > 1) {
        const index = side.findIndex((p) => cellAt(state, p.x, p.y) == ".");
        if (index == -1) {
          break;
        }
        const point = side[index];
        side.splice(index, 1);
        if (await tryMove(ns, point.x, point.y)) {
          return true;
        }
      }
    }
  }

  for (const eye of state.eyes) {
    if (eye.done) {
      continue;
    }
    eye.done = true;
    const firstEyePoint = eye.firstEye.find((p) => cellAt(state, p.x, p.y) == ".");
    const secondEyePoint = eye.secondEye.find((p) => cellAt(state, p.x, p.y) == ".");
    if (firstEyePoint && secondEyePoint) {
      state.eyePoints.push({ firstEyePoint, secondEyePoint });
    } else {
      ns.print("WARN: base finished without two clean eyes, leaving it unprotected");
    }
  }
  state.stage = 5;
  return true;
}

export async function processFill(ns, state) {
  const eyeKeys = new Set();
  for (const eyePoint of state.eyePoints) {
    eyeKeys.add(eyePoint.firstEyePoint.x + "_" + eyePoint.firstEyePoint.y);
    eyeKeys.add(eyePoint.secondEyePoint.x + "_" + eyePoint.secondEyePoint.y);
  }
  for (let i = state.minI; i <= state.maxI; ++i) {
    for (let j = state.minJ; j <= state.maxJ; ++j) {
      if (eyeKeys.has(i + "_" + j)) {
        continue;
      }
      if (cellAt(state, i, j) != ".") {
        continue;
      }
      if (await tryMove(ns, i, j)) {
        return true;
      }
    }
  }
  return false; // nothing left to fill: pass
}

export function createBasePoints(state, start, end, direction) {
  const basePoints = [];
  for (let i = start; i <= end; ++i) {
    basePoints.push(edgePoint(state, direction, i));
  }
  state.basePoints = basePoints;
}

export function findBaseCandidates(state) {
  const candidates = [];
  for (let k = 0; k < 4; ++k) {
    const alongX = k == 0 || k == 2;
    const minCount = alongX ? state.minI : state.minJ;
    const maxCount = alongX ? state.maxI : state.maxJ;
    let streak = false;
    let streakStart;
    for (let i = minCount; i <= maxCount; ++i) {
      const edge = edgePoint(state, k, i);
      const shaft = shaftPoint(state, k, i);
      const open = cellAt(state, edge.x, edge.y) == "." && cellAt(state, shaft.x, shaft.y) == ".";
      if (streak && !open) {
        streak = false;
        addCandidateIfViable(state, candidates, k, streakStart, i - 1);
      } else if (!streak && open) {
        streak = true;
        streakStart = i;
      }
    }
    if (streak) {
      addCandidateIfViable(state, candidates, k, streakStart, maxCount);
    }
  }
  candidates.sort((a, b) => b.length - a.length);
  return candidates;
}

// Each on-grid flank consumes one base point for its sealing column, and three
// empty points must survive for the divider plus two eyes — so interior spans
// need 5 cells while spans against the board edge or dead nodes need only 4.
function addCandidateIfViable(state, candidates, direction, start, end) {
  const length = end + 1 - start;
  let flanks = 0;
  if (isPartOfGrid(state, edgePoint(state, direction, start - 1))) flanks++;
  if (isPartOfGrid(state, edgePoint(state, direction, end + 1))) flanks++;
  if (length >= 4 && length >= 3 + flanks) {
    candidates.push({ length, direction, start, end });
  }
}

export function baseMult(x, y, direction, baseDirection, state) {
  const perpendicularIsX = direction == 0 || direction == 2;
  const v = perpendicularIsX ? x : y;
  const lo = perpendicularIsX ? state.minI : state.minJ;
  const hi = perpendicularIsX ? state.maxI : state.maxJ;
  const baseOnLow = perpendicularIsX ? baseDirection == 1 : baseDirection == 0;
  const baseOnHigh = perpendicularIsX ? baseDirection == 3 : baseDirection == 2;
  if (baseOnLow) {
    if (v <= lo + 2 || v == hi) return 1;
    if (v == lo + 3 || v == hi - 1) return 1.5;
    return 2;
  }
  if (baseOnHigh) {
    if (v == lo || v >= hi - 2) return 1;
    if (v == lo + 1 || v == hi - 3) return 1.5;
    return 2;
  }
  if (v == lo || v == hi) return 1;
  if (v == lo + 1 || v == hi - 1) return 1.5;
  return 2;
}
