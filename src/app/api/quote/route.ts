import { NextRequest, NextResponse } from "next/server";

/**
 * Live quote proxy.
 *
 * The browser cannot call the upstream chart endpoint directly — it sends no
 * CORS headers — so the request is made here instead. This exists purely to
 * relay a price, and is deliberately narrow: one ticker per call, a strict
 * symbol pattern so the path cannot be steered elsewhere, and a short server
 * cache so a page left open in twenty tabs does not become twenty times the
 * upstream traffic.
 */

const SYMBOL = /^[A-Z][A-Z.-]{0,9}$/;

export async function GET(req: NextRequest) {
  const ticker = (req.nextUrl.searchParams.get("ticker") ?? "").toUpperCase();
  if (!SYMBOL.test(ticker)) {
    return NextResponse.json({ error: "bad ticker" }, { status: 400 });
  }

  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=1d&interval=1m`,
      {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; equity-radar/1.0)" },
        // One shared upstream fetch per ticker per 10s across all viewers,
        // rather than one per tab per poll.
        next: { revalidate: 10 },
      }
    );
    if (!res.ok) return NextResponse.json({ error: "upstream" }, { status: 502 });

    const json = (await res.json()) as {
      chart?: { result?: { meta?: Record<string, number> }[] };
    };
    const meta = json.chart?.result?.[0]?.meta;
    const last = meta?.regularMarketPrice;
    if (typeof last !== "number" || !Number.isFinite(last)) {
      return NextResponse.json({ error: "no price" }, { status: 404 });
    }

    return NextResponse.json({
      ticker,
      last,
      prevClose: meta?.chartPreviousClose ?? meta?.previousClose,
      asOf: (meta?.regularMarketTime ?? Math.floor(Date.now() / 1000)) * 1000,
    });
  } catch {
    return NextResponse.json({ error: "fetch failed" }, { status: 502 });
  }
}
