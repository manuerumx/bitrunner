// IPvGO reporting and cheat policy. See docs/API-COVERAGE-AUDIT.md §5.13.
//
// Note on what is NOT here: analysis.getChains / getLiberties / getControlledEmptyNodes
// cost 16 GB *each*. ipvgo.js already declines analysis.getValidMoves at 8 GB (see the
// comment at ipvgo.js:161), so wiring in 48 GB of board analysis would more than quintuple
// the script. getStats/resetStats and getMoveHistory really are 0 GB, and that is what
// this module uses.

/**
 * Per-opponent record, weakest first.
 *
 * Sorting by win rate puts the opponent actually costing games at the top — that is the
 * one whose board the strategy is failing on. Unplayed opponents report a null rate rather
 * than 0, so "never tried" is not mistaken for "never wins".
 *
 * @param {Record<string, {wins: number, losses: number, winStreak: number,
 *   highestWinStreak: number, bonusPercent: number}>} stats  ns.go.analysis.getStats()
 */
export function summarizeGoStats(stats) {
  return Object.entries(stats)
    .map(([opponent, s]) => {
      const played = s.wins + s.losses;
      return {
        opponent,
        played,
        wins: s.wins,
        losses: s.losses,
        winRate: played > 0 ? s.wins / played : null,
        winStreak: s.winStreak,
        highestWinStreak: s.highestWinStreak,
        bonusPercent: s.bonusPercent,
      };
    })
    .sort((a, b) => (a.winRate ?? -1) - (b.winRate ?? -1));
}

/**
 * Which opponent router to remove, if any.
 *
 * Only routers touching one of ours are worth a cheat: removing an isolated stone deep in
 * the opponent's own area concedes the turn for nothing, while breaking a contact point
 * opens up territory the fill stage can immediately claim.
 *
 * Board is board[x][y] — 'X' ours, 'O' theirs, '.' empty, '#' dead node — matching
 * ns.go.getBoardState().
 *
 * @param {string[]} board
 * @returns {{x: number, y: number} | null}
 */
export function pickCheatTarget(board) {
  const at = (x, y) => board[x]?.[y];

  for (let x = 0; x < board.length; x++) {
    for (let y = 0; y < board[x].length; y++) {
      if (at(x, y) !== "O") continue;
      const touchesUs =
        at(x - 1, y) === "X" || at(x + 1, y) === "X" || at(x, y - 1) === "X" || at(x, y + 1) === "X";
      if (touchesUs) return { x, y };
    }
  }
  return null;
}

/**
 * Is a cheat move worth attempting right now?
 *
 * The penalty for failure is not flat, so neither is the bar. Quoting the API docs: "if you
 * fail to play a cheat move, your turn will be skipped. After your first cheat attempt, if
 * you fail, there is a small (~10%) chance you will instantly be ejected from the subnet."
 *
 * So the opening cheat risks only a wasted turn, while every later one risks the whole
 * game — and getCheatSuccessChance falls as the count rises, so the odds get worse exactly
 * as the stakes get higher. Two thresholds rather than one.
 *
 * @param {{successChance: number, cheatCount: number,
 *   firstThreshold: number, laterThreshold: number}} input
 */
export function shouldCheat({ successChance, cheatCount, firstThreshold, laterThreshold }) {
  const bar = cheatCount === 0 ? firstThreshold : laterThreshold;
  return successChance >= bar;
}
