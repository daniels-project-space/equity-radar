import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";

async function latestFor(ctx: any, ticker: string) {
  const [priceStats, metrics, bands] = await Promise.all([
    ctx.db.query("price_stats").withIndex("by_ticker", (i: any) => i.eq("ticker", ticker)).unique(),
    ctx.db.query("metrics").withIndex("by_ticker", (i: any) => i.eq("ticker", ticker)).unique(),
    ctx.db
      .query("buy_bands")
      .withIndex("by_ticker", (i: any) => i.eq("ticker", ticker))
      .order("desc")
      .first(),
  ]);
  const score = await ctx.db
    .query("scores")
    .withIndex("by_ticker", (i: any) => i.eq("ticker", ticker))
    .order("desc")
    .first();
  return { priceStats, metrics, bands, score };
}

/** Everything the dashboard grid needs, in one round trip. */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("watchlist").collect();
    const out = [];
    for (const row of rows) {
      const joined = await latestFor(ctx, row.ticker);
      out.push({ ...row, ...joined });
    }
    // Best entry first — that is the whole point of the asymmetry score.
    out.sort((a, b) => (b.score?.asymmetry ?? -1) - (a.score?.asymmetry ?? -1));
    return out;
  },
});

export const get = query({
  args: { ticker: v.string() },
  handler: async (ctx, { ticker }) => {
    const t = ticker.toUpperCase();
    const entry = await ctx.db
      .query("watchlist")
      .withIndex("by_ticker", (i) => i.eq("ticker", t))
      .unique();
    const universe = await ctx.db
      .query("universe")
      .withIndex("by_ticker", (i) => i.eq("ticker", t))
      .unique();
    if (!entry && !universe) return null;

    const joined = await latestFor(ctx, t);
    const quarters = await ctx.db
      .query("fundamentals_q")
      .withIndex("by_ticker", (i) => i.eq("ticker", t))
      .collect();
    quarters.sort((a, b) => b.periodEnd.localeCompare(a.periodEnd));

    const thesis = await ctx.db
      .query("theses")
      .withIndex("by_ticker", (i) => i.eq("ticker", t))
      .order("desc")
      .first();

    const alerts = await ctx.db
      .query("alerts")
      .withIndex("by_ticker", (i) => i.eq("ticker", t))
      .order("desc")
      .take(20);

    const evaluations = await ctx.db
      .query("evaluations")
      .withIndex("by_ticker", (i) => i.eq("ticker", t))
      .order("desc")
      .take(30);

    const peers = await ctx.db
      .query("peer_groups")
      .withIndex("by_ticker", (i) => i.eq("ticker", t))
      .unique();

    // 8-K Item 2.02 filing dates are the real earnings dates — no calendar
    // feed needed, and they line up with the price history exactly.
    const releases = await ctx.db
      .query("filings")
      .withIndex("by_ticker", (i) => i.eq("ticker", t))
      .collect();
    const earningsDates = releases
      .map((r) => r.filedAt)
      .sort()
      .slice(-24);

    const guidance = await ctx.db
      .query("guidance")
      .withIndex("by_ticker", (i) => i.eq("ticker", t))
      .collect();
    guidance.sort((a, b) => b.issuedAt - a.issuedAt);

    return {
      ticker: t,
      onWatchlist: !!entry,
      entry,
      universe,
      ...joined,
      quarters: quarters.slice(0, 12),
      thesis,
      alerts,
      evaluations,
      peers: peers?.peers ?? [],
      earningsDates,
      guidance: guidance.slice(0, 4),
    };
  },
});

export const priceSeries = query({
  args: { ticker: v.string(), days: v.optional(v.number()) },
  handler: async (ctx, { ticker, days = 1260 }) => {
    const rows = await ctx.db
      .query("prices_daily")
      .withIndex("by_ticker", (i) => i.eq("ticker", ticker.toUpperCase()))
      .collect();
    rows.sort((a, b) => a.date.localeCompare(b.date));
    return rows.slice(-days).map((r: Doc<"prices_daily">) => ({
      date: r.date,
      o: r.o,
      h: r.h,
      l: r.l,
      c: r.c,
      v: r.v,
    }));
  },
});

export const add = mutation({
  args: { ticker: v.string(), reason: v.optional(v.string()) },
  handler: async (ctx, { ticker, reason }) => {
    const t = ticker.toUpperCase();
    const existing = await ctx.db
      .query("watchlist")
      .withIndex("by_ticker", (i) => i.eq("ticker", t))
      .unique();
    if (existing) return { id: existing._id, created: false };

    const u = await ctx.db
      .query("universe")
      .withIndex("by_ticker", (i) => i.eq("ticker", t))
      .unique();
    if (!u) throw new Error(`${t} is not in the universe — refresh the universe first`);

    const id = await ctx.db.insert("watchlist", {
      ticker: t,
      cik: u.cik,
      name: u.name,
      addedAt: Date.now(),
      addedReason: reason,
      muted: false,
    });
    return { id, created: true, cik: u.cik };
  },
});

export const remove = mutation({
  args: { ticker: v.string() },
  handler: async (ctx, { ticker }) => {
    const row = await ctx.db
      .query("watchlist")
      .withIndex("by_ticker", (i) => i.eq("ticker", ticker.toUpperCase()))
      .unique();
    if (row) await ctx.db.delete(row._id);
    return { removed: !!row };
  },
});

export const update = mutation({
  args: {
    ticker: v.string(),
    notes: v.optional(v.string()),
    muted: v.optional(v.boolean()),
    targetMultipleLo: v.optional(v.number()),
    targetMultipleHi: v.optional(v.number()),
  },
  handler: async (ctx, { ticker, ...patch }) => {
    const row = await ctx.db
      .query("watchlist")
      .withIndex("by_ticker", (i) => i.eq("ticker", ticker.toUpperCase()))
      .unique();
    if (!row) throw new Error("not on watchlist");
    const clean = Object.fromEntries(Object.entries(patch).filter(([, v2]) => v2 !== undefined));
    await ctx.db.patch(row._id, clean);
  },
});
