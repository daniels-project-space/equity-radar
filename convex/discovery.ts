import { v } from "convex/values";
import { query, internalMutation, internalQuery } from "./_generated/server";

/**
 * Peer discovery bookkeeping.
 *
 * `discovered` companies are scored so they can be compared, but they are not
 * on the watchlist — they never generate alerts, never appear in the DCA
 * allocation, and are not something the user chose to follow. They exist so
 * that "closest competitors" means the industry rather than the watchlist.
 */

/** Watchlist names whose peer group is too thin to compare against. */
export const peerGaps = internalQuery({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit = 6 }) => {
    const watch = (await ctx.db.query("watchlist").collect()).filter(
      (w) => w.assetType !== "crypto"
    ); // Peer discovery searches SEC industry codes, which crypto has none of.
    const gaps: { ticker: string; sicCode: string; peers: number }[] = [];

    for (const w of watch) {
      const u = await ctx.db
        .query("universe")
        .withIndex("by_ticker", (i) => i.eq("ticker", w.ticker))
        .unique();
      if (!u?.sicCode) continue;
      const group = await ctx.db
        .query("peer_groups")
        .withIndex("by_ticker", (i) => i.eq("ticker", w.ticker))
        .unique();
      const count = group?.peers.length ?? 0;
      if (count >= 5) continue; // already comparable
      gaps.push({ ticker: w.ticker, sicCode: u.sicCode, peers: count });
    }

    // Thinnest groups first — that is where a new peer adds the most.
    gaps.sort((a, b) => a.peers - b.peers);
    return gaps.slice(0, limit);
  },
});

/**
 * Same-industry companies we have not scored yet. Ordered by market cap where
 * known so discovery starts with the meaningful names rather than shells.
 */
/**
 * Turns EDGAR's CIK list for an industry into tickers we can actually ingest,
 * dropping anything already scored. The universe table is the CIK→ticker map;
 * filers without a listed ticker are skipped.
 */
export const resolveCiks = internalQuery({
  args: { ciks: v.array(v.string()), limit: v.optional(v.number()) },
  handler: async (ctx, { ciks, limit = 10 }) => {
    const out: { ticker: string; cik: string; name: string }[] = [];
    for (const cik of ciks) {
      if (out.length >= limit) break;
      const u = await ctx.db
        .query("universe")
        .withIndex("by_cik", (i) => i.eq("cik", cik))
        .first();
      if (!u || !u.isActive) continue;
      const scored = await ctx.db
        .query("metrics")
        .withIndex("by_ticker", (i) => i.eq("ticker", u.ticker))
        .unique();
      if (scored) continue;
      out.push({ ticker: u.ticker, cik: u.cik, name: u.name });
    }
    return out;
  },
});

export const markDiscovered = internalMutation({
  args: { ticker: v.string(), forTicker: v.string() },
  handler: async (ctx, { ticker, forTicker }) => {
    const existing = await ctx.db
      .query("discovered")
      .withIndex("by_ticker", (i) => i.eq("ticker", ticker))
      .unique();
    if (existing) {
      const forList = existing.discoveredFor.includes(forTicker)
        ? existing.discoveredFor
        : [...existing.discoveredFor, forTicker];
      await ctx.db.patch(existing._id, { discoveredFor: forList, updatedAt: Date.now() });
      return;
    }
    await ctx.db.insert("discovered", {
      ticker,
      discoveredFor: [forTicker],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  },
});

/** Discovered names ranked by asymmetry — candidates worth a closer look. */
export const candidates = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit = 20 }) => {
    const rows = await ctx.db.query("discovered").collect();
    const watch = (await ctx.db.query("watchlist").collect()).filter(
      (w) => w.assetType !== "crypto"
    ); // Peer discovery searches SEC industry codes, which crypto has none of.
    const watched = new Set(watch.map((w) => w.ticker));

    const out = [];
    for (const d of rows) {
      if (watched.has(d.ticker)) continue;
      const [metrics, bands, universe] = await Promise.all([
        ctx.db.query("metrics").withIndex("by_ticker", (i) => i.eq("ticker", d.ticker)).unique(),
        ctx.db.query("buy_bands").withIndex("by_ticker", (i) => i.eq("ticker", d.ticker)).unique(),
        ctx.db.query("universe").withIndex("by_ticker", (i) => i.eq("ticker", d.ticker)).unique(),
      ]);
      const score = await ctx.db
        .query("scores")
        .withIndex("by_ticker", (i) => i.eq("ticker", d.ticker))
        .order("desc")
        .first();
      if (!score) continue;
      out.push({
        ticker: d.ticker,
        name: universe?.name ?? d.ticker,
        discoveredFor: d.discoveredFor,
        asymmetry: score.asymmetry,
        composite: score.composite,
        verdict: score.verdict,
        moatScore: metrics?.moatScore,
        upside: bands?.upside,
        marketCap: metrics?.marketCap,
      });
    }

    out.sort((a, b) => (b.asymmetry ?? 0) - (a.asymmetry ?? 0));
    return out.slice(0, limit);
  },
});

export const stats = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("discovered").collect();
    return { discovered: rows.length };
  },
});
