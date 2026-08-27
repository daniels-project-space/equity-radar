import { v } from "convex/values";
import { query, mutation } from "./_generated/server";

export const recent = query({
  args: { limit: v.optional(v.number()), unacknowledgedOnly: v.optional(v.boolean()) },
  handler: async (ctx, { limit = 50, unacknowledgedOnly }) => {
    const rows = await ctx.db.query("alerts").withIndex("by_firedAt").order("desc").take(200);
    const filtered = unacknowledgedOnly ? rows.filter((r) => !r.acknowledgedAt) : rows;
    return filtered.slice(0, limit);
  },
});

export const acknowledge = mutation({
  args: { id: v.id("alerts") },
  handler: async (ctx, { id }) => ctx.db.patch(id, { acknowledgedAt: Date.now() }),
});

export const acknowledgeAll = mutation({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("alerts").withIndex("by_firedAt").order("desc").take(200);
    let n = 0;
    for (const r of rows) {
      if (!r.acknowledgedAt) {
        await ctx.db.patch(r._id, { acknowledgedAt: Date.now() });
        n++;
      }
    }
    return n;
  },
});

/** Operational health — surfaced in the UI so a silent cron failure is visible. */
export const lastRuns = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("runs").order("desc").take(15);
    return rows;
  },
});
