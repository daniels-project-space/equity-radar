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

type Bar = { date: string; o: number; h: number; l: number; c: number; v: number };

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
 * Historical crossings into the buy zone and out above the band table.
 *
 * These mark what already happened at *today's* fair value — not a backtest.
 * Because the anchor moves with earnings and the peer group, the same chart
 * will mark different days next quarter. Crossings within 10 sessions of the
 * previous one are dropped so a stock oscillating on a boundary does not
 * produce a wall of arrows.
 */
function crossings(bars: Bar[], bands: Band[]): Marker[] {
  if (bands.length === 0 || bars.length < 2) return [];

  const buyBands = bands.filter((b) => b.action === "BUY" || b.action === "BUY_AGGRESSIVE");
  const buyCeiling = buyBands.length ? Math.max(...buyBands.map((b) => b.priceHi)) : undefined;
  const trimBand = bands.find((b) => b.action === "TRIM");
  const trimFloor = trimBand?.priceLo;

  const out: Marker[] = [];
  let lastIdx = -99;

  for (let i = 1; i < bars.length; i++) {
    const prev = bars[i - 1].c;
    const now = bars[i].c;
    if (i - lastIdx < 10) continue;

    if (buyCeiling !== undefined && prev > buyCeiling && now <= buyCeiling) {
      out.push({ time: bars[i].date, position: "belowBar", color: "#34d399", shape: "arrowUp", text: "entry" });
      lastIdx = i;
    } else if (trimFloor !== undefined && prev < trimFloor && now >= trimFloor) {
      out.push({ time: bars[i].date, position: "aboveBar", color: "#f87171", shape: "arrowDown", text: "rich" });
      lastIdx = i;
    }
  }
  return out.slice(-14);
}

export function PriceChart({
  bars,
  bands,
  fairValue,
  earningsDates,
}: {
  bars: Bar[];
  bands: Band[];
  fairValue?: number;
  earningsDates?: string[];
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const sma50Ref = useRef<ISeriesApi<"Line"> | null>(null);
  const sma200Ref = useRef<ISeriesApi<"Line"> | null>(null);
  const fvLineRef = useRef<IPriceLine | null>(null);

  const [rangeIdx, setRangeIdx] = useState(1);
  const [rects, setRects] = useState<{ band: Band; top: number; height: number }[]>([]);
  const [paneHeight, setPaneHeight] = useState(0);
  const [showBands, setShowBands] = useState(true);
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

    const series = chart.addCandlestickSeries({
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
    series.setData(slice.map((b) => ({ time: b.date, open: b.o, high: b.h, low: b.l, close: b.c })));

    // Moving averages are computed on the full history then trimmed, so the
    // 200-day line is correct at the left edge of a short window instead of
    // starting 200 bars in.
    const from = slice[0]?.date ?? "";
    sma50Ref.current?.setData(showMa ? sma(bars, 50).filter((p) => p.time >= from) : []);
    sma200Ref.current?.setData(showMa ? sma(bars, 200).filter((p) => p.time >= from) : []);

    const marks: Marker[] = showMarkers ? crossings(slice, bands) : [];
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
          {toggle("Entries", showMarkers, setShowMarkers, "Crossings into the buy zone or above the table")}
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
                  className="absolute left-0 right-[70px]"
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

      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-[var(--muted)]">
        <span><span style={{ color: "#38bdf8" }}>—</span> 50-day</span>
        <span><span style={{ color: "#a78bfa" }}>—</span> 200-day</span>
        <span><span style={{ color: "#e6edf3" }}>- -</span> fair value</span>
        <span>E = earnings release</span>
      </div>
    </div>
  );
}
