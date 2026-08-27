import { v } from "convex/values";
import { query, mutation, internalQuery } from "./_generated/server";

export type BandSettings = { mode: "peerMedian" | "fixed"; fixedMultiple?: number };
export type NotifySettings = {
  enabled: boolean;
  minSeverity: "critical" | "high" | "medium";
  mutedTypes: string[];
};

export const DEFAULT_BANDS: BandSettings = { mode: "peerMedian" };
export const DEFAULT_NOTIFY: NotifySettings = {
  enabled: true,
  minSeverity: "medium",
  mutedTypes: [],
};

const bandsValidator = v.object({
  mode: v.union(v.literal("peerMedian"), v.literal("fixed")),
  fixedMultiple: v.optional(v.number()),
});

const notifyValidator = v.object({
  enabled: v.boolean(),
  minSeverity: v.union(v.literal("critical"), v.literal("high"), v.literal("medium")),
  mutedTypes: v.array(v.string()),
});

async function readScope(ctx: { db: any }, scope: string) {
  return ctx.db
    .query("settings")
    .withIndex("by_scope", (i: any) => i.eq("scope", scope))
    .unique();
}

/** Global defaults plus every per-ticker override, for the settings panel. */
export const all = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("settings").collect();
    const global = rows.find((r) => r.scope === "global");
    return {
      global: {
        bands: global?.bands ?? DEFAULT_BANDS,
        notify: global?.notify ?? DEFAULT_NOTIFY,
      },
      overrides: rows
        .filter((r) => r.scope.startsWith("ticker:"))
        .map((r) => ({ ticker: r.scope.slice(7), bands: r.bands })),
    };
  },
});

/** Effective band settings for one ticker: ticker override wins over global. */
export const effectiveBands = internalQuery({
  args: { ticker: v.string() },
  handler: async (ctx, { ticker }): Promise<BandSettings> => {
    const own = await readScope(ctx, `ticker:${ticker}`);
    if (own?.bands) return own.bands;
    const global = await readScope(ctx, "global");
    return global?.bands ?? DEFAULT_BANDS;
  },
});

export const setGlobalBands = mutation({
  args: { bands: bandsValidator },
  handler: async (ctx, { bands }) => {
    const row = await readScope(ctx, "global");
    if (row) await ctx.db.patch(row._id, { bands, updatedAt: Date.now() });
    else await ctx.db.insert("settings", { scope: "global", bands, updatedAt: Date.now() });
  },
});

export const setGlobalNotify = mutation({
  args: { notify: notifyValidator },
  handler: async (ctx, { notify }) => {
    const row = await readScope(ctx, "global");
    if (row) await ctx.db.patch(row._id, { notify, updatedAt: Date.now() });
    else await ctx.db.insert("settings", { scope: "global", notify, updatedAt: Date.now() });
  },
});

/** Passing bands: null clears the override and falls back to global. */
export const setTickerBands = mutation({
  args: { ticker: v.string(), bands: v.union(bandsValidator, v.null()) },
  handler: async (ctx, { ticker, bands }) => {
    const scope = `ticker:${ticker.toUpperCase()}`;
    const row = await readScope(ctx, scope);
    if (bands === null) {
      if (row) await ctx.db.delete(row._id);
      return;
    }
    if (row) await ctx.db.patch(row._id, { bands, updatedAt: Date.now() });
    else await ctx.db.insert("settings", { scope, bands, updatedAt: Date.now() });
  },
});
