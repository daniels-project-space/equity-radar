"use node";

import { v } from "convex/values";
import { action, internalAction, type ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import webpush from "web-push";
import { fetchDailyBars } from "./lib/prices";

const BENCHMARK = "SPY";

function configureVapid(): boolean {
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) return false;
  // The subject must be a mailto: or https: URI per RFC 8292; push services
  // reject the request outright without it.
  webpush.setVapidDetails("https://equity-radar.vercel.app", pub, priv);
  return true;
}

async function pushAll(
  ctx: ActionCtx,
  payload: { title: string; body: string; url: string; tag: string }
): Promise<number> {
  const subs = await ctx.runQuery(internal.notify.listSubscriptions, {});
  let delivered = 0;
  for (const s of subs) {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify(payload)
      );
      await ctx.runMutation(internal.notify.recordSent, { endpoint: s.endpoint });
      delivered++;
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode;
      await ctx.runMutation(internal.notify.recordFailure, {
        endpoint: s.endpoint,
        gone: status === 404 || status === 410,
      });
    }
  }
  return delivered;
}

/** Fires for alerts that cleared the severity/type filters and were not yet sent. */
export const sendPending = internalAction({
  args: {},
  handler: async (ctx): Promise<{ sent: number; devices: number }> => {
    if (!configureVapid()) return { sent: 0, devices: 0 };
    const pending = await ctx.runQuery(internal.notify.pendingPushes, {});
    let sent = 0;
    let devices = 0;
    for (const a of pending) {
      const n = await pushAll(ctx, {
        title: a.title,
        body: a.detail.slice(0, 220),
        url: `/c/${a.ticker}`,
        tag: `alert-${a._id}`,
      });
      await ctx.runMutation(internal.notify.markPushed, { alertId: a._id, devices: n });
      devices += n;
      sent++;
    }
    return { sent, devices };
  },
});

/** Lets the settings panel prove delivery works before relying on it. */
export const sendTest = action({
  args: {},
  handler: async (ctx): Promise<{ delivered: number; configured: boolean }> => {
    const configured = configureVapid();
    if (!configured) return { delivered: 0, configured };
    const delivered = await pushAll(ctx, {
      title: "Equity Radar",
      body: "Push notifications are working.",
      url: "/",
      tag: "test",
    });
    return { delivered, configured };
  },
});

/* ------------------------------------------------------------------ */
/* Signal outcomes                                                     */
/* ------------------------------------------------------------------ */

export const refreshBenchmark = internalAction({
  args: {},
  handler: async (ctx): Promise<{ bars: number }> => {
    const bars = await fetchDailyBars(BENCHMARK);
    const recent = bars.slice(-1300);
    const known = await ctx.runQuery(internal.data.barDatesFor, { ticker: BENCHMARK });
    for (let i = 0; i < recent.length; i += 400) {
      await ctx.runMutation(internal.data.storeBars, {
        ticker: BENCHMARK,
        bars: recent.slice(i, i + 400),
        known,
      });
    }
    return { bars: recent.length };
  },
});

/**
 * Seeds journal entries for alerts that fired before the journal existed, using
 * the close on the day each one fired. Safe because it reads only prices from
 * the signal date itself — no look-ahead — and it lets the track record start
 * accumulating immediately instead of from the next alert onward.
 */
export const backfillJournal = internalAction({
  args: {},
  handler: async (ctx): Promise<{ created: number; skipped: number }> => {
    const alerts = await ctx.runQuery(internal.data.recentAlertsForJournal, {});
    const barCache = new Map<string, { date: string; c: number }[]>();
    const spy = await ctx.runQuery(internal.data.barsFor, { ticker: BENCHMARK });

    let created = 0;
    let skipped = 0;
    for (const a of alerts) {
      const date = new Date(a.firedAt).toISOString().slice(0, 10);
      if (!barCache.has(a.ticker)) {
        barCache.set(a.ticker, await ctx.runQuery(internal.data.barsFor, { ticker: a.ticker }));
      }
      const bars = barCache.get(a.ticker) ?? [];
      // Use the last close on or before the signal — the price actually known
      // at that moment, not a later one.
      let px: number | undefined;
      for (const b of bars) if (b.date <= date) px = b.c;
      let spyPx: number | undefined;
      for (const b of spy) if (b.date <= date) spyPx = b.c;

      if (px === undefined) {
        skipped++;
        continue;
      }
      await ctx.runMutation(internal.journal.record, {
        alertId: a._id,
        ticker: a.ticker,
        type: a.type,
        severity: a.severity,
        firedAt: a.firedAt,
        priceAtSignal: px,
        spyAtSignal: spyPx,
      });
      created++;
    }
    return { created, skipped };
  },
});

const addDays = (date: string, days: number) =>
  new Date(Date.parse(date) + days * 86_400_000).toISOString().slice(0, 10);

/** First close on or after a date — signal dates can fall on a closed market. */
function closeOnOrAfter(bars: { date: string; c: number }[], date: string): number | undefined {
  for (const b of bars) if (b.date >= date) return b.c;
  return undefined;
}

/**
 * Scores open journal entries whose windows have matured. Alpha, not raw
 * return: a signal that made 8% while SPY made 12% did not work.
 */
export const markOutcomes = internalAction({
  args: {},
  handler: async (ctx): Promise<{ scored: number; settled: number }> => {
    const runId = await ctx.runMutation(internal.data.startRun, { task: "markOutcomes" });
    const open = await ctx.runQuery(internal.journal.openEntries, {});
    if (open.length === 0) {
      await ctx.runMutation(internal.data.finishRun, { id: runId, ok: true, processed: 0 });
      return { scored: 0, settled: 0 };
    }

    const spy = await ctx.runQuery(internal.data.barsFor, { ticker: BENCHMARK });
    const barCache = new Map<string, { date: string; c: number }[]>();
    const today = new Date().toISOString().slice(0, 10);

    let scored = 0;
    let settled = 0;

    for (const entry of open) {
      if (!barCache.has(entry.ticker)) {
        barCache.set(entry.ticker, await ctx.runQuery(internal.data.barsFor, { ticker: entry.ticker }));
      }
      const bars = barCache.get(entry.ticker) ?? [];
      if (bars.length === 0) continue;

      const patch: {
        ret30d?: number;
        ret90d?: number;
        ret180d?: number;
        alpha30d?: number;
        alpha90d?: number;
        alpha180d?: number;
      } = {};
      let changed = false;

      for (const [days, retKey, alphaKey] of [
        [30, "ret30d", "alpha30d"],
        [90, "ret90d", "alpha90d"],
        [180, "ret180d", "alpha180d"],
      ] as const) {
        if (entry[retKey] !== undefined) continue;
        const target = addDays(entry.firedDate, days);
        if (target > today) continue; // window has not matured yet

        const px = closeOnOrAfter(bars, target);
        if (px === undefined || entry.priceAtSignal <= 0) continue;
        const ret = px / entry.priceAtSignal - 1;
        patch[retKey] = ret;

        const spyThen = entry.spyAtSignal;
        const spyNow = closeOnOrAfter(spy, target);
        if (spyThen && spyNow && spyThen > 0) {
          patch[alphaKey] = ret - (spyNow / spyThen - 1);
        }
        changed = true;
      }

      const isSettled = addDays(entry.firedDate, 180) <= today;
      if (isSettled) {
        settled++;
        changed = true;
      }

      if (changed) {
        await ctx.runMutation(internal.journal.applyOutcome, {
          id: entry._id,
          ...patch,
          settled: isSettled,
        });
        scored++;
      }
    }

    await ctx.runMutation(internal.data.finishRun, { id: runId, ok: true, processed: scored });
    return { scored, settled };
  },
});
