import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";

async function latestFor(ctx: any, ticker: string) {
  // All four in one batch. The score used to be awaited after the other three
  // had resolved, which made every row two round trips instead of one.
  const [priceStats, metrics, bands, score] = await Promise.all([
    ctx.db.query("price_stats").withIndex("by_ticker", (i: any) => i.eq("ticker", ticker)).unique(),
    ctx.db.query("metrics").withIndex("by_ticker", (i: any) => i.eq("ticker", ticker)).unique(),
    ctx.db
      .query("buy_bands")
      .withIndex("by_ticker", (i: any) => i.eq("ticker", ticker))
      .order("desc")
      .first(),
    ctx.db
      .query("scores")
      .withIndex("by_ticker", (i: any) => i.eq("ticker", ticker))
      .order("desc")
      .first(),
  ]);
  return { priceStats, metrics, bands, score };
}

/** Everything the dashboard grid needs, in one round trip. */
/**
 * Only the fields a tile renders.
 *
 * `list` returned every stored document per row, which for fourteen names came
 * to 333KB on every load of the grid — and the tile draws almost none of it.
 * The single largest contributor was a 48-row volume profile per name, at 18%
 * of the payload, displayed nowhere on the home page. Behind it sat the full
 * moat pillar breakdown, the peer table, the scenario set, the linkage
 * regression and the score's bucket detail, none of which a tile shows either.
 *
 * Projecting to what is actually rendered cuts the payload by roughly an order
 * of magnitude, and the detail views already fetch the full documents when a
 * name is opened. The cost of this shape is that adding a field to the tile
 * means adding it here too, which is a fair trade for not shipping a
 * quarter-megabyte to draw fourteen sparklines.
 */
export const listCompact = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("watchlist").collect();

    // Fanned out rather than awaited one name at a time. Fourteen rows in
    // sequence meant fourteen dependent round trips for data that has no
    // ordering requirement at all.
    const out = await Promise.all(
      rows.map(async (row) => {
        const { priceStats: p, metrics: m, bands: b, score: sc } = await latestFor(ctx, row.ticker);
        return {
        _id: row._id,
        ticker: row.ticker,
        name: row.name,
        assetType: row.assetType ?? "equity",
        priceStats: p
          ? {
              last: p.last,
              prevClose: p.prevClose,
              spark30: p.spark30,
              dipState: p.dipState,
              dipScore: p.dipScore,
              ret3m: p.ret3m,
              wk52High: p.wk52High,
            }
          : null,
        metrics: m
          ? {
              assetType: m.assetType,
              moatScore: m.moatScore,
              moatTrend: m.moatTrend,
              latestPeriodEnd: m.latestPeriodEnd,
              revYoY: m.revYoY,
              revAccel: m.revAccel,
              sharesYoY: m.sharesYoY,
              grossMarginPct: m.grossMarginPct,
              grossMarginDeltaYoY: m.grossMarginDeltaYoY,
              netDebtToEbitda: m.netDebtToEbitda,
              // The level to act at, so a tile can show it without the card
              // having to guess from fair value. Three numbers, not the object.
              buyLevels: m.buyLevels
                ? {
                    blended: m.buyLevels.blended,
                    discountToPrice: m.buyLevels.discountToPrice,
                    relativeWeight: m.buyLevels.relativeWeight,
                  }
                : undefined,
              // Only the three fields keyFacts reads, not the whole object.
              expectations: m.expectations
                ? {
                    impliedGrowth: m.expectations.impliedGrowth,
                    referenceGrowth: m.expectations.referenceGrowth,
                    verdict: m.expectations.verdict,
                  }
                : undefined,
              quality: m.quality
                ? {
                    grossProfitability: m.quality.grossProfitability,
                    accruals: m.quality.accruals,
                    fScore: m.quality.fScore,
                    fScoreMax: m.quality.fScoreMax,
                  }
                : undefined,
              cycle: m.cycle
                ? { zone: m.cycle.zone, tsmsv: m.cycle.tsmsv, hasOnChain: m.cycle.hasOnChain }
                : undefined,
            }
          : null,
        bands: b
          ? {
              currentBand: b.currentBand,
              upside: b.upside,
              fairValue: b.fairValue,
              confidence: b.confidence,
              marginOfSafety: b.marginOfSafety,
              // Label and action only; the tile colours a chip from these.
              bands: (b.bands ?? []).map((x: { label: string; action: string }) => ({
                label: x.label,
                action: x.action,
              })),
            }
          : null,
          score: sc ? { asymmetry: sc.asymmetry, verdict: sc.verdict } : null,
        };
      })
    );

    out.sort((a, b2) => (b2.score?.asymmetry ?? -1) - (a.score?.asymmetry ?? -1));
    return out;
  },
});

export const list = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("watchlist").collect();
    const out = [];
    for (const row of rows) {
      const joined = await latestFor(ctx, row.ticker);
      out.push({ ...row, ...joined });
    }
    // Best entry first — that is the whole point of the asymmetry score.
    out.sort((a, b) => (b.score?.asymmetry ?? -1) - (a.score?.asymmetry ?? -1));
    return out;
  },
});

export const get = query({
  args: { ticker: v.string() },
  handler: async (ctx, { ticker }) => {
    const t = ticker.toUpperCase();
    const entry = await ctx.db
      .query("watchlist")
      .withIndex("by_ticker", (i) => i.eq("ticker", t))
      .unique();
    const universe = await ctx.db
      .query("universe")
      .withIndex("by_ticker", (i) => i.eq("ticker", t))
      .unique();
    if (!entry && !universe) return null;

    const joined = await latestFor(ctx, t);
    const quarters = await ctx.db
      .query("fundamentals_q")
      .withIndex("by_ticker", (i) => i.eq("ticker", t))
      .collect();
    quarters.sort((a, b) => b.periodEnd.localeCompare(a.periodEnd));

    const thesis = await ctx.db
      .query("theses")
      .withIndex("by_ticker", (i) => i.eq("ticker", t))
      .order("desc")
      .first();

    const alerts = await ctx.db
      .query("alerts")
      .withIndex("by_ticker", (i) => i.eq("ticker", t))
      .order("desc")
      .take(20);

    const evaluations = await ctx.db
      .query("evaluations")
      .withIndex("by_ticker", (i) => i.eq("ticker", t))
      .order("desc")
      .take(30);

    const peers = await ctx.db
      .query("peer_groups")
      .withIndex("by_ticker", (i) => i.eq("ticker", t))
      .unique();

    // 8-K Item 2.02 filing dates are the real earnings dates — no calendar
    // feed needed, and they line up with the price history exactly.
    const releases = await ctx.db
      .query("filings")
      .withIndex("by_ticker", (i) => i.eq("ticker", t))
      .collect();
    const earningsDates = releases
      .map((r) => r.filedAt)
      .sort()
      .slice(-24);

    const guidance = await ctx.db
      .query("guidance")
      .withIndex("by_ticker", (i) => i.eq("ticker", t))
      .collect();
    guidance.sort((a, b) => b.issuedAt - a.issuedAt);

    return {
      ticker: t,
      onWatchlist: !!entry,
      entry,
      universe,
      ...joined,
      quarters: quarters.slice(0, 12),
      thesis,
      alerts,
      evaluations,
      peers: peers?.peers ?? [],
      earningsDates,
      guidance: guidance.slice(0, 4),
    };
  },
});

/**
 * The network's cost basis over time, for crypto.
 *
 * Needed because a single present-day cost basis drawn across ten years of
 * history is look-ahead: Bitcoin's realized price was a fraction of today's in
 * 2023, so today's "accumulation" level sits near what were then all-time highs.
 * Banding the chart against the contemporaneous basis is the only version of
 * this that a reader could have acted on.
 */
export const costBasisSeries = query({
  args: { asset: v.string() },
  handler: async (ctx, { asset }) => {
    const row = await ctx.db
      .query("simulations")
      .withIndex("by_key", (i) => i.eq("key", `onchain:${asset.toLowerCase()}`))
      .unique();
    const rp = (row?.result?.realizedPrice ?? []) as { date: string; value: number }[];
    // Rounded for the same reason as the bars, and thinned to weekly: the cost
    // basis is a slow-moving aggregate that no chart resolves daily, and daily
    // points cost 82KB to draw a line that changes by tenths of a percent.
    const clean = rp.filter((p) => p?.date && Number.isFinite(p.value));
    return clean
      .filter((_, i) => i % 7 === 0 || i === clean.length - 1)
      .map((p) => ({ date: p.date, value: Math.round(p.value * 100) / 100 }));
  },
});

/**
 * Daily bars, rounded and de-duplicated on the way out.
 *
 * Prices are stored as 32-bit floats, so they serialise as things like
 * 225.32000732421875 — eighteen characters to express two decimal places of a
 * number that is drawn on a chart 400 pixels tall. At 1,300 bars with five
 * numeric fields that was 209KB per company page, most of it digits nobody can
 * see. Rounding to the cent, and to four significant figures below a dollar so
 * sub-penny assets keep their resolution, does not change a single pixel.
 *
 * Open, high and low are omitted where they equal the close, which is the case
 * for every crypto asset because the free feed publishes closes only. The client
 * fills them back from the close, so nothing downstream has to know.
 *
 * The result is columnar rather than a list of objects. Repeating the keys
 * "date", "o", "h", "l", "c" on every one of 1,300 bars costs about forty
 * characters a row — roughly a third of the payload spent restating the schema.
 * Volume is dropped outright: it is used server-side to build the volume
 * profile and read nowhere on the client.
 */
export const priceSeries = query({
  args: { ticker: v.string(), days: v.optional(v.number()) },
  handler: async (ctx, { ticker, days = 1260 }) => {
    const rows = await ctx.db
      .query("prices_daily")
      .withIndex("by_ticker", (i) => i.eq("ticker", ticker.toUpperCase()))
      .collect();
    rows.sort((a, b) => a.date.localeCompare(b.date));

    const round = (n: number) => {
      if (!Number.isFinite(n)) return 0;
      if (Math.abs(n) >= 1) return Math.round(n * 100) / 100;
      return Number(n.toPrecision(4));
    };

    const slice = rows.slice(-days);
    const d: string[] = [];
    const c: number[] = [];
    const o: number[] = [];
    const h: number[] = [];
    const l: number[] = [];
    let anyRange = false;

    for (const r of slice) {
      const cc = round(r.c);
      const oo = round(r.o);
      const hh = round(r.h);
      const ll = round(r.l);
      d.push(r.date);
      c.push(cc);
      o.push(oo);
      h.push(hh);
      l.push(ll);
      if (oo !== cc || hh !== cc || ll !== cc) anyRange = true;
    }

    // A feed with no intraday range ships one column instead of four.
    return anyRange ? { d, o, h, l, c } : { d, c };
  },
});

/**
 * Crypto assets this app can actually source data for.
 *
 * Deliberately a fixed list rather than a free-text field. A typo that silently
 * created a crypto row would send the asset down a pipeline that never fetches
 * anything, leaving a permanently empty page; and the ticker has to be one the
 * price source recognises, which is not something a user should have to know.
 */
const CRYPTO: Record<string, { asset: string; name: string }> = {
  BTC: { asset: "btc", name: "Bitcoin" },
  ETH: { asset: "eth", name: "Ethereum" },
  SOL: { asset: "sol", name: "Solana" },
  ADA: { asset: "ada", name: "Cardano" },
  AVAX: { asset: "avax", name: "Avalanche" },
  DOT: { asset: "dot", name: "Polkadot" },
  LTC: { asset: "ltc", name: "Litecoin" },
  LINK: { asset: "link", name: "Chainlink" },
};

export const add = mutation({
  args: { ticker: v.string(), reason: v.optional(v.string()) },
  handler: async (ctx, { ticker, reason }) => {
    const t = ticker.toUpperCase();
    const existing = await ctx.db
      .query("watchlist")
      .withIndex("by_ticker", (i) => i.eq("ticker", t))
      .unique();
    if (existing) return { id: existing._id, created: false };

    // Crypto is checked first and never looked up in the SEC universe. Some
    // crypto symbols also exist as stock tickers — Yahoo quotes "BTC" as a
    // Grayscale trust at $34 while Bitcoin trades near $78,000 — so resolving
    // one as the other is silent, plausible-looking corruption.
    const c = CRYPTO[t];
    if (c) {
      const id = await ctx.db.insert("watchlist", {
        ticker: t,
        cik: "",
        name: c.name,
        assetType: "crypto",
        cryptoAsset: c.asset,
        addedAt: Date.now(),
        addedReason: reason,
        muted: false,
      });
      return { id, created: true, assetType: "crypto", cryptoAsset: c.asset };
    }

    const u = await ctx.db
      .query("universe")
      .withIndex("by_ticker", (i) => i.eq("ticker", t))
      .unique();
    if (!u) throw new Error(`${t} is not in the universe — refresh the universe first`);

    const id = await ctx.db.insert("watchlist", {
      ticker: t,
      cik: u.cik,
      name: u.name,
      assetType: "equity",
      addedAt: Date.now(),
      addedReason: reason,
      muted: false,
    });
    return { id, created: true, cik: u.cik, assetType: "equity" };
  },
});

export const remove = mutation({
  args: { ticker: v.string() },
  handler: async (ctx, { ticker }) => {
    const row = await ctx.db
      .query("watchlist")
      .withIndex("by_ticker", (i) => i.eq("ticker", ticker.toUpperCase()))
      .unique();
    if (row) await ctx.db.delete(row._id);
    return { removed: !!row };
  },
});

export const update = mutation({
  args: {
    ticker: v.string(),
    notes: v.optional(v.string()),
    muted: v.optional(v.boolean()),
    targetMultipleLo: v.optional(v.number()),
    targetMultipleHi: v.optional(v.number()),
  },
  handler: async (ctx, { ticker, ...patch }) => {
    const row = await ctx.db
      .query("watchlist")
      .withIndex("by_ticker", (i) => i.eq("ticker", ticker.toUpperCase()))
      .unique();
    if (!row) throw new Error("not on watchlist");
    const clean = Object.fromEntries(Object.entries(patch).filter(([, v2]) => v2 !== undefined));
    await ctx.db.patch(row._id, clean);
  },
});
