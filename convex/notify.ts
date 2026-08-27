import { v } from "convex/values";
import { query, mutation, internalMutation, internalQuery } from "./_generated/server";

/**
 * Native Web Push subscriptions.
 *
 * No third-party push provider: the browser hands us its own push-service
 * endpoint, we encrypt to it with our VAPID keypair. That means notifications
 * arrive at the OS level on desktop and on Android, and on iOS once the app is
 * added to the home screen.
 */

export const publicKey = query({
  args: {},
  handler: async () => ({ key: process.env.VAPID_PUBLIC_KEY ?? null }),
});

export const subscribe = mutation({
  args: {
    endpoint: v.string(),
    p256dh: v.string(),
    auth: v.string(),
    label: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("push_subscriptions")
      .withIndex("by_endpoint", (i) => i.eq("endpoint", args.endpoint))
      .unique();
    if (existing) {
      // Re-subscribing resets the failure count — the browser may have rotated
      // its keys, which is a fresh start rather than a continuing failure.
      await ctx.db.patch(existing._id, { ...args, failureCount: 0 });
      return { created: false };
    }
    await ctx.db.insert("push_subscriptions", { ...args, createdAt: Date.now(), failureCount: 0 });
    return { created: true };
  },
});

export const unsubscribe = mutation({
  args: { endpoint: v.string() },
  handler: async (ctx, { endpoint }) => {
    const row = await ctx.db
      .query("push_subscriptions")
      .withIndex("by_endpoint", (i) => i.eq("endpoint", endpoint))
      .unique();
    if (row) await ctx.db.delete(row._id);
  },
});

export const deviceCount = query({
  args: {},
  handler: async (ctx) => (await ctx.db.query("push_subscriptions").collect()).length,
});

export const listSubscriptions = internalQuery({
  args: {},
  handler: async (ctx) => ctx.db.query("push_subscriptions").collect(),
});

export const recordFailure = internalMutation({
  args: { endpoint: v.string(), gone: v.boolean() },
  handler: async (ctx, { endpoint, gone }) => {
    const row = await ctx.db
      .query("push_subscriptions")
      .withIndex("by_endpoint", (i) => i.eq("endpoint", endpoint))
      .unique();
    if (!row) return;
    // 404/410 means the browser dropped the subscription for good — delete it
    // rather than retrying forever against a dead endpoint.
    if (gone || row.failureCount >= 4) {
      await ctx.db.delete(row._id);
      return;
    }
    await ctx.db.patch(row._id, { failureCount: row.failureCount + 1 });
  },
});

export const recordSent = internalMutation({
  args: { endpoint: v.string() },
  handler: async (ctx, { endpoint }) => {
    const row = await ctx.db
      .query("push_subscriptions")
      .withIndex("by_endpoint", (i) => i.eq("endpoint", endpoint))
      .unique();
    if (row) await ctx.db.patch(row._id, { lastSentAt: Date.now(), failureCount: 0 });
  },
});

/**
 * Alerts that deserve a push and have not had one. Respects the same
 * notification preferences as the in-app bell, so muting a type silences the
 * phone too.
 */
export const pendingPushes = internalQuery({
  args: {},
  handler: async (ctx) => {
    const settings = await ctx.db
      .query("settings")
      .withIndex("by_scope", (i) => i.eq("scope", "global"))
      .unique();
    const notify = settings?.notify;
    if (notify && !notify.enabled) return [];

    const minRank = { medium: 1, high: 2, critical: 3 }[notify?.minSeverity ?? "high"] ?? 2;
    const rank = { medium: 1, high: 2, critical: 3 };

    const recent = await ctx.db.query("alerts").withIndex("by_firedAt").order("desc").take(60);
    const out = [];
    for (const a of recent) {
      if (a.acknowledgedAt) continue;
      if (rank[a.severity] < minRank) continue;
      if (notify?.mutedTypes.includes(a.type)) continue;
      // Only alerts from the last day — a backlog should not arrive as a burst
      // of stale notifications after a quiet period.
      if (Date.now() - a.firedAt > 36 * 3600_000) continue;
      const logged = await ctx.db
        .query("push_log")
        .withIndex("by_alert", (i) => i.eq("alertId", a._id))
        .unique();
      if (logged) continue;
      out.push(a);
      if (out.length >= 8) break;
    }
    return out;
  },
});

export const markPushed = internalMutation({
  args: { alertId: v.id("alerts"), devices: v.number() },
  handler: async (ctx, { alertId, devices }) => {
    await ctx.db.insert("push_log", { alertId, sentAt: Date.now(), devices });
  },
});
