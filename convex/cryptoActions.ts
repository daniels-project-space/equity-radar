"use node";

import { v } from "convex/values";
import { action, internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { fetchCryptoBars, fetchOnChain, readCycle, cryptoBands } from "./lib/crypto";
import { calibrateCrypto } from "./lib/cryptoCalibrate";
import { derivePriceStats } from "./lib/metrics";
import { detectDip } from "./lib/dip";
import { featuresAt } from "./lib/signals";

/**
 * Ingest for a crypto asset.
 *
 * Deliberately not routed through the equity path. That pipeline's whole job is
 * to turn filings into a fair value, and there are no filings here — running it
 * would produce a confident number from nothing. Crypto gets price history, the
 * on-chain cost basis, and zones derived from the asset's own distribution
 * against that basis, with the valuation machinery left switched off rather
 * than fed placeholders.
 */
async function refresh(ctx: any, ticker: string, asset: string) {
  const bars = await fetchCryptoBars(asset);
  if (bars.length < 200) {
    return { ok: false, ticker, bars: bars.length, reason: "not enough price history" };
  }

  // storeBars dedupes only against the dates it is told about, so this must be
  // the real set. Passing an empty array re-inserted the entire history on every
  // refresh, which silently doubled the sample and inflated the measured span to
  // 21 years for an asset with 10.7 years of data.
  const known = await ctx.runQuery(internal.data.barDatesFor, { ticker });
  for (let i = 0; i < bars.length; i += 400) {
    await ctx.runMutation(internal.data.storeBars, {
      ticker,
      bars: bars.slice(i, i + 400),
      known,
    });
  }

  const closes = bars.map((b) => b.c);
  const stats = derivePriceStats(bars.map((b) => ({ date: b.date, c: b.c, v: b.v })));
  const dip = detectDip(bars);

  // On-chain series exist for Bitcoin only at the free tier. Everything else is
  // handled on price alone rather than shown an empty cycle read.
  const empty = { mvrvZ: [], nupl: [], sopr: [], realizedPrice: [] };
  let series = asset === "btc" ? await fetchOnChain() : null;
  if (asset === "btc") {
    if (series) {
      await ctx.runMutation(internal.allocation.storeOnChain, { asset, series });
    } else {
      // A rate-limited refresh must not blank out a working cycle read.
      const cached = await ctx.runQuery(internal.allocation.onChainSeries, { asset });
      series = cached?.series ?? null;
    }
  }
  const cycle = readCycle(series ?? empty, closes);

  if (stats) {
    const buckets: Record<string, string> = {};
    for (const f of featuresAt(bars)) buckets[f.signal] = f.bucket;
    await ctx.runMutation(internal.data.storePriceStats, {
      ticker,
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

  // Zones against realized price, using the asset's own history of trading
  // above and below its cost basis rather than levels copied off a chart site.
  if (series?.realizedPrice?.length && cycle?.realizedPrice) {
    const byDate = new Map(series.realizedPrice.map((p) => [p.date, p.value]));
    const ratios: number[] = [];
    for (const b of bars) {
      const rp = byDate.get(b.date);
      if (rp && rp > 0) ratios.push(b.c / rp);
    }
    const bands = cryptoBands(cycle.realizedPrice, ratios);
    if (bands.length) {
      const price = closes[closes.length - 1];
      const hit = bands.find((b) => price >= b.priceLo && price < b.priceHi);
      await ctx.runMutation(internal.data.storeBands, {
        ticker,
        bands: {
          archetype: "crypto",
          archetypeReason: "no cash flows or book value — valued against the network's cost basis",
          anchor: 1,
          anchorLabel: "1x realized price",
          methods: [
            {
              key: "realizedPrice",
              label: "Network cost basis",
              perShare: cycle.realizedPrice,
              weight: 1,
              basis: "average price at which the circulating supply last moved on-chain",
            },
          ],
          fairValue: cycle.realizedPrice,
          dispersion: 0,
          marginOfSafety: 0.25,
          confidence: "low",
          bands,
          currentBand: hit?.label ?? "Above range",
          upside: Math.round((cycle.realizedPrice / price - 1) * 1000) / 10,
        },
      });
    }
  }

  // Stored unconditionally, so an asset without on-chain data still renders as
  // a crypto asset with the fields it does have rather than as a blank equity.
  await ctx.runMutation(internal.data.storeMetrics, {
    ticker,
    metrics: { assetType: "crypto", cycle, quartersAvailable: 0 },
  });

  return {
    ok: true,
    ticker,
    bars: bars.length,
    from: bars[0].date,
    zone: cycle.zone,
    onChain: cycle.hasOnChain,
    mvrvZ: cycle.mvrvZ,
    tsmsv: cycle.tsmsv,
  };
}

export const refreshCrypto = action({
  args: { ticker: v.string(), asset: v.string() },
  handler: async (ctx, { ticker, asset }) => refresh(ctx, ticker, asset.toLowerCase()),
});

/** One-off repair for the duplicate bars written before the dedupe fix. */
export const dedupeCryptoBars = action({
  args: { ticker: v.string() },
  handler: async (ctx, { ticker }): Promise<{ removed: number; passes: number }> => {
    let removed = 0;
    let cursor: string | undefined;
    let passes = 0;
    // Repeats until a pass removes nothing, since duplicates spanning a page
    // boundary are only caught once the survivors sit together.
    for (let sweep = 0; sweep < 30; sweep++) {
      let sweepRemoved = 0;
      cursor = undefined;
      for (let page = 0; page < 60; page++) {
        const r: any = await ctx.runMutation(internal.data.dedupeBars, { ticker, cursor });
        sweepRemoved += r.removed;
        passes++;
        if (r.done || !r.next) break;
        cursor = r.next;
      }
      removed += sweepRemoved;
      if (sweepRemoved === 0) break;
    }
    return { removed, passes };
  },
});

export const refreshCryptoCron = internalAction({
  args: {},
  handler: async (ctx) => {
    const out = [];
    for (const [ticker, asset] of [["BTC", "btc"], ["ETH", "eth"]]) {
      try {
        out.push(await refresh(ctx, ticker, asset));
      } catch (e) {
        out.push({ ok: false, ticker, reason: String(e).slice(0, 120) });
      }
    }
    return out;
  },
});

/**
 * Runs the crypto signals through the same discipline the equity ones face.
 *
 * Kept separate from the equity calibration because the horizon, the step and
 * the cycle-coverage caveat all differ — merging them would mean one set of
 * assumptions quietly applied to an asset class it was not chosen for.
 */
export const calibrateCryptoSignals = action({
  args: { ticker: v.optional(v.string()), asset: v.optional(v.string()) },
  handler: async (ctx, args): Promise<any> => {
    const ticker = args.ticker ?? "BTC";
    const asset = (args.asset ?? "btc").toLowerCase();

    const bars = await ctx.runQuery(internal.data.fullBarsFor, { ticker, limit: 8000 });
    if (bars.length < 400) return { ok: false, reason: `only ${bars.length} bars` };

    const cached =
      asset === "btc" ? await ctx.runQuery(internal.allocation.onChainSeries, { asset }) : null;
    const series = cached?.series ?? null;
    const asMap = (xs?: { date: string; value: number }[]) =>
      xs ? Object.fromEntries(xs.map((p) => [p.date, p.value])) : undefined;

    const result = calibrateCrypto({
      dates: bars.map((b) => b.date),
      closes: bars.map((b) => b.c),
      mvrvZ: asMap(series?.mvrvZ),
      nupl: asMap(series?.nupl),
      sopr: asMap(series?.sopr),
      // Fixed regardless of what loaded, so the significance bar cannot drift
      // with network conditions.
      intended: asset === "btc" ? ["tsmsv", "mvrvZ", "nupl", "sopr"] : ["tsmsv"],
    });
    if (!result) return { ok: false, reason: "not enough aligned history" };

    await ctx.runMutation(internal.allocation.storeCryptoCalibration, { result });
    return {
      ok: true,
      observations: result.observations,
      signals: result.signals.length,
      criticalT: result.criticalT,
      missing: result.missing,
      inconclusive: result.inconclusive,
    };
  },
});
