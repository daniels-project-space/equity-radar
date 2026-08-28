"use client";

import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";

const PALETTE = ["#38bdf8", "#34d399", "#a78bfa", "#fbbf24", "#f472b6", "#22d3ee"];
const CASH = "#334155";

type Slice = {
  ticker: string;
  weight: number;
  reason: string;
  dipState?: string;
  dipScore?: number;
};

/** Donut built from SVG arcs — a chart library for six numbers is overkill. */
function Donut({ slices, cash }: { slices: Slice[]; cash: number }) {
  const size = 132;
  const r = 52;
  const stroke = 20;
  const c = 2 * Math.PI * r;

  const parts = [
    ...slices.map((s, i) => ({ label: s.ticker, weight: s.weight, color: PALETTE[i % PALETTE.length] })),
    ...(cash > 0.001 ? [{ label: "Cash", weight: cash, color: CASH }] : []),
  ];

  let offset = 0;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0">
      <g transform={`translate(${size / 2}, ${size / 2}) rotate(-90)`}>
        {parts.map((p) => {
          const len = p.weight * c;
          const el = (
            <circle
              key={p.label}
              r={r}
              fill="none"
              stroke={p.color}
              strokeWidth={stroke}
              strokeDasharray={`${len} ${c - len}`}
              strokeDashoffset={-offset}
            />
          );
          offset += len;
          return el;
        })}
      </g>
      <text
        x="50%"
        y="47%"
        textAnchor="middle"
        className="fill-[var(--text)] text-[15px] font-semibold"
      >
        {slices.length === 0 ? "0%" : `${Math.round((1 - cash) * 100)}%`}
      </text>
      <text x="50%" y="60%" textAnchor="middle" className="fill-[var(--muted)] text-[9px]">
        deployed
      </text>
    </svg>
  );
}

const REGIME_COLOR: Record<string, string> = {
  "broadly cheap": "var(--good)",
  mixed: "var(--muted)",
  "broadly expensive": "var(--warn)",
  stretched: "var(--bad)",
};

/**
 * "If I contributed today, where would it go?"
 *
 * Two separate answers, deliberately shown as two things. The size of the
 * contribution flexes with the market — down when everything is dear, up when
 * it is not, but never to zero, because refusing to invest while valuations
 * drift upward for years is itself an expensive call. The split between names
 * is a relative judgement that always has an answer.
 */
export function DcaWidget() {
  const alloc = useQuery(api.allocation.today);

  if (alloc === undefined) {
    return <div className="panel p-4 text-[12px] text-[var(--muted)]">Loading allocation…</div>;
  }

  const nothing = alloc.slices.length === 0;
  const regime = alloc.regime;
  const rate = alloc.deploymentRate ?? 1;

  return (
    <section className="panel p-4">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h2 className="text-[11px] uppercase tracking-wider text-[var(--muted)]">
          Next contribution
        </h2>
        <span className="text-[10px] text-[var(--muted)]">{alloc.evaluated} evaluated</span>
      </div>

      {regime && (
        <div className="mb-3 rounded-md border border-[var(--line)] p-2.5">
          <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
            <span
              className="text-[10px] font-medium uppercase tracking-wider"
              style={{ color: REGIME_COLOR[regime.label] ?? "var(--muted)" }}
            >
              {regime.label}
            </span>
            <span className="tabular text-[11px]">
              deploy <strong>{rate.toFixed(2)}x</strong> normal
            </span>
          </div>
          <p className="text-[10px] leading-snug text-[var(--muted)]">{regime.summary}</p>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-5">
        <Donut slices={alloc.slices} cash={alloc.cash} />

        <div className="min-w-[190px] flex-1">
          <p
            className="mb-2.5 text-[12px] leading-snug"
            style={{ color: nothing ? "var(--warn)" : "var(--text)" }}
          >
            {alloc.headline}
          </p>

          <ul className="space-y-1.5">
            {alloc.slices.map((s, i) => (
              <li key={s.ticker}>
                <div className="flex items-baseline justify-between gap-2 text-[11px]">
                  <span className="flex items-center gap-1.5">
                    <span
                      className="h-2 w-2 shrink-0 rounded-sm"
                      style={{ background: PALETTE[i % PALETTE.length] }}
                    />
                    <Link href={`/c/${s.ticker}`} className="font-medium hover:underline">
                      {s.ticker}
                    </Link>
                    {s.dipState === "falling" && (
                      <span
                        className="text-[9px]"
                        style={{ color: "var(--warn)" }}
                        title="Attractively priced, but the selling has not stopped — you would be buying into a decline."
                      >
                        still falling
                      </span>
                    )}
                    {s.dipState === "stabilising" && (
                      <span className="text-[9px]" style={{ color: "var(--good)" }} title="Selling pressure fading.">
                        selling easing
                      </span>
                    )}
                    {s.dipState === "reversing" && (
                      <span className="text-[9px]" style={{ color: "var(--good)" }} title="Turning up off the low.">
                        turning up
                      </span>
                    )}
                  </span>
                  <span className="tabular font-semibold">{Math.round(s.weight * 100)}%</span>
                </div>
                <p className="ml-3.5 text-[10px] leading-snug text-[var(--muted)]">{s.reason}</p>
              </li>
            ))}
            {alloc.cash > 0.001 && (
              <li className="flex items-baseline justify-between gap-2 text-[11px]">
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: CASH }} />
                  <span className="text-[var(--muted)]">Cash</span>
                </span>
                <span className="tabular text-[var(--muted)]">
                  {Math.round(alloc.cash * 100)}%
                </span>
              </li>
            )}
          </ul>
        </div>
      </div>

      {alloc.rejected.length > 0 && (
        <details className="mt-3 border-t border-[var(--line)] pt-2">
          <summary className="cursor-pointer text-[10px] text-[var(--muted)]">
            {alloc.rejected.length} did not qualify
          </summary>
          <ul className="mt-1.5 space-y-0.5">
            {alloc.rejected.map((r) => (
              <li key={r.ticker} className="flex justify-between gap-2 text-[10px]">
                <span>{r.ticker}</span>
                <span className="text-[var(--muted)]">{r.reason}</span>
              </li>
            ))}
          </ul>
        </details>
      )}

      <p className="mt-2 text-[9px] leading-snug text-[var(--muted)]">
        Two decisions, kept apart. The market sets how much to deploy — never zero, because
        refusing to invest while valuations drift upward for years is itself an expensive call.
        The split between names is relative: being expensive costs a name its rank, it does not
        disqualify it. 40% cap per name.</p>
    </section>
  );
}
