import { shouldAcceptOffer, trackOffer } from "/src/lib/corp.js";
import { DEFAULTS, PORTS } from "/src/lib/constants.js";
import { writePortData } from "/src/lib/port-registry.js";
import { formatMoney, log, tlog } from "/src/lib/utils.js";

// Takes the investment rounds, then goes public and pays dividends.
//
//   run /src/tools/corp-invest.js        act
//   run /src/tools/corp-invest.js dry    report what it would do
//
// Rounds 1 to DEFAULTS.corpInvestRounds are each accepted once the offer stops growing (see
// shouldAcceptOffer). The offers seen so far this round are kept in TRACK_FILE between runs.
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
 * @returns {OfferTrack | null}
 */
function readTrack(ns) {
  try {
    return JSON.parse(ns.read(TRACK_FILE));
  } catch {
    return null; // no file yet, or one written by hand
  }
}
/** @typedef {import("/src/lib/corp.js").OfferTrack} OfferTrack */

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

  const now = Date.now();
  const track = trackOffer(readTrack(ns), offer, now, DEFAULTS.corpInvestMinGrowth);
  const rule = { plateauMs: DEFAULTS.corpInvestPlateauMs, dip: DEFAULTS.corpInvestDip };
  if (shouldAcceptOffer(track, offer, now, rule)) {
    tlog(ns, `corp-invest: ${dryRun ? "would accept" : "accepting"} round ${offer.round}: ${formatMoney(offer.funds)} for ${offer.shares} shares`);
    if (dryRun) return;
    ns.corporation.acceptInvestmentOffer();
    ns.write(TRACK_FILE, "", "w");
    return;
  }

  say(`corp-invest: round ${offer.round} offer ${formatMoney(offer.funds)}, best ${formatMoney(track.best)}; waiting for it to level off`);
  if (!dryRun) ns.write(TRACK_FILE, JSON.stringify(track), "w");
}

