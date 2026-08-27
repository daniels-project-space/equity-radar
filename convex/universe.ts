import { v } from "convex/values";
import { query, mutation, internalMutation } from "./_generated/server";

/** Type-ahead for the add-company box. Ticker prefix wins over name match. */
export const search = query({
  args: { q: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, { q, limit = 12 }) => {
    const term = q.trim().toLowerCase();
    if (term.length < 1) return [];

    const exact = await ctx.db
      .query("universe")
      .withIndex("by_ticker", (i) => i.eq("ticker", term.toUpperCase()))
      .take(1);

    const byName = await ctx.db
      .query("universe")
      .withSearchIndex("search_name", (i) => i.search("searchKey", term))
      .take(limit);

    const seen = new Set<string>();
    const out = [];
    for (const row of [...exact, ...byName]) {
      if (seen.has(row.ticker)) continue;
      seen.add(row.ticker);
      out.push({
        ticker: row.ticker,
        cik: row.cik,
        name: row.name,
        exchange: row.exchange,
        sector: row.sector,
      });
      if (out.length >= limit) break;
    }
    return out;
  },
});

export const getByTicker = query({
  args: { ticker: v.string() },
  handler: async (ctx, { ticker }) =>
    ctx.db
      .query("universe")
      .withIndex("by_ticker", (i) => i.eq("ticker", ticker.toUpperCase()))
      .unique(),
});

export const count = query({
  args: {},
  handler: async (ctx) => (await ctx.db.query("universe").take(1)).length,
});

/** Called in batches by the universe-refresh action. */
export const bulkUpsert = internalMutation({
  args: {
    rows: v.array(
      v.object({
        ticker: v.string(),
        cik: v.string(),
        name: v.string(),
        exchange: v.optional(v.string()),
      })
    ),
  },
  handler: async (ctx, { rows }) => {
    let inserted = 0;
    let updated = 0;
    for (const row of rows) {
      const existing = await ctx.db
        .query("universe")
        .withIndex("by_ticker", (i) => i.eq("ticker", row.ticker))
        .unique();
      const doc = {
        ...row,
        searchKey: `${row.ticker} ${row.name}`.toLowerCase(),
        isActive: true,
        updatedAt: Date.now(),
      };
      if (existing) {
        await ctx.db.patch(existing._id, doc);
        updated++;
      } else {
        await ctx.db.insert("universe", doc);
        inserted++;
      }
    }
    return { inserted, updated };
  },
});

/** Manual seed escape hatch so the app is usable before the first cron run. */
export const seedOne = mutation({
  args: { ticker: v.string(), cik: v.string(), name: v.string() },
  handler: async (ctx, { ticker, cik, name }) => {
    const t = ticker.toUpperCase();
    const existing = await ctx.db
      .query("universe")
      .withIndex("by_ticker", (i) => i.eq("ticker", t))
      .unique();
    if (existing) return existing._id;
    return ctx.db.insert("universe", {
      ticker: t,
      cik: cik.padStart(10, "0"),
      name,
      searchKey: `${t} ${name}`.toLowerCase(),
      isActive: true,
      updatedAt: Date.now(),
    });
  },
});
