"use node";
// Convex rule: a "use node" module may only export actions. All mutations and
// queries used here live in convex/data.ts.

import { v } from "convex/values";
import { action, internalAction, type ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { fetchUniverse, fetchQuarters, fetchProfile, fetchRecentFilings } from "./lib/sec";
import { fetchDailyBars, fetchForwardEps } from "./lib/prices";
import { deriveMetrics, derivePriceStats } from "./lib/metrics";
import { score as computeScore, buildBands, median } from "./lib/scoring";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const fmt = (n?: number) => (typeof n === "number" ? `$${n.toFixed(2)}` : "n/a");
const pct = (n?: number) => (typeof n === "number" ? `${(n * 100).toFixed(1)}%` : "n/a");

export type RefreshResult = {
  ticker: string;
  composite: number;
  asymmetry: number;
  verdict: string;
  quarters: number;
  bars: number;
  fwdEps?: number;
  fwdEpsBasis?: "consensus" | "modelled";
  currentBand?: string;
  missingInputs: string[];
  alertsFired: string[];
  notes: string[];
};

/* ------------------------------------------------------------------ */
/* Universe                                                            */
/* ------------------------------------------------------------------ */

async function doRefreshUniverse(ctx: ActionCtx): Promise<{ total: number }> {
  const runId = await ctx.runMutation(internal.data.startRun, { task: "refreshUniverse" });
  try {
    const rows = await fetchUniverse();
    for (let i = 0; i < rows.length; i += 250) {
      await ctx.runMutation(internal.universe.bulkUpsert, { rows: rows.slice(i, i + 250) });
    }
    await ctx.runMutation(internal.data.finishRun, { id: runId, ok: true, processed: rows.length });
    return { total: rows.length };
  } catch (e) {
    await ctx.runMutation(internal.data.finishRun, { id: runId, ok: false, error: String(e) });
    throw e;
  }
}

export const refreshUniverse = action({
  args: {},
  handler: async (ctx): Promise<{ total: number }> => doRefreshUniverse(ctx),
});

/** Cron-callable twin — schedulers can only reference internal functions. */
export const refreshUniverseCron = internalAction({
  args: {},
  handler: async (ctx): Promise<{ total: number }> => doRefreshUniverse(ctx),
});

/* ------------------------------------------------------------------ */
/* Per-ticker refresh: prices -> fundamentals -> metrics -> score      */
/* ------------------------------------------------------------------ */

async function doRefreshTicker(
  ctx: ActionCtx,
  { ticker, cik, skipPrices }: { ticker: string; cik: string; skipPrices?: boolean }
): Promise<RefreshResult> {
  const t = ticker.toUpperCase();
  const notes: string[] = [];

  // ---- prices -------------------------------------------------------
  if (!skipPrices) {
    try {
      const bars = await fetchDailyBars(t);
      const recent = bars.slice(-1300);
      const known = await ctx.runQuery(internal.data.barDatesFor, { ticker: t });
      for (let i = 0; i < recent.length; i += 400) {
        await ctx.runMutation(internal.data.storeBars, {
          ticker: t,
          bars: recent.slice(i, i + 400),
          known,
        });
      }
    } catch (e) {
      notes.push(`prices: ${String(e)}`);
    }
  }

  const storedBars = await ctx.runQuery(internal.data.barsFor, { ticker: t });
  const stats = derivePriceStats(storedBars.map((b) => ({ date: b.date, c: b.c, v: b.v })));
  if (stats) await ctx.runMutation(internal.data.storePriceStats, { ticker: t, stats });

  // ---- profile ------------------------------------------------------
  try {
    const profile = await fetchProfile(cik);
    await ctx.runMutation(internal.data.setUniverseMeta, {
      ticker: t,
      sicCode: profile.sic,
      industry: profile.sicDescription,
    });
  } catch (e) {
    notes.push(`profile: ${String(e)}`);
  }

  // ---- fundamentals -------------------------------------------------
  try {
    const { quarters } = await fetchQuarters(cik, 12);
    if (quarters.length > 0) {
      await ctx.runMutation(internal.data.storeQuarters, {
        ticker: t,
        cik,
        quarters,
        sourceUrl: `https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`,
      });
    } else {
      notes.push("no XBRL quarters returned");
    }
  } catch (e) {
    notes.push(`xbrl: ${String(e)}`);
  }

  // ---- metrics ------------------------------------------------------
  const quarters = await ctx.runQuery(internal.data.quartersFor, { ticker: t });
  // Undefined unless a provider key is configured; deriveMetrics falls back to
  // its own modelled NTM figure so the app needs no API key at all.
  const consensusEps = await fetchForwardEps(t);
  const metrics = deriveMetrics(quarters, stats?.last, consensusEps);
  await ctx.runMutation(internal.data.storeMetrics, { ticker: t, metrics });
  if (metrics.marketCap) {
    await ctx.runMutation(internal.data.setUniverseMeta, { ticker: t, marketCap: metrics.marketCap });
  }

  // ---- peers --------------------------------------------------------
  let peerMedianFwdPe: number | undefined;
  let peerMedianEvToSales: number | undefined;
  let peerRet3m: number | undefined;
  let peerRevYoY: number | undefined;
  let peerCount = 0;
  const universeRow = await ctx.runQuery(internal.data.universeRow, { ticker: t });
  if (universeRow?.sicCode) {
    const peers = await ctx.runMutation(internal.data.rebuildSicPeers, {
      ticker: t,
      sicCode: universeRow.sicCode,
    });
    peerCount = peers.length;
    if (peers.length >= 3) {
      const peerMetrics = await ctx.runQuery(internal.data.metricsFor, { tickers: peers });
      const peerStats = await ctx.runQuery(internal.data.priceStatsFor, { tickers: peers });
      // A peer on depressed trailing earnings can show a 3000x P/E. Including
      // it says nothing about a fair multiple but drags the median far enough
      // to make every price look cheap, so the sample is trimmed first.
      peerMedianFwdPe = median(
        peerMetrics
          .map((m) => m.fwdPe ?? m.peTtm)
          .filter((x): x is number => typeof x === "number" && x >= 5 && x <= 60)
      );
      peerMedianEvToSales = median(
        peerMetrics
          .map((m) => m.evToSales)
          .filter((x): x is number => typeof x === "number" && x > 0 && x <= 30)
      );
      peerRevYoY = median(
        peerMetrics.map((m) => m.revYoY).filter((x): x is number => typeof x === "number")
      );
      peerRet3m = median(
        peerStats.map((s) => s.ret3m).filter((x): x is number => typeof x === "number")
      );
    } else {
      notes.push(`only ${peers.length} scored peers in SIC ${universeRow.sicCode} — peer medians omitted`);
    }
  }

  await ctx.runMutation(internal.data.storeMetrics, {
    ticker: t,
    metrics: { ...metrics, peerRet3m, peerRevYoY, peerCount },
  });

  // ---- score --------------------------------------------------------
  const prior = await ctx.runQuery(internal.data.priorScore, { ticker: t });
  const result = computeScore({
    revYoY: metrics.revYoY,
    revAccel: metrics.revAccel,
    epsYoY: metrics.epsYoY,
    grossMarginPct: metrics.grossMarginPct,
    grossMarginDeltaYoY: metrics.grossMarginDeltaYoY,
    opMarginPct: metrics.opMarginPct,
    fcfMarginPct: metrics.fcfMarginPct,
    rndIntensityPct: metrics.rndIntensityPct,
    sharesYoY: metrics.sharesYoY,
    fwdPe: metrics.fwdPe,
    peTtm: metrics.peTtm,
    evToSales: metrics.evToSales,
    netDebtToEbitda: metrics.netDebtToEbitda,
    isGaapLoss: metrics.isGaapLoss,
    netCash: metrics.netCash,
    ret3m: stats?.ret3m,
    ret12m: stats?.ret12m,
    drawdownFromHigh: stats?.drawdownFromHigh,
    peerMedianFwdPe,
    peerMedianEvToSales,
  });
  await ctx.runMutation(internal.data.storeScore, { ticker: t, score: result });

  // ---- buy bands ----------------------------------------------------
  // Per-ticker preset wins over the global one; "fixed" pins the anchor
  // multiple instead of tracking the peer median.
  const bandSettings = await ctx.runQuery(internal.settings.effectiveBands, { ticker: t });
  const bands = buildBands({
    price: stats?.last,
    fwdEps: metrics.fwdEps,
    fwdEpsBasis: metrics.fwdEpsBasis,
    ttmEps: metrics.epsTtm,
    revenueTtm: metrics.revenueTtm,
    netCash: metrics.netCash,
    sharesDiluted: quarters[0]?.sharesDiluted,
    peerMedianFwdPe,
    peerMedianEvToSales,
    targetMultipleOverride:
      bandSettings.mode === "fixed" ? bandSettings.fixedMultiple : undefined,
  });
  if (bands) await ctx.runMutation(internal.data.storeBands, { ticker: t, bands });

  // ---- evaluation + alerts ------------------------------------------
  await ctx.runMutation(internal.data.storeEvaluation, {
    ticker: t,
    composite: result.composite,
    asymmetry: result.asymmetry,
    verdict: result.verdict,
    changesSincePrior: diffScores(prior, result),
  });

  const alertsFired = await evaluateAlerts(
    ctx,
    t,
    { ...metrics, peerRet3m, peerRevYoY, peerCount },
    stats,
    result,
    bands,
    prior
  );

  return {
    ticker: t,
    composite: result.composite,
    asymmetry: result.asymmetry,
    verdict: result.verdict,
    quarters: quarters.length,
    bars: storedBars.length,
    fwdEps: metrics.fwdEps,
    fwdEpsBasis: metrics.fwdEpsBasis,
    currentBand: bands?.currentBand,
    missingInputs: result.missingInputs,
    alertsFired,
    notes,
  };
}

export const refreshTicker = action({
  args: { ticker: v.string(), cik: v.string(), skipPrices: v.optional(v.boolean()) },
  handler: async (ctx, args): Promise<RefreshResult> => doRefreshTicker(ctx, args),
});

function diffScores(
  prior: { verdict: string; [k: string]: unknown } | null,
  next: Record<string, unknown> & { verdict: string }
): string[] {
  if (!prior) return ["First evaluation."];
  const out: string[] = [];
  if (prior.verdict !== next.verdict) out.push(`Verdict ${prior.verdict} -> ${next.verdict}`);
  for (const k of ["composite", "asymmetry", "growth", "quality", "valuation", "risk"]) {
    const a = prior[k];
    const b = next[k];
    if (typeof a !== "number" || typeof b !== "number") continue;
    const delta = Math.round((b - a) * 10) / 10;
    if (Math.abs(delta) >= 3) out.push(`${k} ${delta > 0 ? "+" : ""}${delta}`);
  }
  return out.length ? out : ["No material change."];
}

async function evaluateAlerts(
  ctx: ActionCtx,
  ticker: string,
  m: ReturnType<typeof deriveMetrics> & {
    peerRet3m?: number;
    peerRevYoY?: number;
    peerCount?: number;
  },
  stats: ReturnType<typeof derivePriceStats>,
  s: ReturnType<typeof computeScore>,
  bands: ReturnType<typeof buildBands>,
  prior: { verdict: string; asymmetry: number; composite: number } | null
): Promise<string[]> {
  const fired: string[] = [];
  const fire = async (
    type: string,
    severity: "critical" | "high" | "medium",
    title: string,
    detail: string,
    reArmDays: number,
    payload?: unknown
  ) => {
    const r = await ctx.runMutation(internal.data.fireAlert, {
      ticker,
      type,
      severity,
      title,
      detail,
      payload,
      reArmDays,
    });
    if (r.fired) fired.push(type);
  };

  const band = bands?.bands.find((b) => b.label === bands.currentBand);
  if (band && (band.action === "BUY" || band.action === "BUY_AGGRESSIVE")) {
    await fire(
      "BUY_ZONE_ENTERED",
      "high",
      `${ticker} in "${band.label}" zone`,
      `Price ${fmt(stats?.last)} sits in ${fmt(band.priceLo)}–${fmt(band.priceHi)} ` +
        `(${band.multipleLo}x–${band.multipleHi}x on ${bands?.basis}).`,
      14,
      band
    );
  }

  // The setup that mattered most in the reference analysis: the business is
  // getting better while the price is getting worse.
  if (
    m.revAccel !== undefined &&
    m.revAccel > 0 &&
    m.revYoY !== undefined &&
    m.revYoY > 0.1 &&
    stats &&
    stats.drawdownFromHigh > 0.25
  ) {
    await fire(
      "FUNDAMENTALS_UP_PRICE_DOWN",
      "high",
      `${ticker}: fundamentals accelerating into a drawdown`,
      `Revenue +${pct(m.revYoY)} YoY and accelerating ${m.revAccel.toFixed(1)}pp, while the stock is ` +
        `${pct(stats.drawdownFromHigh)} off its 52-week high.`,
      21
    );
  }

  if (m.grossMarginDeltaYoY !== undefined && m.grossMarginDeltaYoY < -150) {
    await fire(
      "MARGIN_COMPRESSION",
      "high",
      `${ticker}: gross margin compressing`,
      `Gross margin down ${Math.abs(Math.round(m.grossMarginDeltaYoY))}bps YoY to ${pct(m.grossMarginPct)}.`,
      30
    );
  }

  if (m.sharesYoY !== undefined && m.sharesYoY > 0.08) {
    await fire(
      "DILUTION_SPIKE",
      "high",
      `${ticker}: material dilution`,
      `Diluted share count +${pct(m.sharesYoY)} YoY — per-share growth is partly funded by issuance.`,
      60
    );
  }

  if (m.revAccel !== undefined && m.revAccel < -8) {
    await fire(
      "GROWTH_DECEL",
      "critical",
      `${ticker}: growth decelerating`,
      `Revenue YoY fell ${Math.abs(m.revAccel).toFixed(1)}pp versus the prior quarter's YoY rate.`,
      30
    );
  }

  if (s.asymmetry < 30 && s.composite > 55) {
    await fire(
      "VALUATION_STRETCHED",
      "medium",
      `${ticker}: good business, stretched entry`,
      `Composite ${s.composite} but asymmetry only ${s.asymmetry} (crowdedness ${s.crowdedness}). ` +
        `Trim rather than add.`,
      30
    );
  }

  // Moat direction — the thing that decides whether a thesis survives years,
  // not quarters. Fires on a clear move, not on noise.
  if (m.moatTrend !== undefined && m.moatTrend <= -25) {
    const worst = (m.moatDrivers ?? [])
      .filter((d) => (d.label === "Share count" ? d.delta > 0 : d.delta < 0))
      .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))[0];
    await fire(
      "MOAT_WEAKENING",
      "high",
      `${ticker}: moat trending down`,
      `Moat direction ${m.moatTrend}/100` +
        (worst ? ` — led by ${worst.label.toLowerCase()} ${worst.delta > 0 ? "+" : ""}${worst.delta}${worst.unit}.` : "."),
      45
    );
  }
  if (m.moatTrend !== undefined && m.moatTrend >= 35) {
    await fire(
      "MOAT_STRENGTHENING",
      "medium",
      `${ticker}: moat trending up`,
      `Moat direction +${m.moatTrend}/100 — margins and cash conversion improving year over year.`,
      45
    );
  }

  // Peer-relative: the same drawdown means different things depending on
  // whether the whole group moved or just this name.
  if (m.peerRet3m !== undefined && stats?.ret3m !== undefined) {
    const gap = stats.ret3m - m.peerRet3m;
    if (gap <= -0.15) {
      await fire(
        "PEER_LAGGING",
        "high",
        `${ticker}: lagging its peer group`,
        `Down ${pct(stats.ret3m)} over 3 months against a peer median of ${pct(m.peerRet3m)} ` +
          `(${m.peerCount} peers). Company-specific, not sector-wide.`,
        21
      );
    } else if (gap >= 0.25) {
      await fire(
        "PEER_LEADING",
        "medium",
        `${ticker}: re-rating ahead of peers`,
        `Up ${pct(stats.ret3m)} over 3 months against a peer median of ${pct(m.peerRet3m)}. ` +
          `Some of the thesis is now priced in.`,
        21
      );
    }
  }

  // Explicit exit prompt, distinct from "expensive": the price has left the
  // top of the band table entirely.
  const topBand = bands?.bands[bands.bands.length - 1];
  if (topBand && stats?.last !== undefined && stats.last > topBand.priceHi) {
    await fire(
      "OVERVALUED_EXIT",
      "high",
      `${ticker}: above the band table`,
      `Price ${fmt(stats.last)} is above ${fmt(topBand.priceHi)}, the top of the ` +
        `${bands?.targetMultiple}x anchor. Nothing in the current numbers supports this level.`,
      30
    );
  }

  if (prior && prior.verdict !== s.verdict) {
    await fire(
      "VERDICT_CHANGE",
      "medium",
      `${ticker}: ${prior.verdict} -> ${s.verdict}`,
      `Asymmetry ${prior.asymmetry} -> ${s.asymmetry}, composite ${prior.composite} -> ${s.composite}.`,
      3
    );
  }

  return fired;
}

/* ------------------------------------------------------------------ */
/* Scheduled sweeps                                                    */
/* ------------------------------------------------------------------ */

export const refreshWatchlist = internalAction({
  args: { skipPrices: v.optional(v.boolean()) },
  handler: async (ctx, { skipPrices }): Promise<{ processed: number; failed: string[] }> => {
    const runId = await ctx.runMutation(internal.data.startRun, { task: "refreshWatchlist" });
    const rows = await ctx.runQuery(internal.data.watchlistTickers, {});
    const failed: string[] = [];
    let processed = 0;
    for (const row of rows) {
      try {
        await doRefreshTicker(ctx, { ticker: row.ticker, cik: row.cik, skipPrices });
        processed++;
      } catch (e) {
        failed.push(`${row.ticker}: ${String(e)}`);
      }
      await sleep(400); // stay well inside SEC fair-access limits
    }
    await ctx.runMutation(internal.data.finishRun, {
      id: runId,
      ok: failed.length === 0,
      processed,
      error: failed.length ? failed.join(" | ").slice(0, 1000) : undefined,
    });
    return { processed, failed };
  },
});

/** A fresh 10-K/10-Q means the thesis inputs just changed — re-evaluate now. */
export const pollFilings = internalAction({
  args: {},
  handler: async (ctx): Promise<{ checked: number; fresh: number }> => {
    const rows = await ctx.runQuery(internal.data.watchlistTickers, {});
    let fresh = 0;
    for (const row of rows) {
      try {
        // Foreign private issuers report on 20-F/6-K, not 10-K/10-Q. Omitting
        // them means those names never re-evaluate on results.
        const filings = await fetchRecentFilings(row.cik, ["10-K", "10-Q", "20-F", "6-K", "40-F"]);
        const newest = filings[0];
        if (newest && (Date.now() - Date.parse(newest.filedAt)) / 86_400_000 <= 2) {
          fresh++;
          await doRefreshTicker(ctx, { ticker: row.ticker, cik: row.cik });
        }
      } catch {
        // one ticker's feed failing must not stop the sweep
      }
      await sleep(400);
    }
    return { checked: rows.length, fresh };
  },
});
