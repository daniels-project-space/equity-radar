"use node";

import { v } from "convex/values";
import { action, internalAction, type ActionCtx } from "./_generated/server";
import { internal, api } from "./_generated/api";
import { simulate, type SimAsset } from "./lib/simulate";
import { allocate } from "./lib/allocator";
import { fetchCiksBySic } from "./lib/sec";
import { calibrate } from "./lib/calibrate";

/* ------------------------------------------------------------------ */
/* Rule simulation                                                     */
/* ------------------------------------------------------------------ */

async function runSimulation(ctx: ActionCtx) {
  // Every watchlist name with enough history — the simulation's reference is a
  // trailing average, so it needs no valuation input and carries no look-ahead.
  const watch = await ctx.runQuery(internal.data.watchlistTickers, {});
  const assets: SimAsset[] = [];
  for (const w of watch) {
    const bars = await ctx.runQuery(internal.data.fullBarsFor, { ticker: w.ticker, limit: 1300 });
    if (bars.length < 220) continue;
    assets.push({ ticker: w.ticker, bars });
  }
  const spy = await ctx.runQuery(internal.data.barsFor, { ticker: "SPY" });
  const result = simulate(assets, spy.map((b) => ({ date: b.date, c: b.c })), 104);
  if (result) await ctx.runMutation(internal.allocation.storeSimulation, { result });
  return result
    ? { ok: true, points: result.series.length, trades: result.tradeCount, ret: result.returnPct }
    : { ok: false, points: 0, trades: 0, ret: 0 };
}

export const runSim = action({
  args: {},
  handler: async (ctx) => runSimulation(ctx),
});

export const runSimCron = internalAction({
  args: {},
  handler: async (ctx) => runSimulation(ctx),
});

/** Persists today's recommendation so the advice itself has a history. */
export const snapshotAllocation = internalAction({
  args: {},
  handler: async (ctx): Promise<{ slices: number; cash: number }> => {
    const inputs = await ctx.runQuery(internal.allocation.snapshotInputs, {});
    const result = allocate(inputs);
    await ctx.runMutation(internal.allocation.snapshot, {
      slices: result.slices,
      cash: result.cash,
      headline: result.headline,
      rejected: result.rejected,
    });
    return { slices: result.slices.length, cash: result.cash };
  },
});

/* ------------------------------------------------------------------ */
/* Indicator calibration                                               */
/* ------------------------------------------------------------------ */

async function runCalibration(ctx: ActionCtx) {
  const watch = await ctx.runQuery(internal.data.watchlistTickers, {});
  const assets = [];
  for (const w of watch) {
    const bars = await ctx.runQuery(internal.data.fullBarsFor, { ticker: w.ticker, limit: 1300 });
    if (bars.length >= 160) assets.push({ ticker: w.ticker, bars });
  }
  const result = calibrate(assets);
  if (!result) return { ok: false, observations: 0 };

  await ctx.runMutation(internal.allocation.storeCalibration, { result });
  return {
    ok: true,
    observations: result.observations,
    signals: result.signals.length,
    inconclusive: result.inconclusive,
  };
}

export const runCalibration_ = action({
  args: {},
  handler: async (ctx) => runCalibration(ctx),
});

export const calibrateCron = internalAction({
  args: {},
  handler: async (ctx) => runCalibration(ctx),
});

/* ------------------------------------------------------------------ */
/* Peer discovery                                                      */
/* ------------------------------------------------------------------ */

/**
 * Finds real competitors instead of whatever happens to be on the watchlist.
 *
 * A peer has to be *scored* to be compared, and scoring means ingesting it —
 * so discovery works by picking same-industry companies from the full SEC
 * universe and light-ingesting a bounded number per run. Companies found this
 * way are marked `discovered` and never added to the watchlist; they exist to
 * make the comparison honest.
 */
export const discoverPeers = internalAction({
  args: { maxNew: v.optional(v.number()) },
  handler: async (
    ctx,
    { maxNew }
  ): Promise<{ considered: number; ingested: number; notes: string[] }> => {
    const runId = await ctx.runMutation(internal.data.startRun, { task: "discoverPeers" });
    const budget = maxNew ?? 3;
    const notes: string[] = [];
    let ingested = 0;

    const targets = await ctx.runQuery(internal.discovery.peerGaps, { limit: 6 });
    const deadline = Date.now() + 6 * 60_000;

    for (const t of targets) {
      if (ingested >= budget || Date.now() > deadline) break;
      let ciks: string[] = [];
      try {
        ciks = await fetchCiksBySic(t.sicCode, 100);
      } catch (e) {
        notes.push(`SIC ${t.sicCode}: ${String(e).slice(0, 80)}`);
        continue;
      }
      const candidates = await ctx.runQuery(internal.discovery.resolveCiks, {
        ciks,
        limit: 12,
      });
      for (const c of candidates) {
        if (ingested >= budget || Date.now() > deadline) break;
        try {
          await ctx.runAction(api.ingest.refreshTicker, { ticker: c.ticker, cik: c.cik });
          await ctx.runMutation(internal.discovery.markDiscovered, {
            ticker: c.ticker,
            forTicker: t.ticker,
          });
          ingested++;
        } catch (e) {
          notes.push(`${c.ticker}: ${String(e).slice(0, 90)}`);
        }
      }
    }

    await ctx.runMutation(internal.data.finishRun, {
      id: runId,
      ok: notes.length === 0,
      processed: ingested,
      error: notes.length ? notes.join(" | ").slice(0, 800) : undefined,
    });
    return { considered: targets.length, ingested, notes };
  },
});
