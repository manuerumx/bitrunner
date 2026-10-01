# Reverted stock changes — what they did, why, and how to bring them back

On 2026-10-01 `testing` was fast-forwarded to `main` (`c793b5f`) and the two code commits
`main` had gained since `0f2f491` were reverted, because the game misbehaved with them in.
The original commits are still in history; this file records what each one was for so it can
be re-implemented deliberately rather than rediscovered.

| Commit | Subject | State on `testing` |
| --- | --- | --- |
| `23e7d0f` | Gate the forecast path on the 4S TIX API rung, not on 4S Market Data | reverted by `013f5da` |
| `2c8d34e` | Refuse stock entries the commission would dominate | reverted by `9db6285` |
| `c793b5f` | More docs (`docs/INFILTRATION.md`, two lines of `API-COVERAGE-AUDIT.md`) | **kept** — docs only |

The symptom seen in-game: the stock trader stopped buying and sat waiting until cash was
much larger before it started working, where before it bought straight away. That matches
the entry gate in section 2. The mechanisms below are read from the code, not reproduced
in-game, and nothing observed points at the 4S gate in section 1.

## 1. `23e7d0f` — 4S access gate

**Problem it solved.** `stock-trader.js` and `stock-report.js` decide whether to use
forecasts with `ns.stock.has4SData()`, but `getForecast()` / `getVolatility()` require the
*4S Market Data TIX API* — a separate, dearer purchase ($25b vs $1b). On a save that owns the
data but not the API, the gate reads true and the first `getForecast()` throws
"You don't have 4S Market Data TIX API Access!", killing the manager.

**What it changed.**

- `stock-trader.js`: `use4S = ns.stock.has4SDataTixApi()`; the startup warning names which
  rung is missing (data owned but API not, vs neither).
- `stock-report.js`: same gate swap.

**Side effect worth knowing.** On a data-without-API save the trader used to crash, i.e. not
trade at all. With the fix it runs the *momentum fallback* instead, which buys and sells
blind on price history. That is a behaviour change from "does nothing" to "trades without
forecasts", and is the only way this commit can move money differently than before.

**With it reverted.** The crash is back: owning 4S Market Data without the 4S TIX API will
throw in both scripts. Saves that own both rungs, or neither, are unaffected.

**To re-implement.** Small and self-contained — `git cherry-pick 23e7d0f` applies as is.
Decide first whether data-without-API should trade on momentum or sit idle; if idle, add
that choice explicitly rather than relying on the crash.

## 2. `2c8d34e` — commission-ratio entry gate

**Problem it solved.** `stockReservedCash` ($1b) pins cash near the floor, the trader spends
the surplus every 6 s, and each symbol gets 20% of a 25% budget — 5% of a small surplus. A
live log showed ~$611k slices against $1.012b cash: a $100k commission on ~$500k of stock,
21% on entry and 42% round trip. Exits were already dust-filtered by `worthTrading`; entries
were not.

**What it changed.**

- `lib/market.js`
  - `worthOpening(cost, commission, maxRatio)` — true only if the fee is at most `maxRatio`
    of the stock actually bought (`cost - commission`).
  - `cashToOpenPosition({reserve, commission, maxRatio, percent, fraction})` — the cash level
    at which the gate first opens; `reserve + (commission / maxRatio + commission) / (percent * fraction)`.
  - `POSITION_BUDGET_FRACTION = 0.2` moved here from `stock-trader.js` so the report sizes
    the same slice as the trader.
- `lib/constants.js`: `DEFAULTS.stockMinCommissionRatio = 0.01` (`Infinity` = old behaviour).
- `stock-trader.js`, four gate sites:
  - 4S loop: `break` when the per-symbol slice fails `worthOpening` (replacing
    `remaining <= COMMISSION * 2`);
  - the long order, the short order, and the momentum long order each re-check the real
    order cost, since share granularity can leave an order well under its slice.
- `stock-report.js`: ACTION column shows `wait` instead of `BUY`/`ADD` while the gate is shut;
  new "Entry size" line; new `saving — … until cash reaches $X` verdict, placed ahead of the
  under-invested verdict.
- `test/market.test.js`: +11 tests for the two new functions.
- Docs: guide/README/audit/architecture entries for the above, plus three unrelated
  corrections (stale `shouldRealize` references; F-37 row marked unresolved though fixed).

**Why it likely broke the game.** With the defaults a position must be at least $10m, so the
slice must reach $10.1m, so the gate stays shut until cash is **$1.202b**. The design assumed
refused cash would "compound across cycles" up to that figure. Nothing reserves it, though:
the trader's reserve only restrains the trader. `programBudgetPercent`,
`homeUpgradeBudgetPercent` and `marketAccessBudgetPercent` each take up to 50% of cash per
burst, plus hacknet, sleeves and the server/augmentation buyers. Cash idling between $1b and
$1.2b is exactly what those buyers consume, so the threshold may never be reached and the
trader stops opening positions entirely. (An earlier session reached the same diagnosis:
"worthOpening rejects from pre-accumulate cash drain".)

Secondary effects of the same gate:

- Just above the threshold the slice passes but every real order lands under it (granularity,
  spread) and is refused by the per-order check — the report says `BUY`, the trader buys nothing.
- `ADD` orders that top up a nearly-full position are refused when the remaining room is
  worth under $10m, so positions stop short of `maxShares`.

**To re-implement.** Split it; the pieces have different risk.

1. Safe on their own: moving `POSITION_BUDGET_FRACTION` into `lib/market.js`, and the three
   doc corrections.
2. The gate needs a design that does not depend on cash surviving other buyers. Options, in
   rough order of preference:
   - When the budget cannot fund five fee-worthy slices, fund fewer, larger ones
     (`floor(cycleBudget / minSlice)` symbols) instead of refusing all of them.
   - Size the minimum against the whole surplus above the reserve rather than 5% of it.
   - Give the trader an earmark other buyers respect while it is saving.
   - Ship the gate with `stockMinCommissionRatio: Infinity` and tune down in-game.
3. The report changes (`wait`, "Entry size", `saving` verdict) follow whatever gate is chosen
   and should land with it.
4. The per-order checks should not apply to `ADD` on an existing position without thought —
   decide whether topping up a position is subject to the same minimum.
