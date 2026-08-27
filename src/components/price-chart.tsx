"use client";

import { useEffect, useRef, useState } from "react";
import { createChart, ColorType, type IChartApi, type ISeriesApi } from "lightweight-charts";
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

/** Height lightweight-charts gives the time axis at this font size. */
const TIME_AXIS_H = 32;

type Marker = {
  time: string;
  position: "belowBar" | "aboveBar";
  color: string;
  shape: "arrowUp" | "arrowDown";
  text: string;
};

/**
 * Historical crossings into the buy zone and out above the band table.
 *
 * These are markers on what already happened at today's valuation anchor — not
 * a backtest and not a recommendation. Because the anchor moves with earnings
 * and the peer group, the same chart will mark different days next quarter.
 * Crossings within 10 sessions of the previous one are dropped so a stock
 * oscillating on a boundary does not produce a wall of arrows.
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
      out.push({
        time: bars[i].date,
        position: "belowBar",
        color: "#34d399",
        shape: "arrowUp",
        text: "entry",
      });
      lastIdx = i;
    } else if (trimFloor !== undefined && prev < trimFloor && now >= trimFloor) {
      out.push({
        time: bars[i].date,
        position: "aboveBar",
        color: "#f87171",
        shape: "arrowDown",
        text: "rich",
      });
      lastIdx = i;
    }
  }

  return out.slice(-14);
}

const RANGES = [
  { label: "3M", days: 63 },
  { label: "1Y", days: 252 },
  { label: "2Y", days: 504 },
  { label: "5Y", days: 100000 },
] as const;

/**
 * Price history with the computed buy zones drawn straight onto the chart.
 * The bands are an HTML overlay rather than chart primitives so they can be
 * repositioned from `priceToCoordinate` whenever the visible range changes —
 * that keeps them pinned to real price levels while the user zooms.
 */
export function PriceChart({ bars, bands }: { bars: Bar[]; bands: Band[] }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const [rangeIdx, setRangeIdx] = useState(1);
  const [rects, setRects] = useState<{ band: Band; top: number; height: number }[]>([]);
  const [paneHeight, setPaneHeight] = useState(0);
  const [showBands, setShowBands] = useState(true);
  const [showMarkers, setShowMarkers] = useState(true);

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

    chartRef.current = chart;
    seriesRef.current = series;

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
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function recomputeBands() {
    const series = seriesRef.current;
    const chart = chartRef.current;
    const el = wrapRef.current;
    if (!series || !chart || !el || bands.length === 0) {
      setRects([]);
      return;
    }
    // priceToCoordinate is relative to the price pane, which sits above the
    // time axis. Using the full container height lets bands spill over the
    // dates and the attribution logo. timeScale().height() reports 0 until
    // layout settles, so reserve the axis explicitly instead.
    const pane = Math.max(0, el.clientHeight - TIME_AXIS_H);
    setPaneHeight(pane);
    void chart;

    const next: { band: Band; top: number; height: number }[] = [];
    for (const band of bands) {
      const yHi = series.priceToCoordinate(band.priceHi);
      const yLo = series.priceToCoordinate(band.priceLo);
      if (yHi === null && yLo === null) continue;
      // A band can extend past the visible price range — clamp to the pane.
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
    series.setData(
      slice.map((b) => ({ time: b.date, open: b.o, high: b.h, low: b.l, close: b.c }))
    );
    series.setMarkers(showMarkers ? crossings(slice, bands) : []);
    chart.timeScale().fitContent();
    requestAnimationFrame(recomputeBands);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bars, rangeIdx, bands, showMarkers]);

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
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
        <div className="flex items-center gap-3">
          <label className="flex cursor-pointer items-center gap-2 text-[11px] text-[var(--muted)]">
            <input
              type="checkbox"
              checked={showBands}
              onChange={(e) => setShowBands(e.target.checked)}
              className="accent-[var(--accent)]"
            />
            Zones
          </label>
          <label
            className="flex cursor-pointer items-center gap-2 text-[11px] text-[var(--muted)]"
            title="Days the price crossed into the buy zone, or up out of the band table"
          >
            <input
              type="checkbox"
              checked={showMarkers}
              onChange={(e) => setShowMarkers(e.target.checked)}
              className="accent-[var(--accent)]"
            />
            Entries / exits
          </label>
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
                  style={{
                    top,
                    height,
                    background: `${color}14`,
                    borderTop: `1px dashed ${color}55`,
                  }}
                >
                  {/* A sliver of a band has no room for a label. Labels sit on
                      the right so they clear the chart's bottom-left mark. */}
                  {height >= 16 && (
                    <span
                      className="absolute right-1.5 top-0.5 text-[10px] font-medium tracking-wide"
                      style={{ color, opacity: 0.85 }}
                    >
                      {band.label} · {band.multipleLo}–{band.multipleHi}x
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
