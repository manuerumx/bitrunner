import { test } from "node:test";
import assert from "node:assert/strict";
import { pickCheatTarget, shouldCheat, summarizeGoStats } from "/src/lib/go.js";

// ── pickCheatTarget ─────────────────────────────────────────────────────────
//
// Board is board[x][y]: 'X' ours, 'O' theirs, '.' empty, '#' dead node.
// Removing an opponent router only helps where it opens up a contested area, so the
// target must border one of our own routers.

test("pickCheatTarget removes an opponent router bordering ours", () => {
  const board = ["XO.", "...", "..."];
  assert.deepEqual(pickCheatTarget(board), { x: 0, y: 1 });
});

test("pickCheatTarget ignores an opponent router with no contact with us", () => {
  const board = ["X..", "...", "..O"];
  assert.equal(pickCheatTarget(board), null);
});

test("pickCheatTarget returns null on a board with no opponent routers", () => {
  assert.equal(pickCheatTarget(["X..", "...", "..."]), null);
});

test("pickCheatTarget returns null before we have any routers down", () => {
  assert.equal(pickCheatTarget(["O..", "...", "..."]), null);
});

test("pickCheatTarget never targets a dead node", () => {
  const board = ["X#.", "...", "..."];
  assert.equal(pickCheatTarget(board), null);
});

// ── summarizeGoStats ────────────────────────────────────────────────────────
//
// ns.go.analysis.getStats() is 0 GB and reports per-opponent wins/losses/streaks plus the
// stat bonus each faction currently grants — the result tracking ipvgo.js never had.

function stats(over = {}) {
  return { wins: 3, losses: 1, winStreak: 2, highestWinStreak: 3, bonusPercent: 5, ...over };
}

test("summarizeGoStats reports win rate per opponent", () => {
  const rows = summarizeGoStats({ Netburners: stats({ wins: 3, losses: 1 }) });
  assert.equal(rows[0].opponent, "Netburners");
  assert.equal(rows[0].winRate, 0.75);
});

test("summarizeGoStats orders the weakest win rate first", () => {
  const rows = summarizeGoStats({
    Easy: stats({ wins: 9, losses: 1 }),
    Hard: stats({ wins: 1, losses: 9 }),
  });
  assert.deepEqual(rows.map((r) => r.opponent), ["Hard", "Easy"]);
});

// An opponent that has never been played has no win rate; reporting 0% would read as
// "always loses" rather than "untried".
test("summarizeGoStats marks an unplayed opponent rather than scoring it zero", () => {
  const rows = summarizeGoStats({ Fresh: stats({ wins: 0, losses: 0 }) });
  assert.equal(rows[0].winRate, null);
  assert.equal(rows[0].played, 0);
});

test("summarizeGoStats carries the bonus through for reporting", () => {
  const rows = summarizeGoStats({ Netburners: stats({ bonusPercent: 12 }) });
  assert.equal(rows[0].bonusPercent, 12);
});

test("summarizeGoStats handles no recorded opponents", () => {
  assert.deepEqual(summarizeGoStats({}), []);
});

// ── shouldCheat ─────────────────────────────────────────────────────────────
//
// From the API docs: "if you fail to play a cheat move, your turn will be skipped. After
// your first cheat attempt, if you fail, there is a small (~10%) chance you will instantly
// be ejected from the subnet."
//
// So the cost of failure is not flat. The first attempt risks only a wasted turn; every
// attempt after it risks losing the whole game. The bar rises accordingly.

test("shouldCheat takes a likely first cheat, where failure only costs a turn", () => {
  assert.equal(shouldCheat({ successChance: 0.7, cheatCount: 0, firstThreshold: 0.6, laterThreshold: 0.9 }), true);
});

test("shouldCheat declines an unlikely first cheat", () => {
  assert.equal(shouldCheat({ successChance: 0.5, cheatCount: 0, firstThreshold: 0.6, laterThreshold: 0.9 }), false);
});

// Same odds that were fine for the opening cheat are not fine once a failure can eject us.
test("shouldCheat demands a higher bar once ejection is on the table", () => {
  assert.equal(shouldCheat({ successChance: 0.7, cheatCount: 1, firstThreshold: 0.6, laterThreshold: 0.9 }), false);
});

test("shouldCheat still cheats after the first when the odds are overwhelming", () => {
  assert.equal(shouldCheat({ successChance: 0.95, cheatCount: 3, firstThreshold: 0.6, laterThreshold: 0.9 }), true);
});

test("shouldCheat treats an exact threshold as good enough", () => {
  assert.equal(shouldCheat({ successChance: 0.6, cheatCount: 0, firstThreshold: 0.6, laterThreshold: 0.9 }), true);
});
