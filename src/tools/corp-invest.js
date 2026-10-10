import { SPENDING_HOLD_FILE, parseSpendingHold, profitLevelledOff, trackProfit } from "/src/lib/corp.js";
import { DEFAULTS, PORTS } from "/src/lib/constants.js";
import { writePortData } from "/src/lib/port-registry.js";
import { formatMoney, log, tlog } from "/src/lib/utils.js";

// Takes the investment rounds, then goes public and pays dividends.
//
//   run /src/tools/corp-invest.js        act
//   run /src/tools/corp-invest.js dry    report what it would do
//
// Rounds 1 to DEFAULTS.corpInvestRounds are each taken once the corp's profit stops growing
// (see trackProfit; the offer itself swings too much with spending to watch). The record of
// this round's profit is kept in TRACK_FILE between runs. The offer then isn't accepted
// straight away: valuation averages the last ~100 s of asset growth, which every purchase
// cuts, so this first writes SPENDING_HOLD_FILE to stop the other corp tools spending, and
// accepts DEFAULTS.corpHoldSettleMs later, at whatever the offer is.
// After the last round the corporation goes public issuing no new shares, which keeps your
// ownership, and then pays DEFAULTS.corpDividendRate of profit as dividends. Dividends are the
// only way corporation profit reaches your own money.
//
// Also publishes CorpStatus on PORTS.CORP_STATUS.
//
// ONE-SHOT and idempotent: the daemon runs it about three times every five minutes.

const TRACK_FILE = "/data/corp-invest.txt";

/**
 * @param {NS} ns
 * @returns {ProfitTrack | null}
 */
function readTrack(ns) {
  let track;
  try {
    track = JSON.parse(ns.read(TRACK_FILE));
  } catch {
    return null; // no file yet
  }
  // A record missing a field (an older version's, or edited by hand) is no record.
  const fields = ["round", "profit", "markAt", "seenAt"];
  return track && fields.every((field) => Number.isFinite(track[field])) ? track : null;
}
/** @typedef {import("/src/lib/corp.js").ProfitTrack} ProfitTrack */
/** @typedef {import("/src/lib/corp.js").SpendingHold} SpendingHold */

/** @param {NS} ns */
export async function main(ns) {
  const dryRun = String(ns.args[0] ?? "").toLowerCase() === "dry";
  const say = (/** @type {string} */ msg) => (dryRun ? tlog(ns, msg) : log(ns, msg));

  if (!ns.corporation.hasCorporation()) return;
  const corp = ns.corporation.getCorporation();

  /** @type {CorpStatus} */
  const status = {
    revenue: corp.revenue,
    expenses: corp.expenses,
    profit: corp.revenue - corp.expenses,
    funds: corp.funds,
    divisions: corp.divisions.length,
  };
  if (!dryRun) writePortData(ns, PORTS.CORP_STATUS, status);

  if (corp.public) {
    const rate = Math.min(DEFAULTS.corpDividendRate, ns.corporation.getConstants().dividendMaxRate);
    if (corp.dividendRate !== rate) {
      tlog(ns, `corp-invest: ${dryRun ? "would pay" : "paying"} ${rate * 100}% of profit as dividends`);
      if (!dryRun) ns.corporation.issueDividends(rate);
    }
    return;
  }

  const offer = ns.corporation.getInvestmentOffer();
  if (offer.round > DEFAULTS.corpInvestRounds) {
    tlog(ns, `corp-invest: ${dryRun ? "would go" : "going"} public, issuing no new shares`);
    if (!dryRun) ns.corporation.goPublic(0);
    return;
  }

  // A corp making no profit sits at the valuation floor: its offer is flat, and cheap.
  if (corp.revenue <= corp.expenses) {
    say(`corp-invest: round ${offer.round} offer ${formatMoney(offer.funds)} ignored, the corp isn't making a profit`);
    return;
  }

  const now = Date.now();
  const profit = corp.revenue - corp.expenses;
  const track = trackProfit(readTrack(ns), offer.round, profit, now, {
    minGrowth: DEFAULTS.corpInvestMinGrowth,
    maxGapMs: DEFAULTS.corpInvestMaxGapMs,
  });
  const hold = parseSpendingHold(ns.read(SPENDING_HOLD_FILE), now, DEFAULTS.corpHoldMaxMs);
  const where = `round ${offer.round} offer ${formatMoney(offer.funds)}`;

  // A hold left from another round (one accepted by hand) is lifted, never acted on.
  if (hold && hold.round !== offer.round) {
    say(`corp-invest: lifting the spending hold left from round ${hold.round}`);
    if (!dryRun) ns.write(SPENDING_HOLD_FILE, "", "w");
  } else if (hold) {
    const heldMs = now - hold.since;
    if (heldMs >= DEFAULTS.corpHoldSettleMs) {
      tlog(ns, `corp-invest: ${dryRun ? "would accept" : "accepting"} round ${offer.round}: ${formatMoney(offer.funds)} for ${offer.shares} shares`);
      if (dryRun) return;
      ns.corporation.acceptInvestmentOffer();
      ns.write(TRACK_FILE, "", "w");
      ns.write(SPENDING_HOLD_FILE, "", "w");
      return;
    }
    say(`corp-invest: ${where}; spending held, accepting in ${Math.ceil((DEFAULTS.corpHoldSettleMs - heldMs) / 1000)}s`);
    if (!dryRun) ns.write(TRACK_FILE, JSON.stringify(track), "w");
    return;
  }

  if (profitLevelledOff(track, now, DEFAULTS.corpInvestPlateauMs)) {
    tlog(ns, `corp-invest: ${where}; profit has levelled off, ${dryRun ? "would hold" : "holding"} the corp's spending so the offer shows it`);
    if (dryRun) return;
    /** @type {SpendingHold} */
    const record = { round: offer.round, since: now };
    ns.write(SPENDING_HOLD_FILE, JSON.stringify(record), "w");
    ns.write(TRACK_FILE, JSON.stringify(track), "w");
    return;
  }

  const flatMin = Math.floor((now - track.markAt) / 60e3);
  const needMin = Math.round(DEFAULTS.corpInvestPlateauMs / 60e3);
  say(`corp-invest: ${where}; profit ${formatMoney(profit)}/s, flat for ${flatMin} of ${needMin} min`);
  if (!dryRun) ns.write(TRACK_FILE, JSON.stringify(track), "w");
}

