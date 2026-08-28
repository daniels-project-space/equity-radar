import { v } from "convex/values";
import { query, internalMutation, internalQuery } from "./_generated/server";
import { allocate, type Candidate } from "./lib/allocator";

/**
 * Today's DCA recommendation, computed live from the current scores.
 *
 * A dip that is turning up raises conviction; one still falling lowers it.
 * Being cheap and being ready are different things, and the allocator should
 * care about both.
 */
export const today = query({
  args: {},
  handler: async (ctx) => {
    const watch = await ctx.db.query("watchlist").collect();
    const candidates: (Candidate & { dipState?: string; dipScore?: number })[] = [];

    // Conviction multipliers come from measured forward returns per signal
    // bucket. They were hand-picked originally, which is a guess dressed as a
    // rule; anything that fails its own test is shrunk back to 1.00 and stops
    // mattering. There is deliberately no hand-written fallback — an unmeasured
    // signal should have no effect, not an invented one.
    const calib = await ctx.db
      .query("simulations")
      .withIndex("by_key", (i) => i.eq("key", "calibration"))
      .unique();
    const measured = (calib?.result?.multipliers ?? {}) as Record<
      string,
      Record<string, number>
    >;

    for (const w of watch) {
      if (w.muted) continue;
      const [metrics, stats, bands] = await Promise.all([
        ctx.db.query("metrics").withIndex("by_ticker", (i) => i.eq("ticker", w.ticker)).unique(),
        ctx.db.query("price_stats").withIndex("by_ticker", (i) => i.eq("ticker", w.ticker)).unique(),
        ctx.db.query("buy_bands").withIndex("by_ticker", (i) => i.eq("ticker", w.ticker)).unique(),
      ]);
      const score = await ctx.db
        .query("scores")
        .withIndex("by_ticker", (i) => i.eq("ticker", w.ticker))
        .order("desc")
        .first();

      // Readiness adjusts conviction, which can change the split between
      // qualifying names but never lets an unqualified one in. Signals compound,
      // but the combined tilt is capped so no stack of weak edges can dominate
      // the valuation work that actually drives the decision.
      const buckets = (stats?.signalBuckets ?? {}) as Record<string, string>;
      let tilt = 1;
      const drivers: { signal: string; bucket: string; multiplier: number }[] = [];
      for (const [signal, bucket] of Object.entries(buckets)) {
        const m = measured[signal]?.[bucket];
        if (m === undefined || m === 1) continue;
        tilt *= m;
        drivers.push({ signal, bucket, multiplier: m });
      }
      const dipAdjust = Math.max(0.7, Math.min(1.3, tilt));

      candidates.push({
        ticker: w.ticker,
        name: w.name,
        asymmetry: score?.asymmetry === undefined ? undefined : score.asymmetry * dipAdjust,
        composite: score?.composite,
        moatScore: metrics?.moatScore,
        upside: bands?.upside,
        confidence: bands?.confidence,
        verdict: score?.verdict,
        currentBand: bands?.currentBand,
        latestPeriodEnd: metrics?.latestPeriodEnd,
        dipState: stats?.dipState,
        dipScore: stats?.dipScore,
      });
    }

    const result = allocate(candidates);

    // Attach the readiness read to each slice so the widget can show why.
    const enriched = result.slices.map((s) => {
      const c = candidates.find((x) => x.ticker === s.ticker);
      return { ...s, dipState: c?.dipState, dipScore: c?.dipScore };
    });

    return { ...result, slices: enriched, evaluated: candidates.length };
  },
});

export const history = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit = 30 }) => {
    const rows = await ctx.db.query("allocations").withIndex("by_date").order("desc").take(limit);
    return rows;
  },
});

export const snapshotInputs = internalQuery({
  args: {},
  handler: async (ctx) => {
    const watch = await ctx.db.query("watchlist").collect();
    const out = [];
    for (const w of watch) {
      if (w.muted) continue;
      const [metrics, stats, bands] = await Promise.all([
        ctx.db.query("metrics").withIndex("by_ticker", (i) => i.eq("ticker", w.ticker)).unique(),
        ctx.db.query("price_stats").withIndex("by_ticker", (i) => i.eq("ticker", w.ticker)).unique(),
        ctx.db.query("buy_bands").withIndex("by_ticker", (i) => i.eq("ticker", w.ticker)).unique(),
      ]);
      const score = await ctx.db
        .query("scores")
        .withIndex("by_ticker", (i) => i.eq("ticker", w.ticker))
        .order("desc")
        .first();
      out.push({
        ticker: w.ticker,
        name: w.name,
        asymmetry: score?.asymmetry,
        composite: score?.composite,
        moatScore: metrics?.moatScore,
        upside: bands?.upside,
        confidence: bands?.confidence,
        verdict: score?.verdict,
        currentBand: bands?.currentBand,
        latestPeriodEnd: metrics?.latestPeriodEnd,
        dipState: stats?.dipState,
      });
    }
    return out;
  },
});

/** Records what was recommended, so the advice has an auditable history. */
export const snapshot = internalMutation({
  args: {
    slices: v.array(
      v.object({
        ticker: v.string(),
        name: v.optional(v.string()),
        weight: v.number(),
        conviction: v.number(),
        reason: v.string(),
      })
    ),
    cash: v.number(),
    headline: v.string(),
    rejected: v.array(v.object({ ticker: v.string(), reason: v.string() })),
  },
  handler: async (ctx, args) => {
    const date = new Date().toISOString().slice(0, 10);
    const existing = await ctx.db
      .query("allocations")
      .withIndex("by_date", (i) => i.eq("date", date))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, { ...args, createdAt: Date.now() });
      return;
    }
    await ctx.db.insert("allocations", { ...args, date, createdAt: Date.now() });
  },
});

export const latestSimulation = query({
  args: {},
  handler: async (ctx) => {
    const row = await ctx.db
      .query("simulations")
      .withIndex("by_key", (i) => i.eq("key", "dca"))
      .unique();
    return row ? { result: row.result, computedAt: row.computedAt } : null;
  },
});

export const storeSimulation = internalMutation({
  args: { result: v.any() },
  handler: async (ctx, { result }) => {
    const existing = await ctx.db
      .query("simulations")
      .withIndex("by_key", (i) => i.eq("key", "dca"))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, { result, computedAt: Date.now() });
      return;
    }
    await ctx.db.insert("simulations", { key: "dca", result, computedAt: Date.now() });
  },
});

export const storeCalibration = internalMutation({
  args: { result: v.any() },
  handler: async (ctx, { result }) => {
    const existing = await ctx.db
      .query("simulations")
      .withIndex("by_key", (i) => i.eq("key", "calibration"))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, { result, computedAt: Date.now() });
      return;
    }
    await ctx.db.insert("simulations", { key: "calibration", result, computedAt: Date.now() });
  },
});

export const calibration = query({
  args: {},
  handler: async (ctx) => {
    const row = await ctx.db
      .query("simulations")
      .withIndex("by_key", (i) => i.eq("key", "calibration"))
      .unique();
    return row ? { result: row.result, computedAt: row.computedAt } : null;
  },
});

export const simulationInputs = internalQuery({
  args: {},
  handler: async (ctx) => {
    const watch = await ctx.db.query("watchlist").collect();
    const out = [];
    for (const w of watch) {
      const bands = await ctx.db
        .query("buy_bands")
        .withIndex("by_ticker", (i) => i.eq("ticker", w.ticker))
        .unique();
      if (!bands?.fairValue || !bands.marginOfSafety) continue;
      out.push({
        ticker: w.ticker,
        fairValue: bands.fairValue,
        marginOfSafety: bands.marginOfSafety,
      });
    }
    return out;
  },
});
