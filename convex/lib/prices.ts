/**
 * Daily price bars.
 *
 * Alpaca is the supported path and is used whenever ALPACA_KEY_ID/ALPACA_SECRET
 * are set — free tier, corporate-action adjusted, documented. The Yahoo chart
 * endpoint is the keyless fallback so the app is useful before any signup; it
 * is unofficial and may change without notice, so treat it as best-effort.
 *
 * (Stooq was the original fallback but now gates behind a JS proof-of-work
 * challenge, which is a bot check — not something to work around.)
 */

export type Bar = { date: string; o: number; h: number; l: number; c: number; v: number };

export async function fetchDailyBars(ticker: string, lookbackDays = 1300): Promise<Bar[]> {
  if (process.env.ALPACA_KEY_ID && process.env.ALPACA_SECRET) {
    try {
      return await fetchAlpaca(ticker, lookbackDays);
    } catch {
      // a price feed outage must not block the whole evaluation
    }
  }
  return fetchYahoo(ticker, lookbackDays);
}

type YahooChart = {
  chart: {
    error: unknown;
    result?: {
      timestamp?: number[];
      indicators: {
        quote: { open?: (number | null)[]; high?: (number | null)[]; low?: (number | null)[]; close?: (number | null)[]; volume?: (number | null)[] }[];
        adjclose?: { adjclose?: (number | null)[] }[];
      };
    }[];
  };
};

async function fetchYahoo(ticker: string, lookbackDays: number): Promise<Bar[]> {
  const range = lookbackDays > 1000 ? "5y" : lookbackDays > 400 ? "2y" : "1y";
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}` +
    `?range=${range}&interval=1d&events=div%2Csplit`;
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" } });
  if (!res.ok) throw new Error(`yahoo ${res.status} for ${ticker}`);
  const json = (await res.json()) as YahooChart;
  const r = json.chart?.result?.[0];
  const ts = r?.timestamp;
  const q = r?.indicators?.quote?.[0];
  if (!ts || !q?.close) throw new Error(`yahoo returned no bars for ${ticker}`);

  // Prefer adjusted closes so splits do not fabricate a drawdown.
  const adj = r.indicators.adjclose?.[0]?.adjclose;

  const bars: Bar[] = [];
  for (let i = 0; i < ts.length; i++) {
    const close = adj?.[i] ?? q.close[i];
    if (close === null || close === undefined || !Number.isFinite(close)) continue;
    bars.push({
      date: new Date(ts[i] * 1000).toISOString().slice(0, 10),
      o: q.open?.[i] ?? close,
      h: q.high?.[i] ?? close,
      l: q.low?.[i] ?? close,
      c: close,
      v: q.volume?.[i] ?? 0,
    });
  }
  return bars;
}

async function fetchAlpaca(ticker: string, lookbackDays: number): Promise<Bar[]> {
  const start = new Date(Date.now() - lookbackDays * 86_400_000).toISOString().slice(0, 10);
  const url =
    `https://data.alpaca.markets/v2/stocks/${encodeURIComponent(ticker)}/bars` +
    `?timeframe=1Day&start=${start}&limit=10000&adjustment=all&feed=iex`;
  const res = await fetch(url, {
    headers: {
      "APCA-API-KEY-ID": process.env.ALPACA_KEY_ID as string,
      "APCA-API-SECRET-KEY": process.env.ALPACA_SECRET as string,
    },
  });
  if (!res.ok) throw new Error(`alpaca ${res.status} for ${ticker}`);
  const json = (await res.json()) as { bars?: { t: string; o: number; h: number; l: number; c: number; v: number }[] };
  return (json.bars ?? []).map((b) => ({
    date: b.t.slice(0, 10),
    o: b.o,
    h: b.h,
    l: b.l,
    c: b.c,
    v: b.v,
  }));
}

/**
 * Consensus FY+1 EPS. FMP's free tier allows 250 calls/day, so the caller is
 * responsible for the priority queue — watchlist daily, everything else rarely.
 * Returns undefined rather than throwing: a missing estimate degrades the buy
 * bands to a TTM basis, it does not fail the evaluation.
 */
export async function fetchForwardEps(ticker: string): Promise<number | undefined> {
  const key = process.env.FMP_API_KEY;
  if (!key) return undefined;
  try {
    const res = await fetch(
      `https://financialmodelingprep.com/stable/analyst-estimates?symbol=${encodeURIComponent(
        ticker
      )}&period=annual&limit=4&apikey=${key}`
    );
    if (!res.ok) return undefined;
    const rows = (await res.json()) as { date?: string; epsAvg?: number; estimatedEpsAvg?: number }[];
    if (!Array.isArray(rows) || rows.length === 0) return undefined;
    const thisYear = new Date().getUTCFullYear();
    // Pick the nearest future fiscal year, else the most recent estimate row.
    const future = rows
      .filter((r) => r.date && Number(r.date.slice(0, 4)) > thisYear)
      .sort((a, b) => (a.date as string).localeCompare(b.date as string));
    const pick = future[0] ?? rows[0];
    const eps = pick.epsAvg ?? pick.estimatedEpsAvg;
    return typeof eps === "number" && Number.isFinite(eps) ? eps : undefined;
  } catch {
    return undefined;
  }
}
