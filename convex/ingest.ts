"use node";
// Convex rule: a "use node" module may only export actions. All mutations and
// queries used here live in convex/data.ts.

import { v } from "convex/values";
import { action, internalAction, type ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { fetchUniverse, fetchQuarters, fetchProfile, fetchRecentFilings, fetchEarnings8Ks } from "./lib/sec";
import { findEarningsRelease, extractFromRelease } from "./lib/earningsRelease";
import { fetchDailyBars, fetchForwardEps, fetchQuote } from "./lib/prices";
import { deriveMetrics, derivePriceStats } from "./lib/metrics";
import { score as computeScore } from "./lib/scoring";
import { valuate, median, classifyArchetype } from "./lib/valuation";
import { assessMoat } from "./lib/moat";
import { detectDip } from "./lib/dip";
import { featuresAt } from "./lib/signals";
import { readExpectations } from "./lib/expectations";
import { readTrajectory } from "./lib/trajectory";

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
  fwdEpsBasis?: "consensus" | "guided" | "modelled";
  currentBand?: string;
  archetype?: string;
  fairValue?: number;
  upside?: number;
  confidence?: string;
  moatScore?: number;
  moatDirection?: number;
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
  const ohlcv = await ctx.runQuery(internal.data.fullBarsFor, { ticker: t });
  const dip = detectDip(ohlcv);
  const stats = derivePriceStats(storedBars.map((b) => ({ date: b.date, c: b.c, v: b.v })));
  if (stats) {
    // The same causal features the calibration measures, read at today's bar.
    // Storing them here is what lets the allocator apply measured weights
    // instead of the dip state alone.
    const buckets: Record<string, string> = {};
    for (const f of featuresAt(ohlcv)) buckets[f.signal] = f.bucket;

    await ctx.runMutation(internal.data.storePriceStats, {
      ticker: t,
      stats: {
        ...stats,
        dipState: dip.state,
        dipScore: dip.score,
        dipDrawdown: dip.drawdown,
        dipEvidence: dip.evidence,
        upDownVolume: dip.upDownVolume,
        sellingPressure: dip.sellingPressure,
        signalBuckets: buckets,
      },
    });
  }

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
  // ---- guidance ------------------------------------------------------
  // Management's own outlook is the only forward-looking input that is not a
  // model or a consensus estimate. The useful signal is not the guide itself
  // but whether it implies acceleration or deceleration against the growth
  // just reported.
  const guides = await ctx.runQuery(internal.data.guidanceFor, { ticker: t });
  const latestGuide = guides[0];

  const guidedEpsMid =
    latestGuide && latestGuide.epsLow !== undefined && latestGuide.epsHigh !== undefined
      ? (latestGuide.epsLow + latestGuide.epsHigh) / 2
      : latestGuide?.epsLow ?? latestGuide?.epsHigh;
  const metrics = deriveMetrics(quarters, stats?.last, consensusEps, guidedEpsMid);

  // The useful guidance signal is not the guide itself but whether it implies
  // acceleration or deceleration against the growth just reported.
  let guidanceDelta: number | undefined;
  let guidedGrowth: number | undefined;
  if (latestGuide && (latestGuide.revLow !== undefined || latestGuide.revHigh !== undefined)) {
    const lo = latestGuide.revLow ?? latestGuide.revHigh;
    const hi = latestGuide.revHigh ?? latestGuide.revLow;
    const mid = lo !== undefined && hi !== undefined ? (lo + hi) / 2 : undefined;
    // quarters[0] is the last reported quarter, so the guided quarter's
    // year-ago comparable sits at index 3.
    const yearAgo = quarters[3]?.revenue;
    if (mid && yearAgo && yearAgo > 0) {
      guidedGrowth = mid / yearAgo - 1;
      if (metrics.revYoY !== undefined) guidanceDelta = guidedGrowth - metrics.revYoY;
    }
  }

  if (metrics.marketCap) {
    await ctx.runMutation(internal.data.setUniverseMeta, { ticker: t, marketCap: metrics.marketCap });
  }

  // ---- own historical multiple ---------------------------------------
  // TTM EPS at each past quarter end, priced at the close on that date, gives
  // the multiple the market actually assigned this company over time.
  const ownPes: number[] = [];
  {
    const barByDate = new Map(storedBars.map((b) => [b.date, b.c]));
    const closeOn = (date: string): number | undefined => {
      if (barByDate.has(date)) return barByDate.get(date);
      // Period ends land on weekends; walk forward to the next session.
      for (let d = 0; d < 6; d++) {
        const probe = new Date(Date.parse(date) + d * 86_400_000).toISOString().slice(0, 10);
        if (barByDate.has(probe)) return barByDate.get(probe);
      }
      return undefined;
    };
    const epsOf = (q: (typeof quarters)[number]) => q.adjEps ?? q.epsDiluted;
    for (let i = 0; i + 3 < quarters.length && ownPes.length < 12; i++) {
      const window = quarters.slice(i, i + 4).map(epsOf);
      if (!window.every((x): x is number => typeof x === "number")) continue;
      const ttm = window.reduce((s: number, x: number) => s + x, 0);
      if (ttm <= 0) continue;
      const px = closeOn(quarters[i].periodEnd);
      if (px === undefined) continue;
      ownPes.push(px / ttm);
    }
  }
  const ownMedianPe = median(ownPes);

  // ---- peers --------------------------------------------------------
  let peerMedianFwdPe: number | undefined;
  let peerMedianEvToSales: number | undefined;
  let peerRet3m: number | undefined;
  let peerRevYoY: number | undefined;
  let peerCount = 0;
  let peerRows: unknown[] = [];
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
    if (peers.length > 0) {
      peerRows = await ctx.runQuery(internal.data.peerSnapshots, {
        tickers: peers,
        ownMarketCap: metrics.marketCap,
      });
    }
  }

  // ---- score (after valuation, which it depends on) ------------------
  const prior = await ctx.runQuery(internal.data.priorScore, { ticker: t });
  const scoreInputs = {
    guidanceDelta,
    guidedGrowth,
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
  };

  // ---- valuation ----------------------------------------------------
  // Per-ticker preset wins over the global one; "fixed" pins the anchor
  // instead of tracking the peer median. What the anchor *means* depends on
  // the archetype the valuation picks.
  const bandSettings = await ctx.runQuery(internal.settings.effectiveBands, { ticker: t });
  const latestQ = quarters[0];

  // The cash-flow method needs the moat, and the moat needs the archetype, so
  // the archetype is settled first and the valuation runs last.
  const { archetype } = classifyArchetype({
    sicCode: universeRow?.sicCode,
    epsTtm: metrics.epsTtm,
    cryptoFairValue: latestQ?.cryptoFairValue,
    longTermInvestments: latestQ?.longTermInvestments,
    totalAssets: latestQ?.totalAssets,
    revenueTtm: metrics.revenueTtm,
  });

  // ---- moat ---------------------------------------------------------
  const moat = assessMoat({
    archetype,
    quarters,
    grossMarginPct: metrics.grossMarginPct,
    grossMarginDeltaYoY: metrics.grossMarginDeltaYoY,
    opMarginPct: metrics.opMarginPct,
    fcfMarginPct: metrics.fcfMarginPct,
    fcfTtm: metrics.fcfTtm,
    netIncomeTtm:
      metrics.netMarginPct !== undefined && metrics.revenueTtm !== undefined
        ? metrics.netMarginPct * metrics.revenueTtm
        : undefined,
    rndIntensityPct: metrics.rndIntensityPct,
    sharesYoY: metrics.sharesYoY,
    netDebtToEbitda: metrics.netDebtToEbitda,
    netCash: metrics.netCash,
    revYoY: metrics.revYoY,
  });


  // ---- growth as the filings show it ---------------------------------
  const trajectory = readTrajectory(quarters);

  // Realised volatility, annualised, from the stored daily closes. Feeds band
  // width so a zone means the same thing on a quiet name and a violent one.
  let realisedVol: number | undefined;
  {
    const closes = ohlcv.slice(-252).map((b) => b.c).filter((c) => c > 0);
    if (closes.length > 60) {
      const rets: number[] = [];
      for (let i = 1; i < closes.length; i++) rets.push(Math.log(closes[i] / closes[i - 1]));
      const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
      const varr = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (rets.length - 1);
      realisedVol = Math.sqrt(varr) * Math.sqrt(252);
    }
  }

  // ---- what the price already assumes --------------------------------
  const expectations = readExpectations({
    marketCap: metrics.marketCap,
    netCash: metrics.netCash,
    fcfTtm: metrics.fcfTtm,
    revenueTtm: metrics.revenueTtm,
    revYoY: metrics.revYoY,
    revYoYPrior: metrics.revYoYPrior,
    guidedGrowth,
    moatScore: moat.score,
    netDebtToEbitda: metrics.netDebtToEbitda,
    trajectoryGrowth: trajectory?.perShareGrowth,
    trajectoryConfidence: trajectory?.confidence,
  });

  // ---- valuation ------------------------------------------------------
  const valuation = valuate({
    price: stats?.last,
    sicCode: universeRow?.sicCode,
    sharesDiluted: latestQ?.sharesDiluted,
    epsTtm: metrics.epsTtm,
    fwdEps: metrics.fwdEps,
    revenueTtm: metrics.revenueTtm,
    opIncomeTtm: metrics.opMarginPct !== undefined && metrics.revenueTtm !== undefined
      ? metrics.opMarginPct * metrics.revenueTtm
      : undefined,
    fcfTtm: metrics.fcfTtm,
    netCash: metrics.netCash,
    totalAssets: latestQ?.totalAssets,
    totalLiabilities: latestQ?.totalLiabilities,
    equity: latestQ?.equity,
    cryptoFairValue: latestQ?.cryptoFairValue,
    longTermInvestments: latestQ?.longTermInvestments,
    peerMedianFwdPe,
    peerMedianEvToSales,
    revGrowth: metrics.revYoY,
    revGrowthPrior: metrics.revYoYPrior,
    guidedGrowth,
    moatScore: moat.score,
    netDebtToEbitda: metrics.netDebtToEbitda,
    expectationsVerdict: expectations?.verdict,
    trajectoryGrowth: trajectory?.perShareGrowth,
    trajectoryConfidence: trajectory?.confidence,
    realisedVol,
    grossMarginPct: metrics.grossMarginPct,
    ownMedianPe,
    ownPeSamples: ownPes.length,
    anchorOverride: bandSettings.mode === "fixed" ? bandSettings.fixedMultiple : undefined,
  });
  if (valuation) await ctx.runMutation(internal.data.storeBands, { ticker: t, bands: valuation });
  else notes.push("valuation not computable — no share count");

  await ctx.runMutation(internal.data.storeMetrics, {
    ticker: t,
    metrics: {
      ...metrics,
      peerRet3m,
      peerRevYoY,
      peerCount,
      peerRows,
      archetype: valuation?.archetype,
      moatScore: moat.score,
      moatTrend: moat.direction,
      moatSummary: moat.summary,
      moatPillars: moat.pillars,
      expectations: expectations ?? undefined,
      trajectory: trajectory ?? undefined,
      realisedVol,
      guidedGrowth,
      guidanceDelta,
      guidancePeriod: latestGuide?.periodLabel,
      guidanceRevLow: latestGuide?.revLow,
      guidanceRevHigh: latestGuide?.revHigh,
      guidanceEpsLow: latestGuide?.epsLow,
      guidanceEpsHigh: latestGuide?.epsHigh,
      guidanceSourceUrl: latestGuide?.sourceUrl,
      adjEpsQuarters: quarters.slice(0, 4).filter((q) => q.adjEps !== undefined).length,
    },
  });

  // Discount to blended fair value is the archetype-correct valuation signal —
  // it is the only one that means anything for a company whose worth is an
  // asset base rather than an earnings stream.
  const result = computeScore({
    ...scoreInputs,
    upsideToFairValue: valuation?.upside === undefined ? undefined : valuation.upside / 100,
    moatScore: moat.score,
  });
  await ctx.runMutation(internal.data.storeScore, { ticker: t, score: result });

  // ---- evaluation + alerts ------------------------------------------
  await ctx.runMutation(internal.data.storeEvaluation, {
    ticker: t,
    composite: result.composite,
    asymmetry: result.asymmetry,
    verdict: result.verdict,
    changesSincePrior: diffScores(prior, result),
  });

  // A dip that is turning up while the name is already cheap is the highest-
  // value moment this system can flag, so it gets its own signal.
  if (dip.state === "reversing" && (valuation?.upside ?? -1) > 0) {
    await ctx.runMutation(internal.data.fireAlert, {
      ticker: t,
      type: "DIP_REVERSING",
      severity: "high",
      title: `${t}: pullback turning up`,
      detail:
        `Selling pressure fading while ${valuation?.upside}% below fair value — ${dip.evidence}.`,
      payload: dip,
      reArmDays: 20,
    });
  }

  const alertsFired = await evaluateAlerts(
    ctx,
    t,
    { ...metrics, peerRet3m, peerRevYoY, peerCount },
    stats,
    result,
    valuation,
    moat,
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
    currentBand: valuation?.currentBand,
    archetype: valuation?.archetype,
    fairValue: valuation?.fairValue,
    upside: valuation?.upside,
    confidence: valuation?.confidence,
    moatScore: moat.score,
    moatDirection: moat.direction,
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
  valuation: ReturnType<typeof valuate>,
  moat: ReturnType<typeof assessMoat>,
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
    if (r.fired) {
      fired.push(type);
      // Record the signal the moment it fires, with the price at that instant.
      // Reconstructing entry prices later is guesswork; this is the only point
      // at which the number is unambiguous.
      if (r.id && stats?.last !== undefined) {
        const spy = await ctx.runQuery(internal.data.priceStatsFor, { tickers: ["SPY"] });
        await ctx.runMutation(internal.journal.record, {
          alertId: r.id,
          ticker,
          type,
          severity,
          firedAt: Date.now(),
          priceAtSignal: stats.last,
          spyAtSignal: spy[0]?.last,
          verdictAtSignal: s.verdict,
        });
      }
    }
  };

  const band = valuation?.bands.find((b) => b.label === valuation.currentBand);
  if (band && (band.action === "BUY" || band.action === "BUY_AGGRESSIVE")) {
    await fire(
      "BUY_ZONE_ENTERED",
      "high",
      `${ticker} in "${band.label}" zone`,
      `Price ${fmt(stats?.last)} against a ${fmt(valuation?.fairValue)} fair value ` +
        `(${valuation?.upside}% upside, ${valuation?.confidence} confidence, ` +
        `${Math.round((valuation?.marginOfSafety ?? 0) * 100)}% margin of safety).`,
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
  const weakest = moat.pillars
    .filter((p) => p.level !== undefined)
    .sort((a, b) => (a.level as number) - (b.level as number))[0];

  if (moat.direction !== undefined && moat.direction <= -25) {
    await fire(
      "MOAT_WEAKENING",
      "high",
      `${ticker}: moat narrowing`,
      `${moat.summary} Weakest pillar — ${weakest?.label.toLowerCase()}: ${weakest?.evidence}.`,
      45
    );
  }
  if (moat.direction !== undefined && moat.direction >= 35) {
    await fire(
      "MOAT_STRENGTHENING",
      "medium",
      `${ticker}: moat widening`,
      moat.summary,
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
  const topBand = valuation?.bands[valuation.bands.length - 1];
  if (topBand && stats?.last !== undefined && stats.last > topBand.priceHi) {
    await fire(
      "OVERVALUED_EXIT",
      "high",
      `${ticker}: above every valuation method`,
      `Price ${fmt(stats.last)} is above ${fmt(topBand.priceHi)}, the top of a band table built ` +
        `on ${valuation?.methods.length} method${valuation?.methods.length === 1 ? "" : "s"} ` +
        `(fair value ${fmt(valuation?.fairValue)}, ${valuation?.anchorLabel}).`,
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

/**
 * Adjusted EPS + guidance from 8-K Item 2.02 releases.
 *
 * Runs per ticker over the most recent earnings 8-Ks, skipping any accession
 * already processed so repeat runs cost nothing. Extraction is verified
 * against the source text before storage — see lib/earningsRelease.ts.
 */
async function doExtractReleases(
  ctx: ActionCtx,
  ticker: string,
  cik: string,
  limit: number,
  force = false
): Promise<{ ticker: string; processed: number; adjEps: number; guidance: number; notes: string[] }> {
  const notes: string[] = [];
  let processed = 0;
  let adjEpsCount = 0;
  let guidanceCount = 0;

  let filings: { filedAt: string; accession: string }[] = [];
  try {
    filings = await fetchEarnings8Ks(cik, limit);
  } catch (e) {
    return { ticker, processed: 0, adjEps: 0, guidance: 0, notes: [`8-K list: ${String(e)}`] };
  }

  for (const f of filings) {
    if (!force) {
      const seen = await ctx.runQuery(internal.data.releaseSeen, { accession: f.accession });
      if (seen?.processed) continue;
    }

    try {
      const lookup = await findEarningsRelease(cik, f.accession);
      if (lookup.kind === "transient") {
        // Leave unprocessed so the next run retries. Marking it done here would
        // permanently lose that quarter's adjusted EPS.
        notes.push(`${f.accession}: ${lookup.reason}`);
        continue;
      }
      if (lookup.kind === "none") {
        notes.push(`${f.accession}: no release doc [${lookup.detail}]`);
        await ctx.runMutation(internal.data.markRelease, {
          ticker,
          cik,
          accession: f.accession,
          filedAt: f.filedAt,
          url: "",
          processed: true, // genuinely no release document in this filing
        });
        continue;
      }
      const doc = lookup.doc;

      const result = await extractFromRelease(doc, ticker);
      if ("error" in result) {
        notes.push(`${f.accession}: ${result.error}`);
        continue; // transient (rate limit, key) — leave unprocessed to retry
      }

      const { data, rejected, model, sourceUrl } = result;
      if (rejected.length > 0) notes.push(`${f.accession} rejected ${rejected.join(", ")}`);

      if (data.adjEps !== null) {
        const m = await ctx.runMutation(internal.data.storeAdjEps, {
          ticker,
          filedAt: f.filedAt,
          adjEps: data.adjEps,
          periodEndHint: data.periodEndDate ?? undefined,
          sourceUrl,
        });
        if (m.matched) adjEpsCount++;
        else notes.push(`${f.accession}: adjEps ${data.adjEps} matched no quarter`);
      }

      const hasGuide =
        data.guidanceRevenueLow !== null ||
        data.guidanceEpsLow !== null ||
        data.guidanceRevenueHigh !== null;
      if (hasGuide && data.guidancePeriodLabel) {
        await ctx.runMutation(internal.data.storeGuidance, {
          ticker,
          issuedAt: Date.parse(f.filedAt),
          periodLabel: data.guidancePeriodLabel,
          revLow: data.guidanceRevenueLow ?? undefined,
          revHigh: data.guidanceRevenueHigh ?? undefined,
          epsLow: data.guidanceEpsLow ?? undefined,
          epsHigh: data.guidanceEpsHigh ?? undefined,
          sourceUrl,
          extractedBy: model,
        });
        guidanceCount++;
      }

      await ctx.runMutation(internal.data.markRelease, {
        ticker,
        cik,
        accession: f.accession,
        filedAt: f.filedAt,
        url: sourceUrl,
        processed: true,
      });
      processed++;
    } catch (e) {
      notes.push(`${f.accession}: ${String(e)}`);
    }
    await sleep(350);
  }

  return { ticker, processed, adjEps: adjEpsCount, guidance: guidanceCount, notes };
}

export const extractReleases = action({
  args: {
    ticker: v.string(),
    cik: v.string(),
    limit: v.optional(v.number()),
    force: v.optional(v.boolean()),
  },
  handler: async (ctx, { ticker, cik, limit, force }) =>
    doExtractReleases(ctx, ticker.toUpperCase(), cik, limit ?? 8, force ?? false),
});

/**
 * Bounded per invocation. A full backfill across the watchlist is dozens of
 * document fetches plus an LLM call each, which overruns the action time limit
 * — it failed outright in production while succeeding on a smaller dev set.
 * Processed filings are skipped on the next pass, so the daily cron converges
 * over a few runs instead of failing as one long job.
 */
export const extractReleasesAll = internalAction({
  args: { limit: v.optional(v.number()), maxTickers: v.optional(v.number()) },
  handler: async (ctx, { limit, maxTickers }): Promise<{ processed: number; adjEps: number; covered: number }> => {
    const runId = await ctx.runMutation(internal.data.startRun, { task: "extractReleases" });
    const rows = await ctx.runQuery(internal.data.watchlistTickers, {});
    const budget = maxTickers ?? 5;
    const deadline = Date.now() + 7 * 60_000;

    let processed = 0;
    let adjEps = 0;
    let covered = 0;
    const failures: string[] = [];
    for (const row of rows) {
      if (covered >= budget || Date.now() > deadline) break;
      try {
        const r = await doExtractReleases(ctx, row.ticker, row.cik, limit ?? 8);
        processed += r.processed;
        adjEps += r.adjEps;
        // A ticker whose filings are all done costs one cheap index lookup and
        // must not consume the budget, or the sweep never reaches the tail of
        // the watchlist.
        if (r.processed > 0 || r.notes.length > 0) covered++;
        if (r.notes.length) failures.push(`${row.ticker}: ${r.notes[0]}`);
      } catch (e) {
        covered++;
        failures.push(`${row.ticker}: ${String(e)}`);
      }
    }
    await ctx.runMutation(internal.data.finishRun, {
      id: runId,
      ok: failures.length === 0,
      processed,
      error: failures.length ? failures.join(" | ").slice(0, 1000) : undefined,
    });
    return { processed, adjEps, covered };
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

/**
 * Intraday price refresh — quotes only, no SEC calls.
 *
 * Fundamentals move on filings, which is a daily-at-most event, but the price
 * moves all session and every band read depends on it. This keeps the chart and
 * the current-band label live without re-running an evaluation: it updates the
 * price, the day's change and the current band, and nothing else.
 *
 * Keyless and deliberately light — a dozen or so symbols on a 12-minute cadence
 * is a handful of requests a minute, and a failed quote leaves the previous
 * price in place rather than blanking it.
 */
export const refreshQuotes = internalAction({
  args: {},
  handler: async (ctx): Promise<{ updated: number; skipped: number }> => {
    const watch = await ctx.runQuery(internal.data.watchlistTickers, {});
    let updated = 0;
    let skipped = 0;

    for (const w of watch) {
      const q = await fetchQuote(w.ticker);
      if (!q) {
        skipped++;
        continue;
      }
      await ctx.runMutation(internal.data.patchQuote, {
        ticker: w.ticker,
        last: q.last,
        prevClose: q.prevClose,
      });
      updated++;
    }
    return { updated, skipped };
  },
});
