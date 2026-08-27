import { v } from "convex/values";
import { query, internalMutation, internalQuery } from "./_generated/server";

/**
 * Signal outcome tracking.
 *
 * Every fired alert is recorded with the price at the time, then scored at
 * 30/90/180 days against SPY. Raw return is not the measure — a signal that
 * returned +8% while the market returned +12% was a bad signal. Alpha is.
 */

export const record = internalMutation({
  args: {
    alertId: v.id("alerts"),
    ticker: v.string(),
    type: v.string(),
    severity: v.string(),
    firedAt: v.number(),
    priceAtSignal: v.number(),
    spyAtSignal: v.optional(v.number()),
    verdictAtSignal: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("signal_journal")
      .withIndex("by_alert", (i) => i.eq("alertId", args.alertId))
      .unique();
    if (existing) return;
    await ctx.db.insert("signal_journal", {
      ...args,
      firedDate: new Date(args.firedAt).toISOString().slice(0, 10),
      settled: false,
    });
  },
});

export const openEntries = internalQuery({
  args: {},
  handler: async (ctx) =>
    ctx.db
      .query("signal_journal")
      .withIndex("by_settled", (i) => i.eq("settled", false))
      .take(300),
});

export const applyOutcome = internalMutation({
  args: {
    id: v.id("signal_journal"),
    ret30d: v.optional(v.number()),
    ret90d: v.optional(v.number()),
    ret180d: v.optional(v.number()),
    alpha30d: v.optional(v.number()),
    alpha90d: v.optional(v.number()),
    alpha180d: v.optional(v.number()),
    settled: v.boolean(),
  },
  handler: async (ctx, { id, ...patch }) => {
    const clean = Object.fromEntries(Object.entries(patch).filter(([, x]) => x !== undefined));
    await ctx.db.patch(id, clean);
  },
});

type Row = {
  type: string;
  alpha30d?: number;
  alpha90d?: number;
  alpha180d?: number;
  ret30d?: number;
  ret90d?: number;
  ret180d?: number;
};

function summarize(rows: Row[], key: "alpha30d" | "alpha90d" | "alpha180d") {
  const vals = rows.map((r) => r[key]).filter((x): x is number => typeof x === "number");
  if (vals.length === 0) return null;
  const sorted = [...vals].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const wins = vals.filter((v) => v > 0).length;
  return {
    n: vals.length,
    medianAlpha: Math.round(median * 1000) / 10,
    hitRate: Math.round((wins / vals.length) * 100),
  };
}

/** Per-signal-type track record, for the journal page. */
export const stats = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("signal_journal").collect();
    const byType = new Map<string, Row[]>();
    for (const r of rows) {
      const list = byType.get(r.type) ?? [];
      list.push(r);
      byType.set(r.type, list);
    }

    const perType = [...byType.entries()]
      .map(([type, list]) => ({
        type,
        total: list.length,
        d30: summarize(list, "alpha30d"),
        d90: summarize(list, "alpha90d"),
        d180: summarize(list, "alpha180d"),
      }))
      .sort((a, b) => b.total - a.total);

    const scored = rows.filter((r) => typeof r.alpha30d === "number").length;
    return {
      totalSignals: rows.length,
      scoredSignals: scored,
      pendingSignals: rows.length - scored,
      perType,
      overall: summarize(rows, "alpha30d"),
    };
  },
});

/**
 * Median 30-day alpha per signal type, used to annotate live alerts with how
 * that signal has actually performed. Only surfaced once there are enough
 * observations to mean anything.
 */
export const trackRecordByType = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("signal_journal").collect();
    const byType = new Map<string, number[]>();
    for (const r of rows) {
      if (typeof r.alpha30d !== "number") continue;
      const list = byType.get(r.type) ?? [];
      list.push(r.alpha30d);
      byType.set(r.type, list);
    }
    const out: Record<string, { n: number; medianAlpha: number; hitRate: number }> = {};
    for (const [type, vals] of byType) {
      if (vals.length < 5) continue; // too few to report as a track record
      const sorted = [...vals].sort((a, b) => a - b);
      out[type] = {
        n: vals.length,
        medianAlpha: Math.round(sorted[Math.floor(sorted.length / 2)] * 1000) / 10,
        hitRate: Math.round((vals.filter((v) => v > 0).length / vals.length) * 100),
      };
    }
    return out;
  },
});

export const recent = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit = 60 }) => {
    const rows = await ctx.db.query("signal_journal").collect();
    return rows.sort((a, b) => b.firedAt - a.firedAt).slice(0, limit);
  },
});
