"use client";

import { useEffect, useRef, useState } from "react";
import {
  createChart,
  ColorType,
  type IChartApi,
  type ISeriesApi,
  type IPriceLine,
} from "lightweight-charts";
import { ACTION_COLOR } from "@/lib/format";

export type Band = {
  label: string;
  action: string;
  priceLo: number;
  priceHi: number;
  multipleLo: number;
  multipleHi: number;
};

// o/h/l are optional: the query omits them when they equal the close, which is
// every bar of a closes-only feed. They are filled from c on the way in so
// nothing below has to care.
type Bar = { date: string; o?: number; h?: number; l?: number; c: number; v: number };

const RANGES = [
  { label: "3M", days: 63 },
  { label: "1Y", days: 252 },
  { label: "2Y", days: 504 },
  { label: "5Y", days: 100000 },
] as const;

/** Height lightweight-charts gives the time axis at this font size. */
const TIME_AXIS_H = 32;

type Marker = {
  time: string;
  position: "belowBar" | "aboveBar";
  color: string;
  shape: "arrowUp" | "arrowDown" | "circle";
  text: string;
};

/** Simple moving average, aligned to the input series (undefined until filled). */
function sma(bars: Bar[], period: number): { time: string; value: number }[] {
  if (bars.length < period) return [];
  const out: { time: string; value: number }[] = [];
  let sum = 0;
  for (let i = 0; i < bars.length; i++) {
    sum += bars[i].c;
    if (i >= period) sum -= bars[i - period].c;
    if (i >= period - 1) out.push({ time: bars[i].date, value: sum / period });
  }
  return out;
}

/**
 * Crossings into and out of the zone, measured against the anchor as it stood
 * at the time.
 *
 * The earlier version compared every past close against *today's* band prices.
 * On Bitcoin that meant a buy ceiling built from a 2026 cost basis of $52,628
 * applied to 2023 prices near $25,000, so the only crossings it could find were
 * falls from local highs — it marked tops and called them entries. Zones are
 * kept as multiples of the anchor and re-priced against the contemporaneous
 * anchor instead, and nothing is drawn where no anchor history exists rather
 * than falling back to today's. Crossings within 10 sessions of the previous
 * one are dropped so an asset oscillating on a boundary does not produce a wall
 * of arrows.
 */
function crossings(
  bars: Bar[],
  bands: Band[],
  costBasis?: { date: string; value: number }[],
  fairValue?: number
): Marker[] {
  if (bands.length === 0 || bars.length < 2) return [];

  const buyBands = bands.filter((b) => b.action === "BUY" || b.action === "BUY_AGGRESSIVE");
  if (buyBands.length === 0) return [];

  // The multiple of the anchor at which the buy zone ends, rather than the
  // price. A price level is only meaningful alongside the anchor it came from.
  const buyMultiple = Math.max(...buyBands.map((b) => b.multipleHi));
  const trimBand = bands.find((b) => b.action === "TRIM");
  const trimMultiple = trimBand?.multipleLo;

  // Without a contemporaneous anchor there is nothing causal to mark. The old
  // version compared every past price against today's levels, which for Bitcoin
  // meant a "buy zone" ceiling built from a 2026 cost basis applied to 2023
  // prices — so the only crossings it could find were falls from local highs.
  // An anchor history is required. Holding today's estimate flat across ten
  // years was the previous fallback, and it is the same look-ahead that made
  // the crypto markers point at tops: a company earning a fraction of today's
  // profit was not worth today's valuation then. Both asset types now supply a
  // real series, and where one is missing nothing is drawn.
  if (!costBasis || costBasis.length < 4) return [];

  // Anchors arrive at filing dates, not every session, so each is carried
  // forward until the next one lands — which is how a valuation actually
  // behaves between results.
  const basisByDate = new Map(costBasis.map((p) => [p.date, p.value]));
  const anchorDates = costBasis.map((p) => p.date).sort();
  let carried: number | undefined = undefined;
  const anchorAt = (date: string): number | undefined => {
    const exact = basisByDate.get(date);
    if (exact !== undefined && exact > 0) {
      carried = exact;
      return carried;
    }
    // Filing dates rarely coincide with a session, so take the most recent
    // anchor at or before this bar.
    if (carried === undefined) {
      let latest: string | undefined;
      for (const d of anchorDates) {
        if (d <= date) latest = d;
        else break;
      }
      if (latest) carried = basisByDate.get(latest);
    }
    return carried;
  };

  const out: Marker[] = [];
  let lastIdx = -99;

  for (let i = 1; i < bars.length; i++) {
    const anchorNow = anchorAt(bars[i].date);
    const anchorPrev = anchorAt(bars[i - 1].date);
    if (!anchorNow || !anchorPrev) continue;
    if (i - lastIdx < 10) continue;

    const ceilNow = anchorNow * buyMultiple;
    const ceilPrev = anchorPrev * buyMultiple;

    if (bars[i - 1].c > ceilPrev && bars[i].c <= ceilNow) {
      out.push({
        time: bars[i].date,
        position: "belowBar",
        color: "#22c55e",
        shape: "arrowUp",
        text: "BUY ZONE",
      });
      lastIdx = i;
    } else if (trimMultiple !== undefined) {
      const floorNow = anchorNow * trimMultiple;
      const floorPrev = anchorPrev * trimMultiple;
      if (bars[i - 1].c < floorPrev && bars[i].c >= floorNow) {
        out.push({
          time: bars[i].date,
          position: "aboveBar",
          color: "#ef4444",
          shape: "arrowDown",
          text: "SELL ZONE",
        });
        lastIdx = i;
      }
    }
  }
  return out.slice(-14);
}

export function PriceChart({
  bars,
  bands,
  fairValue,
  earningsDates,
  costBasis,
  closesOnly,
}: {
  bars: Bar[];
  bands: Band[];
  fairValue?: number;
  earningsDates?: string[];
  /** Anchor history, so zones can be drawn as they stood at the time. */
  costBasis?: { date: string; value: number }[];
  /** True when open/high/low are copies of the close and candles would be a lie. */
  closesOnly?: boolean;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | ISeriesApi<"Line"> | null>(null);
  const basisRef = useRef<ISeriesApi<"Line"> | null>(null);
  const sma50Ref = useRef<ISeriesApi<"Line"> | null>(null);
  const sma200Ref = useRef<ISeriesApi<"Line"> | null>(null);
  const fvLineRef = useRef<IPriceLine | null>(null);

  const [rangeIdx, setRangeIdx] = useState(1);
  const [rects, setRects] = useState<{ band: Band; top: number; height: number }[]>([]);
  const [paneHeight, setPaneHeight] = useState(0);
  const [showBands, setShowBands] = useState(true);
    // On, by request. The measurement behind the caption still stands — after the
  // look-ahead was removed these crossings returned a median -8.3% over the
  // next 90 days against a +4.2% baseline — but which of two honest defaults to
  // pick is the user's call, and they asked to see them.
  const [showMarkers, setShowMarkers] = useState(true);
  const [showMa, setShowMa] = useState(true);
  const [showEarnings, setShowEarnings] = useState(true);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;

    const chart = createChart(el, {
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#8b98a9",
        fontSize: 11,
      },
      grid: {
        vertLines: { color: "rgba(30,41,59,0.45)" },
        horzLines: { color: "rgba(30,41,59,0.45)" },
      },
      rightPriceScale: { borderColor: "#1e293b", scaleMargins: { top: 0.12, bottom: 0.12 } },
      timeScale: { borderColor: "#1e293b", rightOffset: 4 },
      crosshair: { mode: 1 },
      handleScale: { axisPressedMouseMove: { time: true, price: false } },
      height: 420,
    });

    // The free crypto price feed publishes closes only, so open, high and low
    // are copies of the close. Drawn as candles those render as a row of flat
    // dashes with no bodies or wicks — a chart that looks broken because it is
    // depicting range that does not exist. A line is the honest shape for it.
    const series = closesOnly
      ? chart.addLineSeries({ color: "#e6edf3", lineWidth: 2, priceLineVisible: false })
      : chart.addCandlestickSeries({
          upColor: "#34d399",
          downColor: "#f87171",
          borderUpColor: "#34d399",
          borderDownColor: "#f87171",
          wickUpColor: "#34d399",
          wickDownColor: "#f87171",
        });

    const mkLine = (color: string) =>
      chart.addLineSeries({
        color,
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      });

    chartRef.current = chart;
    seriesRef.current = series;
    sma50Ref.current = mkLine("#38bdf8");
    sma200Ref.current = mkLine("#a78bfa");
    // The anchor itself, drawn as a line. For crypto this is the price the
    // network paid, which is the one genuinely causal reference on the chart.
    basisRef.current = chart.addLineSeries({
      color: "#fbbf24",
      lineWidth: 2,
      lineStyle: 2,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });

    const ro = new ResizeObserver(() => {
      chart.applyOptions({ width: el.clientWidth });
      requestAnimationFrame(recomputeBands);
    });
    ro.observe(el);
    chart.applyOptions({ width: el.clientWidth });

    const unsub = chart.timeScale().subscribeVisibleLogicalRangeChange(() => {
      requestAnimationFrame(recomputeBands);
    });

    return () => {
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(unsub as never);
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      sma50Ref.current = null;
      sma200Ref.current = null;
      basisRef.current = null;
      fvLineRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function recomputeBands() {
    const series = seriesRef.current;
    const el = wrapRef.current;
    if (!series || !el || bands.length === 0) {
      setRects([]);
      return;
    }
    // priceToCoordinate is relative to the price pane, which sits above the
    // time axis; timeScale().height() reports 0 until layout settles, so the
    // axis is reserved explicitly.
    const pane = Math.max(0, el.clientHeight - TIME_AXIS_H);
    setPaneHeight(pane);

    const next: { band: Band; top: number; height: number }[] = [];

    // Everything above the table gets its own region rather than being left
    // blank. Strategy has traded to $474 against a table that stops at $180, so
    // a quarter of its history sat over unshaded chart — which read as the
    // model having nothing to say, when what it actually means is that the
    // price spent that time beyond anything the fundamentals support.
    const tableTop = Math.max(...bands.map((b) => b.priceHi));
    const yTop = series.priceToCoordinate(tableTop);
    if (yTop !== null && yTop > 1) {
      next.push({
        band: {
          label: "Beyond the model",
          action: "ABOVE_RANGE",
          priceLo: tableTop,
          priceHi: Number.POSITIVE_INFINITY,
          multipleLo: 0,
          multipleHi: 0,
        },
        top: 0,
        height: yTop,
      });
    }

    for (const band of bands) {
      const yHi = series.priceToCoordinate(band.priceHi);
      const yLo = series.priceToCoordinate(band.priceLo);
      if (yHi === null && yLo === null) continue;
      const top = Math.max(0, yHi ?? 0);
      const bottom = Math.min(pane, yLo ?? pane);
      if (bottom - top < 1) continue;
      next.push({ band, top, height: bottom - top });
    }
    setRects(next);
  }

  useEffect(() => {
    const series = seriesRef.current;
    const chart = chartRef.current;
    if (!series || !chart) return;

    const slice = bars.slice(-RANGES[rangeIdx].days);
    if (closesOnly) {
      (series as ISeriesApi<"Line">).setData(slice.map((b) => ({ time: b.date, value: b.c })));
    } else {
      (series as ISeriesApi<"Candlestick">).setData(
        slice.map((b) => ({
          time: b.date,
          open: b.o ?? b.c,
          high: b.h ?? b.c,
          low: b.l ?? b.c,
          close: b.c,
        }))
      );
    }

    // Moving averages are computed on the full history then trimmed, so the
    // 200-day line is correct at the left edge of a short window instead of
    // starting 200 bars in.
    const from = slice[0]?.date ?? "";
    sma50Ref.current?.setData(showMa ? sma(bars, 50).filter((p) => p.time >= from) : []);
    sma200Ref.current?.setData(showMa ? sma(bars, 200).filter((p) => p.time >= from) : []);

    // The anchor line, trimmed to the visible window.
    basisRef.current?.setData(
      costBasis?.length ? costBasis.filter((pt) => pt.date >= (slice[0]?.date ?? "")).map((pt) => ({ time: pt.date, value: pt.value })) : []
    );

    const marks: Marker[] = showMarkers ? crossings(slice, bands, costBasis, fairValue) : [];
    if (showEarnings && earningsDates?.length) {
      const inRange = new Set(slice.map((b) => b.date));
      for (const d of earningsDates) {
        // Filing dates can land on a non-trading day; snap to the next session.
        const hit = inRange.has(d) ? d : slice.find((b) => b.date >= d)?.date;
        if (hit) {
          marks.push({ time: hit, position: "belowBar", color: "#64748b", shape: "circle", text: "E" });
        }
      }
    }
    marks.sort((a, b) => a.time.localeCompare(b.time));
    series.setMarkers(marks);

    if (fvLineRef.current) {
      series.removePriceLine(fvLineRef.current);
      fvLineRef.current = null;
    }
    if (fairValue && fairValue > 0) {
      fvLineRef.current = series.createPriceLine({
        price: fairValue,
        color: "#e6edf3",
        lineWidth: 1,
        lineStyle: 2,
        axisLabelVisible: true,
        title: "fair value",
      });
    }

    chart.timeScale().fitContent();
    requestAnimationFrame(recomputeBands);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bars, rangeIdx, bands, showMarkers, showMa, showEarnings, fairValue, earningsDates]);

  const toggle = (label: string, on: boolean, set: (v: boolean) => void, title?: string) => (
    <label
      className="flex cursor-pointer items-center gap-1.5 text-[11px] text-[var(--muted)]"
      title={title}
    >
      <input type="checkbox" checked={on} onChange={(e) => set(e.target.checked)} className="accent-[var(--accent)]" />
      {label}
    </label>
  );

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1">
          {RANGES.map((r, i) => (
            <button
              key={r.label}
              onClick={() => setRangeIdx(i)}
              className={`rounded-md px-2 py-1 text-[11px] transition ${
                i === rangeIdx
                  ? "bg-[var(--panel-2)] text-[var(--text)]"
                  : "text-[var(--muted)] hover:text-[var(--text)]"
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {toggle("Zones", showBands, setShowBands, "Valuation bands around fair value")}
          {toggle("MA 50/200", showMa, setShowMa, "50- and 200-day simple moving averages")}
          {toggle("Earnings", showEarnings, setShowEarnings, "Dates an earnings release was filed")}
          {toggle(
          "Zone crossings",
          showMarkers,
          setShowMarkers,
          "Where price crossed the zone boundary, priced against the anchor as it stood at the time. Measured on Bitcoin these did not predict: median forward 90-day return -8.3% against a +4.2% baseline. Shown for inspection, not as entries."
        )}
        </div>
      </div>

      <div className="relative">
        <div ref={wrapRef} className="relative w-full" style={{ height: 420 }} />
        {showBands && (
          <div
            className="pointer-events-none absolute left-0 right-0 top-0 overflow-hidden"
            style={{ height: paneHeight || undefined }}
          >
            {rects.map(({ band, top, height }) => {
              const color = ACTION_COLOR[band.action] ?? "#64748b";
              return (
                <div
                  key={band.label}
                  // Inset clears both the price scale and the fair-value axis
                  // label, which otherwise sits on top of the band name.
                  className="absolute left-0 right-[150px]"
                  style={{ top, height, background: `${color}14`, borderTop: `1px dashed ${color}55` }}
                >
                  {height >= 16 && (
                    <span
                      className="absolute right-1.5 top-0.5 text-[10px] font-medium tracking-wide"
                      style={{ color, opacity: 0.85 }}
                    >
                      {band.label}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* The shaded areas were unexplained, which made the most prominent thing
          on the chart the least legible one. */}
      <div className="mt-2 space-y-1.5 text-[10px] text-[var(--muted)]">
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          <span><span style={{ color: "#38bdf8" }}>—</span> 50-day average</span>
          <span><span style={{ color: "#a78bfa" }}>—</span> 200-day average</span>
          <span><span style={{ color: "#e6edf3" }}>- -</span> fair value</span>
          <span>E = earnings release</span>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="text-[var(--text)]">Shaded bands:</span>
          {[
            { label: "below value", action: "BUY" },
            { label: "around fair value", action: "ACCUMULATE" },
            { label: "above value", action: "TRIM" },
          ].map((b) => (
            <span key={b.label} className="flex items-center gap-1">
              <span
                className="inline-block h-2.5 w-4 rounded-[2px]"
                style={{
                  background: `${ACTION_COLOR[b.action] ?? "#64748b"}30`,
                  borderTop: `1px dashed ${ACTION_COLOR[b.action] ?? "#64748b"}88`,
                }}
              />
              {b.label}
            </span>
          ))}
        </div>
        <p className="leading-relaxed">
          The bands are price against fair value, nothing else. Their width is this stock&rsquo;s own
          margin of safety, so a volatile name gets wider zones than a steady one. They describe how
          cheap the price is — the rating above the chart is a separate judgement that also weighs
          growth, quality and moat, so the two can legitimately disagree.
        </p>
      </div>
    </div>
  );
}
