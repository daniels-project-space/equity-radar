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

export default crons;
