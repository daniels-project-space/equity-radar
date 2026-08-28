"use node";

import { v } from "convex/values";
import { action, internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { fetchCryptoBars, fetchOnChain, readCycle, cryptoBands } from "./lib/crypto";
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

  for (let i = 0; i < bars.length; i += 400) {
    await ctx.runMutation(internal.data.storeBars, {
      ticker,
      bars: bars.slice(i, i + 400),
      known: [],
    });
  }

  const closes = bars.map((b) => b.c);
  const stats = derivePriceStats(bars.map((b) => ({ date: b.date, c: b.c, v: b.v })));
  const dip = detectDip(bars);

  // On-chain series exist for Bitcoin only at the free tier. Everything else is
  // handled on price alone rather than shown an empty cycle read.
  const series = asset === "btc" ? await fetchOnChain() : null;
  const cycle = series ? readCycle(series, closes) : null;

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

  if (cycle) {
    await ctx.runMutation(internal.data.storeMetrics, {
      ticker,
      metrics: { assetType: "crypto", cycle, quartersAvailable: 0 },
    });
  }

  return {
    ok: true,
    ticker,
    bars: bars.length,
    from: bars[0].date,
    zone: cycle?.zone ?? "unknown",
    mvrvZ: cycle?.mvrvZ,
    tsmsv: cycle?.tsmsv,
  };
}

export const refreshCrypto = action({
  args: { ticker: v.string(), asset: v.string() },
  handler: async (ctx, { ticker, asset }) => refresh(ctx, ticker, asset.toLowerCase()),
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
