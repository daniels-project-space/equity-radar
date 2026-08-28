/**
 * Crypto, which needs a different model rather than the same one with different
 * inputs.
 *
 * Everything else in this project rests on a claim to intrinsic value: cash
 * flows discounted, multiples of earnings, assets net of debt. Bitcoin has
 * none of those. Running a DCF on it would not be conservative or aggressive,
 * it would be meaningless — there is no cash flow to discount.
 *
 * What crypto does have is a cost basis. Every coin last moved at some price,
 * and summing those gives realized value: what the network collectively paid
 * for its supply. That is a real anchor, observable on-chain, and it is what
 * the MVRV family measures deviation from. So realized price replaces fair
 * value here, and the zones become statistical distance from it rather than a
 * margin of safety around a valuation.
 *
 * WHAT THE EVIDENCE SAYS, INCLUDING THE PARTS AGAINST IT.
 *
 * The MVRV Z-score is the best-validated cycle indicator crypto has. Grobys,
 * Näsman and Sandretto (Research in International Business and Finance, 2026)
 * tested it across three cycles from 2013 to 2025 and found it lifted Sharpe
 * from 0.45 buy-and-hold to 1.28, significant under Opdyke's test, beating both
 * NUPL and CVDD. That is a genuinely peer-reviewed result, which is rare here.
 *
 * It is also much weaker than that summary sounds, and the same authors say so.
 * Each strategy made **three trades in twelve years** — a Sharpe ratio built on
 * three round trips is a fragile object. The test is in-sample on a single
 * asset. The exit thresholds may be hindsight-fitted, since they were chosen
 * near where past tops happened to sit. And the final trade never reached its
 * exit: the signal that supposedly calls tops did not fire on the most recent
 * cycle. The authors also flag that these are behavioural regularities in human
 * holders, which algorithmic participation could dissolve.
 *
 * So MVRV is used here to describe where the network sits in its cycle, never
 * as a trade trigger, and the caveat travels with the number.
 *
 * Separately, Shelton (JRFM 2024) found stock-to-flow and Metcalfe's Law
 * explain Bitcoin returns in-sample but have **no out-of-sample predictive
 * power**. Neither is implemented, deliberately. Cheah et al. found that
 * time-series momentum scaled by volatility was among the strongest genuine
 * out-of-sample predictors, so that one is computed.
 */

export type OnChainPoint = { date: string; value: number };

export type CryptoSeries = {
  mvrvZ: OnChainPoint[];
  nupl: OnChainPoint[];
  sopr: OnChainPoint[];
  realizedPrice: OnChainPoint[];
};

const UA = { "User-Agent": "equity-radar/1.0 (research)" };

/**
 * Polite fetch with backoff.
 *
 * The on-chain endpoint rate-limits hard and returns 429 rather than
 * degrading — four rapid requests while testing was enough to trip it. Since
 * these series only change once a day, retrying slowly costs nothing and
 * hammering costs access.
 */
async function politeJson<T>(url: string, tries = 3): Promise<T | null> {
  for (let attempt = 0; attempt < tries; attempt++) {
    try {
      const res = await fetch(url, { headers: UA });
      if (res.status === 429) {
        await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
        continue;
      }
      if (!res.ok) return null;
      return (await res.json()) as T;
    } catch {
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
    }
  }
  return null;
}

export type CryptoBar = { date: string; o: number; h: number; l: number; c: number; v: number };

/**
 * Daily price history from the CoinMetrics community API — free, keyless, and
 * far deeper than the on-chain endpoints: ten years against four, which matters
 * because a single Bitcoin cycle is about four years and one cycle cannot
 * distinguish a cycle indicator from a trend.
 *
 * Only closes are published at this tier, so open/high/low are set to the close.
 * Anything reading intraday range from these bars would be reading a fiction,
 * which is why the volume field is left at zero rather than invented.
 */
export async function fetchCryptoBars(asset: string, start = "2016-01-01"): Promise<CryptoBar[]> {
  const out: CryptoBar[] = [];
  let next: string | undefined;

  for (let page = 0; page < 20; page++) {
    const url =
      `https://community-api.coinmetrics.io/v4/timeseries/asset-metrics?assets=${encodeURIComponent(asset)}` +
      `&metrics=PriceUSD&frequency=1d&page_size=10000&start_time=${start}` +
      (next ? `&next_page_token=${encodeURIComponent(next)}` : "");

    const json = await politeJson<{
      data?: { time: string; PriceUSD?: string }[];
      next_page_token?: string;
    }>(url);
    if (!json?.data) break;

    for (const row of json.data) {
      const c = Number(row.PriceUSD);
      if (!Number.isFinite(c) || c <= 0) continue;
      out.push({ date: row.time.slice(0, 10), o: c, h: c, l: c, c, v: 0 });
    }
    next = json.next_page_token;
    if (!next) break;
  }
  return out;
}

/**
 * Free, keyless on-chain history. Only Bitcoin has these published without a
 * key; other assets fall back to price-only handling, which the caller must
 * respect rather than quietly presenting an empty cycle read as a neutral one.
 */
export async function fetchOnChain(): Promise<CryptoSeries | null> {
  const endpoints: { ep: string; field: string; key: keyof CryptoSeries }[] = [
    { ep: "mvrv-zscore", field: "mvrvZscore", key: "mvrvZ" },
    { ep: "nupl", field: "nupl", key: "nupl" },
    { ep: "sopr", field: "sopr", key: "sopr" },
    { ep: "realized-price", field: "realizedPrice", key: "realizedPrice" },
  ];

  const out: CryptoSeries = { mvrvZ: [], nupl: [], sopr: [], realizedPrice: [] };

  for (const e of endpoints) {
    const rows = await politeJson<Record<string, string>[]>(`https://bitcoin-data.com/v1/${e.ep}`);
    if (!Array.isArray(rows)) continue;
    out[e.key] = rows
      .map((r) => ({ date: String(r.d ?? ""), value: Number(r[e.field]) }))
      .filter((p) => p.date && Number.isFinite(p.value));
  }

  return out.mvrvZ.length > 0 || out.realizedPrice.length > 0 ? out : null;
}

export type CyclePosition = {
  mvrvZ?: number;
  nupl?: number;
  sopr?: number;
  realizedPrice?: number;
  /** Where price sits against the network's own cost basis. */
  mvrvRatio?: number;
  /** Percentile of today's MVRV Z within its own available history. */
  percentile?: number;
  zone: "capitulation" | "accumulation" | "mid-cycle" | "extended" | "euphoric" | "unknown";
  /** Volatility-scaled time-series momentum — the one with OOS support. */
  tsmsv?: number;
  summary: string;
  caveat: string;
};

const CAVEAT =
  "The MVRV Z-score is the best-validated cycle measure crypto has, and that is a low bar: the " +
  "peer-reviewed test behind it rests on three trades in twelve years, in-sample, on one asset, " +
  "with exit thresholds that may be fitted to past tops — and its top signal did not fire in the " +
  "most recent cycle. Read it as where the network sits against what it paid, never as a trigger.";

/**
 * Zones defined against the network's own distribution rather than the levels
 * that circulate on chart sites, which were mostly drawn to fit past cycles.
 * The percentile is the honest statement; the label is a convenience on top.
 */
function zoneFor(pct: number | undefined, z: number | undefined): CyclePosition["zone"] {
  if (pct === undefined || z === undefined) return "unknown";
  if (z < 0) return "capitulation";
  if (pct < 0.25) return "accumulation";
  if (pct < 0.6) return "mid-cycle";
  if (pct < 0.85) return "extended";
  return "euphoric";
}

/** Annualised volatility from daily closes. */
function vol(closes: number[]): number | undefined {
  if (closes.length < 30) return undefined;
  const rets: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    if (closes[i - 1] > 0 && closes[i] > 0) rets.push(Math.log(closes[i] / closes[i - 1]));
  }
  if (rets.length < 20) return undefined;
  const m = rets.reduce((a, b) => a + b, 0) / rets.length;
  const v = rets.reduce((a, b) => a + (b - m) ** 2, 0) / (rets.length - 1);
  return Math.sqrt(v) * Math.sqrt(365);
}

export function readCycle(series: CryptoSeries, closes: number[]): CyclePosition {
  const last = <T extends OnChainPoint>(xs: T[]) => (xs.length ? xs[xs.length - 1] : undefined);

  const zPoint = last(series.mvrvZ);
  const z = zPoint?.value;
  const nupl = last(series.nupl)?.value;
  const sopr = last(series.sopr)?.value;
  const realizedPrice = last(series.realizedPrice)?.value;
  const price = closes.length ? closes[closes.length - 1] : undefined;

  const zs = series.mvrvZ.map((p) => p.value).filter(Number.isFinite);
  const percentile =
    z !== undefined && zs.length > 30
      ? zs.filter((v) => v < z).length / zs.length
      : undefined;

  // Time-series momentum scaled by volatility: the predictor that survived
  // out-of-sample testing on Bitcoin, unlike stock-to-flow or Metcalfe's Law.
  let tsmsv: number | undefined;
  if (closes.length > 120) {
    const past = closes[closes.length - 91];
    const v = vol(closes.slice(-120));
    if (past > 0 && price && v && v > 0) tsmsv = (price / past - 1) / v;
  }

  const zone = zoneFor(percentile, z);
  const mvrvRatio = price && realizedPrice && realizedPrice > 0 ? price / realizedPrice : undefined;

  const bits: string[] = [];
  if (z !== undefined) {
    bits.push(
      `MVRV Z-score ${z.toFixed(2)}` +
        (percentile !== undefined ? `, higher than ${Math.round(percentile * 100)}% of the last four years` : "")
    );
  }
  if (mvrvRatio !== undefined) {
    bits.push(
      `price is ${mvrvRatio.toFixed(2)}x what the network paid on average` +
        (realizedPrice ? ` (realized price $${Math.round(realizedPrice).toLocaleString()})` : "")
    );
  }
  if (nupl !== undefined) {
    bits.push(
      `${(nupl * 100).toFixed(0)}% of network value is unrealised profit` +
        (nupl < 0 ? " — holders are underwater in aggregate" : "")
    );
  }
  if (sopr !== undefined && sopr < 1) {
    bits.push("coins are moving at a loss on average, which has marked capitulation historically");
  }

  return {
    mvrvZ: z,
    nupl,
    sopr,
    realizedPrice,
    mvrvRatio,
    percentile: percentile === undefined ? undefined : Math.round(percentile * 100) / 100,
    zone,
    tsmsv: tsmsv === undefined ? undefined : Math.round(tsmsv * 100) / 100,
    summary: bits.length ? bits.join("; ") + "." : "No on-chain data available for this asset.",
    caveat: CAVEAT,
  };
}

/**
 * Price zones for a crypto asset, anchored on realized price.
 *
 * The multiples are the historical distribution of price-to-realized-price, so
 * the zones widen and narrow with the asset's own history instead of using
 * levels copied off a chart site.
 */
export function cryptoBands(
  realizedPrice: number,
  ratios: number[]
): { label: string; action: string; priceLo: number; priceHi: number; multipleLo: number; multipleHi: number }[] {
  const sorted = [...ratios].filter((r) => Number.isFinite(r) && r > 0).sort((a, b) => a - b);
  if (sorted.length < 50 || realizedPrice <= 0) return [];
  const q = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];

  const edges = [
    { label: "Below network cost", action: "BUY_AGGRESSIVE", lo: 0, hi: 1 },
    { label: "Deep accumulation", action: "BUY_AGGRESSIVE", lo: 1, hi: q(0.2) },
    { label: "Accumulation", action: "BUY", lo: q(0.2), hi: q(0.4) },
    { label: "Mid-cycle", action: "ACCUMULATE", lo: q(0.4), hi: q(0.65) },
    { label: "Extended", action: "HOLD", lo: q(0.65), hi: q(0.85) },
    { label: "Historically euphoric", action: "TRIM", lo: q(0.85), hi: q(0.99) * 1.2 },
  ];

  return edges
    .filter((e) => e.hi > e.lo)
    .map((e) => ({
      label: e.label,
      action: e.action,
      priceLo: Math.round(realizedPrice * e.lo * 100) / 100,
      priceHi: Math.round(realizedPrice * e.hi * 100) / 100,
      multipleLo: Math.round(e.lo * 100) / 100,
      multipleHi: Math.round(e.hi * 100) / 100,
    }));
}
