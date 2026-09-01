"use client";

import Link from "next/link";
import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import { X } from "lucide-react";
import { Sparkline } from "./sparkline";
import { usd, signedPct, num, ACTION_COLOR, VERDICT_COLOR, scoreColor, isStale } from "@/lib/format";
import { SEVERITY_COLOR, type Severity } from "@/lib/notify";
import { keyFacts, TONE_COLOR } from "@/lib/key-facts";
import { signalLabel } from "@/lib/signal-label";

export type CardAlert = { _id: string; type: string; severity: Severity; title: string };

type Card = {
  ticker: string;
  name: string;
  assetType?: string;
  priceStats?: {
    last?: number;
    prevClose?: number;
    spark30?: number[];
    dipState?: string;
    dipScore?: number;
  } | null;
  metrics?: {
    moatTrend?: number;
    latestPeriodEnd?: string;
    assetType?: string;
    cycle?: { zone?: string; tsmsv?: number; hasOnChain?: boolean };
    buyLevels?: { blended?: number; discountToPrice?: number; relativeWeight?: number };
  } | null;
  score?: { asymmetry?: number; verdict?: string } | null;
  bands?: {
    currentBand?: string;
    upside?: number;
    fairValue?: number;
    confidence?: string;
    bands?: { label: string; action: string }[];
  } | null;
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
  const sig = signalLabel(row.score?.verdict, p?.dipState, p?.dipScore);

  // Crypto has no verdict because it has no filings to score. Falling through to
  // the equity label rendered Bitcoin as "Not enough data" next to ten years of
  // history, which is the opposite of true — the cycle read is what it has.
  const isCrypto = row.metrics?.assetType === "crypto";
  const cycle = row.metrics?.cycle;
  const cryptoLabel = cycle?.hasOnChain
    ? (cycle.zone ?? "cycle unknown")
    : "price only — no on-chain data";
  const [confirming, setConfirming] = useState(false);
  const remove = useMutation(api.watchlist.remove);

  // Derived from current data, not from stored alert rows. Those were written at
  // evaluation time and never expired, so MSTR was still showing "above the band
  // table" — an internal signal key, referring to a valuation model the app no
  // longer uses. Sharing keyFacts with the company page also means the card and
  // the detail view cannot say different things about the same company.
  // Alerts are still used for the critical border, because a critical alert is
  // an event that happened rather than a description of the present — that kind
  // does not go stale the way the old headline text did.
  const hasCritical = alerts.some((a) => a.severity === "critical");

  const headline = keyFacts({
    ticker: row.ticker,
    price: p ?? undefined,
    bands: row.bands ?? undefined,
    metrics: row.metrics ?? undefined,
    score: row.score ?? undefined,
  })[0];

  return (
    <div className="group relative">
      {/* Removing a tile was buried on the company page, which is a long way to
          go to undo an add. The confirm step is here because the grid is the
          one place a stray click is cheap to make and annoying to reverse. */}
      {confirming ? (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 rounded-[inherit] border border-[var(--line)] bg-[var(--bg)]/95 p-4 backdrop-blur">
          <p className="text-center text-[12px] leading-snug">
            Stop tracking <strong>{row.ticker}</strong>?
          </p>
          <p className="text-center text-[10px] text-[var(--muted)]">
            Its history stays — you can add it back any time.
          </p>
          <div className="mt-1 flex gap-2">
            <button
              onClick={() => { void remove({ ticker: row.ticker }); setConfirming(false); }}
              className="chip border-[var(--bad)]/50 text-[var(--bad)] hover:bg-[var(--bad)]/10"
            >
              Remove
            </button>
            <button onClick={() => setConfirming(false)} className="chip hover:text-[var(--text)]">
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={(e) => { e.preventDefault(); setConfirming(true); }}
          aria-label={`Stop tracking ${row.ticker}`}
          className="absolute right-1.5 top-1.5 z-10 rounded p-1 text-[var(--muted)] opacity-60 transition hover:bg-[var(--line)] hover:text-[var(--text)] focus-visible:opacity-100 group-hover:opacity-100"
        >
          <X size={12} />
        </button>
      )}

    <Link
      href={`/c/${row.ticker}`}
      className="panel flex flex-col gap-3 p-4 transition hover:border-[var(--accent)]/40"
      // Only critical earns a border. Most alerts are "high", so colouring
      // those too made every card look urgent, which is the same as none of
      // them being urgent.
      style={
        hasCritical
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

      {/* The one number that is an instruction rather than an observation. A
          tile that shows price, day change and a rating still leaves the reader
          to work out what price would make them act; this says it. */}
      {!isCrypto && row.metrics?.buyLevels?.blended !== undefined && (
        <div className="flex items-baseline justify-between text-[11px]">
          <span className="text-[var(--muted)]">Buy at</span>
          <span className="flex items-baseline gap-1.5">
            <span className="tabular font-medium" style={{ color: "var(--good)" }}>
              {usd(row.metrics.buyLevels.blended)}
            </span>
            {row.metrics.buyLevels.discountToPrice !== undefined && (
              <span
                className="tabular text-[var(--muted)]"
                title="How far below today's price the blended buy level sits. It mixes discounted cash flows with what the market has historically paid for this company's sales."
              >
                {row.metrics.buyLevels.discountToPrice >= -1 ? "at or below now" : `${Math.abs(Math.round(row.metrics.buyLevels.discountToPrice))}% away`}
              </span>
            )}
          </span>
        </div>
      )}

      <div className="flex items-center justify-between gap-2">
        {/* The rating carries the pullback state, because "cheap" and "the
            selling has stopped" are different facts and only one of them is
            in the verdict. */}
        <span
          className="chip"
          style={{
            color: isCrypto
              ? "var(--muted)"
              : sig.fallingKnife
                ? "var(--warn)"
                : (VERDICT_COLOR[verdict] ?? "var(--muted)"),
            borderColor: `${isCrypto ? "#334155" : sig.fallingKnife ? "#fbbf24" : (VERDICT_COLOR[verdict] ?? "#334155")}55`,
          }}
          title={
            isCrypto
              ? "Crypto is not scored on filings — this is where it sits against the price the network paid."
              : sig.hint
          }
        >
          {isCrypto ? cryptoLabel : sig.headline}
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
          {headline && (
            <div className="flex items-start gap-1.5">
              <span
                className="mt-[5px] h-1 w-1 shrink-0 rounded-full"
                style={{ background: TONE_COLOR[headline.tone] }}
              />
              <span className="text-[var(--muted)]">{headline.text}</span>
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
    </div>
  );
}
