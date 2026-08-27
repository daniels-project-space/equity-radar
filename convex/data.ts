import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";

/* ------------------------------------------------------------------ */
/* Reads used by actions                                               */
/* ------------------------------------------------------------------ */

export const watchlistTickers = internalQuery({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("watchlist").collect();
    return rows.map((r) => ({ ticker: r.ticker, cik: r.cik, muted: r.muted }));
  },
});

export const quartersFor = internalQuery({
  args: { ticker: v.string() },
  handler: async (ctx, { ticker }) => {
    const rows = await ctx.db
      .query("fundamentals_q")
      .withIndex("by_ticker", (i) => i.eq("ticker", ticker))
      .collect();
    rows.sort((a, b) => b.periodEnd.localeCompare(a.periodEnd));
    return rows;
  },
});

export const barDatesFor = internalQuery({
  args: { ticker: v.string() },
  handler: async (ctx, { ticker }) => {
    const rows = await ctx.db
      .query("prices_daily")
      .withIndex("by_ticker", (i) => i.eq("ticker", ticker))
      .collect();
    return rows.map((r) => r.date);
  },
});

export const barsFor = internalQuery({
  args: { ticker: v.string() },
  handler: async (ctx, { ticker }) => {
    const rows = await ctx.db
      .query("prices_daily")
      .withIndex("by_ticker", (i) => i.eq("ticker", ticker))
      .collect();
    rows.sort((a, b) => a.date.localeCompare(b.date));
    return rows.map((r) => ({ date: r.date, c: r.c, v: r.v }));
  },
});

export const metricsFor = internalQuery({
  args: { tickers: v.array(v.string()) },
  handler: async (ctx, { tickers }) => {
    const out = [];
    for (const t of tickers) {
      const m = await ctx.db
        .query("metrics")
        .withIndex("by_ticker", (i) => i.eq("ticker", t))
        .unique();
      if (m) out.push(m);
    }
    return out;
  },
});

export const peersFor = internalQuery({
  args: { ticker: v.string() },
  handler: async (ctx, { ticker }) => {
    const g = await ctx.db
      .query("peer_groups")
      .withIndex("by_ticker", (i) => i.eq("ticker", ticker))
      .unique();
    return g?.peers ?? [];
  },
});

export const priorScore = internalQuery({
  args: { ticker: v.string() },
  handler: async (ctx, { ticker }) =>
    ctx.db
      .query("scores")
      .withIndex("by_ticker", (i) => i.eq("ticker", ticker))
      .order("desc")
      .first(),
});

export const activeAlertFor = internalQuery({
  args: { ticker: v.string(), type: v.string() },
  handler: async (ctx, { ticker, type }) =>
    ctx.db
      .query("alerts")
      .withIndex("by_ticker_type", (i) => i.eq("ticker", ticker).eq("type", type))
      .order("desc")
      .first(),
});

/* ------------------------------------------------------------------ */
/* Writes                                                              */
/* ------------------------------------------------------------------ */

export const storeBars = internalMutation({
  args: {
    ticker: v.string(),
    bars: v.array(
      v.object({ date: v.string(), o: v.number(), h: v.number(), l: v.number(), c: v.number(), v: v.number() })
    ),
    known: v.array(v.string()),
  },
  handler: async (ctx, { ticker, bars, known }) => {
    const have = new Set(known);
    let inserted = 0;
    for (const b of bars) {
      if (have.has(b.date)) continue;
      await ctx.db.insert("prices_daily", { ticker, ...b });
      inserted++;
    }
    return inserted;
  },
});

export const storePriceStats = internalMutation({
  args: {
    ticker: v.string(),
    stats: v.object({
      last: v.number(),
      prevClose: v.optional(v.number()),
      wk52High: v.number(),
      wk52Low: v.number(),
      drawdownFromHigh: v.number(),
      ret1m: v.optional(v.number()),
      ret3m: v.optional(v.number()),
      ret12m: v.optional(v.number()),
      advUsd: v.optional(v.number()),
    }),
  },
  handler: async (ctx, { ticker, stats }) => {
    const existing = await ctx.db
      .query("price_stats")
      .withIndex("by_ticker", (i) => i.eq("ticker", ticker))
      .unique();
    const doc = { ticker, ...stats, updatedAt: Date.now() };
    if (existing) await ctx.db.patch(existing._id, doc);
    else await ctx.db.insert("price_stats", doc);
  },
});

const quarterFields = {
  fiscalPeriod: v.string(),
  periodEnd: v.string(),
  revenue: v.optional(v.number()),
  grossProfit: v.optional(v.number()),
  opIncome: v.optional(v.number()),
  netIncome: v.optional(v.number()),
  epsDiluted: v.optional(v.number()),
  operatingCashFlow: v.optional(v.number()),
  capex: v.optional(v.number()),
  cash: v.optional(v.number()),
  totalDebt: v.optional(v.number()),
  sharesDiluted: v.optional(v.number()),
  rnd: v.optional(v.number()),
};

export const storeQuarters = internalMutation({
  args: {
    ticker: v.string(),
    cik: v.string(),
    quarters: v.array(v.object(quarterFields)),
    sourceUrl: v.optional(v.string()),
  },
  handler: async (ctx, { ticker, cik, quarters, sourceUrl }) => {
    let written = 0;
    for (const q of quarters) {
      const existing = await ctx.db
        .query("fundamentals_q")
        .withIndex("by_ticker_period", (i) => i.eq("ticker", ticker).eq("fiscalPeriod", q.fiscalPeriod))
        .unique();
      // Every field is listed explicitly, including the absent ones. A spread
      // would omit missing keys, and Convex leaves omitted keys untouched —
      // so a value produced by an earlier, buggier parse would survive the
      // re-ingest forever. Setting them to undefined clears them.
      const doc = {
        ticker,
        cik,
        source: "xbrl" as const,
        sourceUrl,
        ingestedAt: Date.now(),
        fiscalPeriod: q.fiscalPeriod,
        periodEnd: q.periodEnd,
        revenue: q.revenue,
        grossProfit: q.grossProfit,
        opIncome: q.opIncome,
        netIncome: q.netIncome,
        epsDiluted: q.epsDiluted,
        operatingCashFlow: q.operatingCashFlow,
        capex: q.capex,
        cash: q.cash,
        totalDebt: q.totalDebt,
        sharesDiluted: q.sharesDiluted,
        rnd: q.rnd,
      };
      if (existing) {
        // Never let an XBRL refresh clobber a press-release adjusted figure.
        await ctx.db.patch(existing._id, { ...doc, adjEps: existing.adjEps });
      } else {
        await ctx.db.insert("fundamentals_q", doc);
      }
      written++;
    }
    return written;
  },
});

export const storeMetrics = internalMutation({
  args: { ticker: v.string(), metrics: v.any() },
  handler: async (ctx, { ticker, metrics }) => {
    const existing = await ctx.db
      .query("metrics")
      .withIndex("by_ticker", (i) => i.eq("ticker", ticker))
      .unique();
    const doc = {
      ticker,
      asOf: new Date().toISOString().slice(0, 10),
      ...metrics,
      updatedAt: Date.now(),
    };
    if (existing) await ctx.db.patch(existing._id, doc);
    else await ctx.db.insert("metrics", doc);
  },
});

export const storeScore = internalMutation({
  args: { ticker: v.string(), score: v.any() },
  handler: async (ctx, { ticker, score }) => {
    const date = new Date().toISOString().slice(0, 10);
    const existing = await ctx.db
      .query("scores")
      .withIndex("by_ticker_date", (i) => i.eq("ticker", ticker).eq("date", date))
      .unique();
    const doc = { ticker, date, ...score, updatedAt: Date.now() };
    if (existing) await ctx.db.patch(existing._id, doc);
    else await ctx.db.insert("scores", doc);
  },
});

export const storeBands = internalMutation({
  args: { ticker: v.string(), bands: v.any() },
  handler: async (ctx, { ticker, bands }) => {
    const existing = await ctx.db
      .query("buy_bands")
      .withIndex("by_ticker", (i) => i.eq("ticker", ticker))
      .unique();
    const doc = {
      ticker,
      date: new Date().toISOString().slice(0, 10),
      ...bands,
      updatedAt: Date.now(),
    };
    if (existing) await ctx.db.patch(existing._id, doc);
    else await ctx.db.insert("buy_bands", doc);
  },
});

export const storePeers = internalMutation({
  args: { ticker: v.string(), peers: v.array(v.string()) },
  handler: async (ctx, { ticker, peers }) => {
    const existing = await ctx.db
      .query("peer_groups")
      .withIndex("by_ticker", (i) => i.eq("ticker", ticker))
      .unique();
    const doc = { ticker, peers, method: "sic" as const, updatedAt: Date.now() };
    if (existing) await ctx.db.patch(existing._id, doc);
    else await ctx.db.insert("peer_groups", doc);
  },
});

export const storeEvaluation = internalMutation({
  args: {
    ticker: v.string(),
    composite: v.number(),
    asymmetry: v.number(),
    verdict: v.string(),
    changesSincePrior: v.array(v.string()),
    narrative: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("evaluations", {
      ...args,
      date: new Date().toISOString().slice(0, 10),
      createdAt: Date.now(),
    });
    const wl = await ctx.db
      .query("watchlist")
      .withIndex("by_ticker", (i) => i.eq("ticker", args.ticker))
      .unique();
    if (wl) await ctx.db.patch(wl._id, { lastEvaluatedAt: Date.now() });
  },
});

/**
 * Level-triggered: an alert of the same (ticker, type) will not re-fire until
 * its re-arm window expires. Prevents a name sitting inside a buy band from
 * pinging every single day.
 */
export const fireAlert = internalMutation({
  args: {
    ticker: v.string(),
    type: v.string(),
    severity: v.union(v.literal("critical"), v.literal("high"), v.literal("medium")),
    title: v.string(),
    detail: v.string(),
    payload: v.optional(v.any()),
    reArmDays: v.number(),
  },
  handler: async (ctx, { reArmDays, ...a }) => {
    const now = Date.now();
    const prior = await ctx.db
      .query("alerts")
      .withIndex("by_ticker_type", (i) => i.eq("ticker", a.ticker).eq("type", a.type))
      .order("desc")
      .first();
    if (prior && prior.reArmAt > now) return { fired: false, reason: "re-arm window" };

    const id = await ctx.db.insert("alerts", {
      ...a,
      firedAt: now,
      reArmAt: now + reArmDays * 86_400_000,
    });
    return { fired: true, id };
  },
});

export const universeRow = internalQuery({
  args: { ticker: v.string() },
  handler: async (ctx, { ticker }) =>
    ctx.db
      .query("universe")
      .withIndex("by_ticker", (i) => i.eq("ticker", ticker))
      .unique(),
});

export const setUniverseMeta = internalMutation({
  args: {
    ticker: v.string(),
    sicCode: v.optional(v.string()),
    industry: v.optional(v.string()),
    marketCap: v.optional(v.number()),
  },
  handler: async (ctx, { ticker, ...patch }) => {
    const row = await ctx.db
      .query("universe")
      .withIndex("by_ticker", (i) => i.eq("ticker", ticker))
      .unique();
    if (!row) return;
    const clean = Object.fromEntries(Object.entries(patch).filter(([, x]) => x !== undefined));
    await ctx.db.patch(row._id, { ...clean, updatedAt: Date.now() });
  },
});

/**
 * Peer set = same SIC code, restricted to names we have already scored.
 * A median over companies we have not computed would be a fabricated
 * comparison, so an under-populated group returns fewer than 3 and the
 * valuation bucket falls back to absolute multiples.
 */
export const rebuildSicPeers = internalMutation({
  args: { ticker: v.string(), sicCode: v.string() },
  handler: async (ctx, { ticker, sicCode }) => {
    const withMetrics = await ctx.db.query("metrics").collect();
    const peers: string[] = [];
    for (const m of withMetrics) {
      if (m.ticker === ticker) continue;
      const u = await ctx.db
        .query("universe")
        .withIndex("by_ticker", (i) => i.eq("ticker", m.ticker))
        .unique();
      if (u?.sicCode === sicCode) peers.push(m.ticker);
    }
    const existing = await ctx.db
      .query("peer_groups")
      .withIndex("by_ticker", (i) => i.eq("ticker", ticker))
      .unique();
    const doc = { ticker, peers, method: "sic" as const, updatedAt: Date.now() };
    if (existing) await ctx.db.patch(existing._id, doc);
    else await ctx.db.insert("peer_groups", doc);
    return peers;
  },
});

export const startRun = internalMutation({
  args: { task: v.string() },
  handler: async (ctx, { task }) => ctx.db.insert("runs", { task, startedAt: Date.now() }),
});

export const finishRun = internalMutation({
  args: { id: v.id("runs"), ok: v.boolean(), processed: v.optional(v.number()), error: v.optional(v.string()) },
  handler: async (ctx, { id, ...rest }) => ctx.db.patch(id, { ...rest, finishedAt: Date.now() }),
});
