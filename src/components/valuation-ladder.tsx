"use client";

import { usd } from "@/lib/format";
import { ACTION_COLOR } from "@/lib/format";

type Band = { label: string; action: string; priceLo: number; priceHi: number };

/**
 * The whole valuation as one strip: every zone laid out on a price axis, with
 * fair value and the current price marked on it. A table of six price ranges
 * makes you do the comparison in your head; this does it for you.
 */
export function ValuationLadder({
  bands,
  price,
  fairValue,
  currentBand,
}: {
  bands: Band[];
  price?: number;
  fairValue?: number;
  currentBand?: string;
}) {
  if (bands.length === 0 || !price) return null;

  const tableTop = bands[bands.length - 1].priceHi;
  const tableBottom = bands[0].priceLo;

  // The bottom band runs to zero and the top runs far above; clamping the axis
  // to something near the action keeps the middle bands legible.
  const lo = Math.min(bands[1]?.priceLo ?? tableBottom, price * 0.75);
  const hi = Math.max(tableTop * 1.02, price * 1.08);
  const span = hi - lo || 1;
  const posOf = (v: number) => Math.max(0, Math.min(100, ((v - lo) / span) * 100));

  // A price above every method is a real finding, not a gap in the chart.
  // Leaving blank space there looked like a rendering fault.
  const outOfRange = price > tableTop;

  return (
    <div className="select-none">
      <div className="relative h-9 w-full overflow-hidden rounded-md">
        {bands.map((b) => {
          const left = posOf(b.priceLo);
          const right = posOf(b.priceHi);
          const width = right - left;
          if (width <= 0.2) return null;
          const color = ACTION_COLOR[b.action] ?? "#64748b";
          const active = b.label === currentBand;
          return (
            <div
              key={b.label}
              className="absolute inset-y-0 flex items-center justify-center"
              style={{
                left: `${left}%`,
                width: `${width}%`,
                background: active ? `${color}38` : `${color}16`,
                borderLeft: `1px solid ${color}44`,
              }}
              title={`${b.label} · ${usd(b.priceLo, 0)}–${usd(b.priceHi, 0)}`}
            >
              {width > 13 && (
                <span
                  className="truncate px-1 text-[9px] font-medium"
                  style={{ color, opacity: active ? 1 : 0.75 }}
                >
                  {b.label}
                </span>
              )}
            </div>
          );
        })}

        {outOfRange && (
          <div
            className="absolute inset-y-0 flex items-center justify-center"
            style={{
              left: `${posOf(tableTop)}%`,
              right: 0,
              background:
                "repeating-linear-gradient(45deg, rgba(248,113,113,0.16) 0 6px, transparent 6px 12px)",
              borderLeft: "1px solid rgba(248,113,113,0.5)",
            }}
            title={`Above every valuation method — the table tops out at ${usd(tableTop, 0)}`}
          >
            <span className="px-1 text-[9px] font-medium text-[var(--bad)]">above range</span>
          </div>
        )}

        {/* fair value */}
        {fairValue !== undefined && (
          <div
            className="absolute inset-y-0 w-px bg-[var(--text)]/70"
            style={{ left: `${posOf(fairValue)}%` }}
          />
        )}

        {/* current price */}
        <div
          className="absolute inset-y-0 w-[2px] bg-[var(--accent)]"
          style={{ left: `${posOf(price)}%` }}
        />
      </div>

      <div className="relative mt-1 h-4 text-[9px] text-[var(--muted)]">
        {fairValue !== undefined && (
          <span
            className="absolute -translate-x-1/2 whitespace-nowrap"
            style={{ left: `${posOf(fairValue)}%` }}
          >
            fair {usd(fairValue, 0)}
          </span>
        )}
        <span
          className="absolute -translate-x-1/2 whitespace-nowrap font-medium text-[var(--accent)]"
          style={{ left: `${posOf(price)}%`, top: fairValue !== undefined ? 10 : 0 }}
        >
          now {usd(price, 0)}
        </span>
      </div>
    </div>
  );
}
