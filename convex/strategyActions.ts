"use node";

import { v } from "convex/values";
import { action, internalAction, type ActionCtx } from "./_generated/server";
import { internal, api } from "./_generated/api";
import { simulate, type SimAsset } from "./lib/simulate";
import { allocate } from "./lib/allocator";
import { fetchCiksBySic } from "./lib/sec";
import { calibrate } from "./lib/calibrate";
import { backtest, buildCtx, combinations, type RuleResult } from "./lib/rules";
import { runTournament } from "./lib/tournament";
import { analyseSensitivity } from "./lib/sensitivity";

/* ------------------------------------------------------------------ */
/* Rule simulation                                                     */
/* ------------------------------------------------------------------ */

async function runSimulation(ctx: ActionCtx) {
  // Every watchlist name with enough history — the simulation's reference is a
  // trailing average, so it needs no valuation input and carries no look-ahead.
  const watchAll = await ctx.runQuery(internal.data.watchlistTickers, {});
  // Equity-only. Crypto bars in an equity calibration would mix two return
  // distributions that have nothing to do with each other.
  const watch = watchAll.filter((w) => w.assetType !== "crypto");
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
      deploymentRate: result.deploymentRate,
      regime: result.regime,
    });
    return { slices: result.slices.length, cash: result.cash };
  },
});

/* ------------------------------------------------------------------ */
/* Indicator calibration                                               */
/* ------------------------------------------------------------------ */

async function runCalibration(ctx: ActionCtx) {
  const watchAll = await ctx.runQuery(internal.data.watchlistTickers, {});
  // Equity-only. Crypto bars in an equity calibration would mix two return
  // distributions that have nothing to do with each other.
  const watch = watchAll.filter((w) => w.assetType !== "crypto");
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

/* ------------------------------------------------------------------ */
/* Entry-rule search                                                   */
/* ------------------------------------------------------------------ */

/**
 * Searches condition combinations for a better entry rule on one name.
 *
 * The honest part is the split. Rules are ranked on the first 65% of history
 * and then re-run, untouched, on the last 35% that played no part in choosing
 * them. Searching ~130 combinations on a single price series will always
 * produce something that looks excellent in-sample; the only question worth
 * reporting is whether the winner still works on data it did not get to see.
 */
export const searchRules = action({
  args: { ticker: v.string(), maxSize: v.optional(v.number()) },
  handler: async (
    ctx,
    { ticker, maxSize }
  ): Promise<{
    ticker: string;
    bars: number;
    tested: number;
    splitDate: string;
    inSample: RuleResult[];
    outOfSample: (RuleResult & { inSampleRank: number })[];
    baseline: { inSample: RuleResult | null; outOfSample: RuleResult | null };
  }> => {
    const bars = await ctx.runQuery(internal.data.fullBarsFor, { ticker, limit: 5000 });
    if (bars.length < 600) throw new Error(`${ticker}: only ${bars.length} bars, need 600+`);

    const split = Math.floor(bars.length * 0.65);
    const early = bars.slice(0, split);
    const late = bars.slice(Math.max(0, split - 210)); // 210 bars of warm-up for the 200 EMA

    const ctxEarly = buildCtx(early);
    const ctxLate = buildCtx(late);

    const combos = combinations(maxSize ?? 3);
    const scored = combos
      .map((keys) => backtest(early, ctxEarly, keys))
      .filter((r): r is RuleResult => r !== null && r.trades >= 3)
      .sort((a, b) => b.edgePct - a.edgePct);

    const top = scored.slice(0, 8);
    const outOfSample = top
      .map((r, idx) => {
        const oos = backtest(late, ctxLate, r.keys, { start: 210 });
        return oos ? { ...oos, inSampleRank: idx + 1 } : null;
      })
      .filter((r): r is RuleResult & { inSampleRank: number } => r !== null);

    // The rule the question started from, as the thing to beat.
    const baseline = {
      inSample: backtest(early, ctxEarly, ["trendUp"]),
      outOfSample: backtest(late, ctxLate, ["trendUp"], { start: 210 }),
    };

    return {
      ticker,
      bars: bars.length,
      tested: scored.length,
      splitDate: bars[split]?.date ?? "",
      inSample: top,
      outOfSample,
      baseline,
    };
  },
});

/**
 * The same search across every tracked name.
 *
 * One stock cannot settle this. A rule chosen on a single price series is
 * chosen partly on that series' accidents, and Netflix in particular spans one
 * long advance and one drawdown — which is exactly the shape that makes an
 * exposure-reducing rule look brilliant or terrible depending on where the
 * window is cut. Aggregating across names, and reporting in- and out-of-sample
 * separately, is the difference between a finding and a story.
 */
export const searchRulesAll = action({
  args: { maxSize: v.optional(v.number()) },
  handler: async (
    ctx,
    { maxSize }
  ): Promise<{
    names: number;
    rules: {
      keys: string[];
      label: string;
      names: number;
      medianEdgeIn: number;
      medianEdgeOut: number;
      winsIn: number;
      winsOut: number;
      medianExposure: number;
      consistent: boolean;
    }[];
  }> => {
    const watchAll = await ctx.runQuery(internal.data.watchlistTickers, {});
  // Equity-only. Crypto bars in an equity calibration would mix two return
  // distributions that have nothing to do with each other.
  const watch = watchAll.filter((w) => w.assetType !== "crypto");
    const combos = combinations(maxSize ?? 2);
    const acc = new Map<string, { label: string; ins: number[]; outs: number[]; expo: number[] }>();
    let names = 0;

    for (const w of watch) {
      const bars = await ctx.runQuery(internal.data.fullBarsFor, { ticker: w.ticker, limit: 5000 });
      if (bars.length < 600) continue;
      names++;
      const split = Math.floor(bars.length * 0.65);
      const early = bars.slice(0, split);
      const late = bars.slice(Math.max(0, split - 210));
      const ce = buildCtx(early);
      const cl = buildCtx(late);

      for (const keys of combos) {
        const a = backtest(early, ce, keys);
        const b = backtest(late, cl, keys, { start: 210 });
        if (!a || !b || a.trades < 2) continue;
        const k = keys.join("+");
        if (!acc.has(k)) acc.set(k, { label: a.label, ins: [], outs: [], expo: [] });
        const e = acc.get(k)!;
        e.ins.push(a.edgePct);
        e.outs.push(b.edgePct);
        e.expo.push(b.exposure);
      }
    }

    const med = (xs: number[]) => {
      if (!xs.length) return 0;
      const s = [...xs].sort((x, y) => x - y);
      return Math.round(s[Math.floor(s.length / 2)] * 10) / 10;
    };
    const share = (xs: number[]) =>
      xs.length ? Math.round((xs.filter((x) => x > 0).length / xs.length) * 100) : 0;

    const rules = [...acc.entries()]
      .map(([k, e]) => {
        const medianEdgeIn = med(e.ins);
        const medianEdgeOut = med(e.outs);
        return {
          keys: k.split("+"),
          label: e.label,
          names: e.ins.length,
          medianEdgeIn,
          medianEdgeOut,
          winsIn: share(e.ins),
          winsOut: share(e.outs),
          medianExposure: med(e.expo),
          // The only bar worth clearing: helps in both halves, on most names.
          consistent: medianEdgeIn > 0 && medianEdgeOut > 0 && share(e.ins) >= 60 && share(e.outs) >= 60,
        };
      })
      .sort((a, b) => b.medianEdgeOut - a.medianEdgeOut);

    return { names, rules };
  },
});

/* ------------------------------------------------------------------ */
/* Signal tournament                                                   */
/* ------------------------------------------------------------------ */

async function tournament(ctx: ActionCtx, folds: number) {
  const watchAll = await ctx.runQuery(internal.data.watchlistTickers, {});
  // Equity-only. Crypto bars in an equity calibration would mix two return
  // distributions that have nothing to do with each other.
  const watch = watchAll.filter((w) => w.assetType !== "crypto");
  const assets = [];
  for (const w of watch) {
    const bars = await ctx.runQuery(internal.data.fullBarsFor, { ticker: w.ticker, limit: 5000 });
    if (bars.length >= 700) assets.push({ ticker: w.ticker, bars });
  }
  const result = runTournament(assets, { folds });
  if (!result) return { ok: false, reason: "not enough history" };
  await ctx.runMutation(internal.allocation.storeTournament, { result });
  return {
    ok: true,
    names: result.names,
    tests: result.totalTests,
    champion: result.champion?.label ?? null,
    verdict: result.verdict,
  };
}

export const runSignalTournament = action({
  args: { folds: v.optional(v.number()) },
  handler: async (ctx, { folds }) => tournament(ctx, folds ?? 4),
});

export const tournamentCron = internalAction({
  args: {},
  handler: async (ctx) => tournament(ctx, 4),
});

/**
 * Ranks the hand-chosen constants by how much they actually move the answer.
 *
 * Runs on stored valuations rather than re-deriving them, so it measures the
 * model as it currently stands rather than a re-implementation of it.
 */
export const auditSensitivity = action({
  args: {},
  handler: async (ctx): Promise<any> => {
    const rows = await ctx.runQuery(internal.data.valuationSamples, {});
    const result = analyseSensitivity(rows);
    if (!result) return { ok: false, reason: "not enough scored names" };
    await ctx.runMutation(internal.allocation.storeSensitivity, { result });
    return { ok: true, names: result.names, summary: result.summary };
  },
});
