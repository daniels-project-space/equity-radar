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
  const [showBands, setShowBands] = useState(true);

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
    const el = wrapRef.current;
    if (!series || !el || bands.length === 0) {
      setRects([]);
      return;
    }
    const height = el.clientHeight;
    const next: { band: Band; top: number; height: number }[] = [];
    for (const band of bands) {
      const yHi = series.priceToCoordinate(band.priceHi);
      const yLo = series.priceToCoordinate(band.priceLo);
      if (yHi === null && yLo === null) continue;
      // A band can extend past the visible price range — clamp to the plot.
      const top = Math.max(0, yHi ?? 0);
      const bottom = Math.min(height, yLo ?? height);
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
    chart.timeScale().fitContent();
    requestAnimationFrame(recomputeBands);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bars, rangeIdx, bands]);

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
        <label className="flex cursor-pointer items-center gap-2 text-[11px] text-[var(--muted)]">
          <input
            type="checkbox"
            checked={showBands}
            onChange={(e) => setShowBands(e.target.checked)}
            className="accent-[var(--accent)]"
          />
          Buy zones
        </label>
      </div>

      <div className="relative">
        <div ref={wrapRef} className="relative w-full" style={{ height: 420 }} />
        {showBands && (
          <div className="pointer-events-none absolute inset-0 overflow-hidden">
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
                  <span
                    className="absolute left-1.5 top-0.5 text-[10px] font-medium tracking-wide"
                    style={{ color, opacity: 0.85 }}
                  >
                    {band.label} · {band.multipleLo}–{band.multipleHi}x
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
