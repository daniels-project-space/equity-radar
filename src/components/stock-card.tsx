"use client";

import Link from "next/link";
import { Sparkline } from "./sparkline";
import { usd, signedPct, num, ACTION_COLOR, VERDICT_COLOR, scoreColor, isStale } from "@/lib/format";

type Card = {
  ticker: string;
  name: string;
  priceStats?: { last?: number; prevClose?: number; spark30?: number[]; drawdownFromHigh?: number } | null;
  metrics?: { moatTrend?: number; latestPeriodEnd?: string } | null;
  score?: { asymmetry?: number; verdict?: string } | null;
  bands?: { currentBand?: string; bands?: { label: string; action: string }[] } | null;
};

/** Moat direction as one glyph — the detail page has the breakdown. */
function MoatGlyph({ trend }: { trend?: number }) {
  if (trend === undefined) return <span className="text-[var(--muted)]">·</span>;
  const up = trend >= 15;
  const down = trend <= -15;
  const color = up ? "var(--good)" : down ? "var(--bad)" : "var(--muted)";
  const arrow = up ? "↑" : down ? "↓" : "→";
  return (
    <span style={{ color }} title={`Moat direction ${trend > 0 ? "+" : ""}${trend}/100`}>
      {arrow}
    </span>
  );
}

export function StockCard({ row }: { row: Card }) {
  const p = row.priceStats;
  const dayChange =
    p?.last !== undefined && p?.prevClose !== undefined && p.prevClose > 0
      ? p.last / p.prevClose - 1
      : undefined;
  const zoneLabel = row.bands?.currentBand;
  const band = row.bands?.bands?.find((b) => b.label === zoneLabel);
  // "Above range" / "Below range" are sentinels with no matching band row.
  const zoneColor = band
    ? ACTION_COLOR[band.action]
    : zoneLabel === "Above range"
      ? "var(--bad)"
      : "var(--muted)";
  const verdict = row.score?.verdict ?? "—";

  return (
    <Link
      href={`/c/${row.ticker}`}
      className="panel group flex flex-col gap-3 p-4 transition hover:border-[var(--accent)]/40"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-baseline gap-2">
            <span className="text-[15px] font-semibold">{row.ticker}</span>
            <MoatGlyph trend={row.metrics?.moatTrend} />
          </div>
          <div className="truncate text-[11px] text-[var(--muted)]">{row.name}</div>
        </div>
        <div className="text-right">
          <div className="text-[15px] font-semibold tabular">{usd(p?.last)}</div>
          <div
            className="text-[11px] tabular"
            style={{ color: (dayChange ?? 0) >= 0 ? "var(--good)" : "var(--bad)" }}
          >
            {signedPct(dayChange, 2)}
          </div>
        </div>
      </div>

      <Sparkline values={p?.spark30} width={220} height={38} />

      <div className="flex items-center justify-between gap-2">
        <span
          className="chip"
          style={{
            color: VERDICT_COLOR[verdict] ?? "var(--muted)",
            borderColor: `${VERDICT_COLOR[verdict] ?? "#334155"}55`,
          }}
        >
          {verdict.replace(/_/g, " ")}
        </span>
        <div className="flex items-center gap-2 text-[11px]">
          {zoneLabel && (
            <span style={{ color: zoneColor }} title="Current buy zone">
              {zoneLabel}
            </span>
          )}
          <span
            className="tabular font-semibold"
            style={{ color: scoreColor(row.score?.asymmetry) }}
            title="Asymmetry — entry quality"
          >
            {num(row.score?.asymmetry, 0)}
          </span>
        </div>
      </div>

      {isStale(row.metrics?.latestPeriodEnd) && (
        <div className="text-[10px] text-[var(--warn)]">
          filings lag · through {row.metrics?.latestPeriodEnd}
        </div>
      )}
    </Link>
  );
}
