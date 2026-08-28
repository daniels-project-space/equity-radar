"use client";

import Link from "next/link";
import { Sparkline } from "./sparkline";
import { usd, signedPct, num, ACTION_COLOR, VERDICT_COLOR, scoreColor, isStale } from "@/lib/format";
import { SEVERITY_COLOR, type Severity } from "@/lib/notify";

export type CardAlert = { _id: string; type: string; severity: Severity; title: string };

type Card = {
  ticker: string;
  name: string;
  priceStats?: { last?: number; prevClose?: number; spark30?: number[] } | null;
  metrics?: { moatTrend?: number; latestPeriodEnd?: string } | null;
  score?: { asymmetry?: number; verdict?: string } | null;
  bands?: { currentBand?: string; upside?: number; bands?: { label: string; action: string }[] } | null;
};

/** Moat direction as one glyph — the company page has the breakdown. */
function MoatGlyph({ trend }: { trend?: number }) {
  if (trend === undefined) return null;
  const up = trend >= 15;
  const down = trend <= -15;
  return (
    <span
      style={{ color: up ? "var(--good)" : down ? "var(--bad)" : "var(--muted)" }}
      title={`Moat direction ${trend > 0 ? "+" : ""}${trend}/100`}
    >
      {up ? "↑" : down ? "↓" : "→"}
    </span>
  );
}

export function StockCard({ row, alerts = [] }: { row: Card; alerts?: CardAlert[] }) {
  const p = row.priceStats;
  const dayChange =
    p?.last !== undefined && p?.prevClose !== undefined && p.prevClose > 0
      ? p.last / p.prevClose - 1
      : undefined;

  const zoneLabel = row.bands?.currentBand;
  const band = row.bands?.bands?.find((b) => b.label === zoneLabel);
  const zoneColor = band
    ? ACTION_COLOR[band.action]
    : zoneLabel === "Above range"
      ? "var(--bad)"
      : "var(--muted)";
  const verdict = row.score?.verdict ?? "—";

  // The card is the alert. A separate "needs attention" list said the same
  // thing in a second place, which is one more thing to read, not less.
  const top = alerts[0];

  return (
    <Link
      href={`/c/${row.ticker}`}
      className="panel group flex flex-col gap-3 p-4 transition hover:border-[var(--accent)]/40"
      // Only critical earns a border. Most alerts are "high", so colouring
      // those too made every card look urgent, which is the same as none of
      // them being urgent.
      style={
        top?.severity === "critical"
          ? { borderLeftColor: SEVERITY_COLOR.critical, borderLeftWidth: 2 }
          : undefined
      }
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
            <span style={{ color: zoneColor }} title="Current valuation zone">
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

      {(top || isStale(row.metrics?.latestPeriodEnd)) && (
        <div className="border-t border-[var(--line)] pt-2 text-[10px] leading-snug">
          {top && (
            <div className="flex items-start gap-1.5">
              <span
                className="mt-[5px] h-1 w-1 shrink-0 rounded-full"
                style={{ background: SEVERITY_COLOR[top.severity] }}
              />
              <span className="text-[var(--muted)]">
                {top.title.replace(`${row.ticker}: `, "").replace(`${row.ticker} `, "")}
                {alerts.length > 1 && (
                  <span className="ml-1 opacity-60">+{alerts.length - 1} more</span>
                )}
              </span>
            </div>
          )}
          {isStale(row.metrics?.latestPeriodEnd) && (
            <div className="mt-1 text-[var(--warn)]">
              filings lag · through {row.metrics?.latestPeriodEnd}
            </div>
          )}
        </div>
      )}
    </Link>
  );
}
