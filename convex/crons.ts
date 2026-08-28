import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

// Convex cron specs are UTC. London is UTC+1 in summer, UTC+0 in winter, so
// these drift by an hour across DST — acceptable for a daily research sweep.
const crons = cronJobs();

/**
 * Adjusted EPS and guidance first, so the re-score that follows an hour later
 * sees the press-release figures rather than GAAP-only numbers.
 */
crons.cron("extract earnings releases", "40 3 * * 2-6", internal.ingest.extractReleasesAll, {});

/** Full watchlist re-score after the US close. 05:00 UTC = ~06:00 London. */
crons.cron("daily watchlist eval", "0 5 * * 2-6", internal.ingest.refreshWatchlist, {});

/** Ticker/CIK map + exchange listings. */
crons.cron("weekly universe refresh", "17 3 * * 0", internal.ingest.refreshUniverseCron, {});

/** A fresh 10-K/10-Q should not wait for tomorrow's sweep. */
crons.interval("poll filings", { hours: 6 }, internal.ingest.pollFilings, {});

/**
 * Live prices through the US session. Quotes only — no SEC traffic — so the
 * chart, the day's change and the current band stay current without pretending
 * the fundamentals were re-examined. 13-20 UTC covers 09:30-16:30 ET in summer;
 * the winter hour of drift costs one stale reading at each end.
 */
crons.cron("intraday quotes", "*/12 13-20 * * 1-5", internal.ingest.refreshQuotes, {});
/** One clean read after the close, so the day ends on a settled price. */
crons.cron("closing quote", "35 20 * * 1-5", internal.ingest.refreshQuotes, {});

/** Records the day's DCA recommendation, then re-runs the rule simulation. */
crons.cron("snapshot allocation", "10 6 * * 1-5", internal.strategyActions.snapshotAllocation, {});
crons.cron("run strategy simulation", "25 6 * * 1-5", internal.strategyActions.runSimCron, {});

/**
 * Crypto refresh. On-chain series update once a day and the endpoint rate-limits
 * hard, so this runs once rather than on the intraday cadence prices use.
 */
crons.cron("refresh crypto", "10 4 * * *", internal.cryptoActions.refreshCryptoCron, {});

/** Ranks every entry rule against buy-and-hold across names and periods. */
crons.cron("signal tournament", "55 2 * * 0", internal.strategyActions.tournamentCron, {});

/** Re-measures what each dip state was actually worth, and re-tunes from it. */
crons.cron("calibrate indicators", "40 2 * * 0", internal.strategyActions.calibrateCron, {});

/** Fills thin peer groups from the full SEC universe, a few names per run. */
crons.cron("discover peers", "50 2 * * *", internal.strategyActions.discoverPeers, {});

/** Benchmark series, needed before outcomes can be scored as alpha. */
crons.cron("refresh benchmark", "20 22 * * 1-5", internal.pushActions.refreshBenchmark, {});

/** Score matured signal windows against SPY. */
crons.cron("score signal outcomes", "45 22 * * 1-5", internal.pushActions.markOutcomes, {});

/**
 * Native push. Frequent enough to feel immediate, and the pending query only
 * returns alerts from the last 36 hours, so a quiet period cannot produce a
 * burst of stale notifications.
 */
crons.interval("send push notifications", { minutes: 15 }, internal.pushActions.sendPending, {});

export default crons;
