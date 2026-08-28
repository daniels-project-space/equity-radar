"use client";

import Link from "next/link";
import { usd, bigUsd, signedPct, pct, mult, multOrNm, scoreColor } from "@/lib/format";

export type Method = { key: string; label: string; perShare: number; weight: number; basis: string };
export type Pillar = { key: string; label: string; level?: number; trend?: number; evidence: string };
export type PeerRow = {
  ticker: string;
  name: string;
  marketCap?: number;
  revYoY?: number;
  grossMarginPct?: number;
  fwdPe?: number;
  moatScore?: number;
  asymmetry?: number;
  upside?: number;
};

/**
 * Each valuation method as a bar against the current price. The spread between
 * bars *is* the uncertainty — seeing them side by side communicates that far
 * faster than a dispersion number does.
 */
export function MethodBars({ methods, price }: { methods: Method[]; price?: number }) {
  if (methods.length === 0) {
    return <p className="text-[11px] text-[var(--muted)]">Not computable from filed data.</p>;
  }
  const max = Math.max(...methods.map((m) => m.perShare), price ?? 0) * 1.05;

  return (
    <div className="space-y-2.5">
      {methods.map((m) => {
        const above = price !== undefined && m.perShare >= price;
        return (
          <div key={m.key}>
            <div className="mb-1 flex items-baseline justify-between gap-2 text-[11px]">
              <span>
                {m.label}
                <span className="ml-1.5 text-[10px] text-[var(--muted)]">
                  {Math.round(m.weight * 100)}%
                </span>
              </span>
              <span className="tabular" style={{ color: above ? "var(--good)" : "var(--muted)" }}>
                {usd(m.perShare)}
              </span>
            </div>
            <div className="relative h-1.5 overflow-hidden rounded-full bg-[var(--panel-2)]">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${(m.perShare / max) * 100}%`,
                  background: above ? "var(--good)" : "var(--muted)",
                  opacity: 0.55 + m.weight * 0.45,
                }}
              />
              {price !== undefined && (
                <div
                  className="absolute inset-y-0 w-px bg-[var(--accent)]"
                  style={{ left: `${(price / max) * 100}%` }}
                  title={`price ${usd(price)}`}
                />
              )}
            </div>
            <p className="mt-0.5 text-[9px] leading-snug text-[var(--muted)]">{m.basis}</p>
          </div>
        );
      })}
      <p className="pt-0.5 text-[9px] text-[var(--muted)]">
        Blue line is the current price. Bars past it imply upside.
      </p>
    </div>
  );
}

/** Moat pillars ranked strongest to weakest, so the weak point is obvious. */
export function PillarBars({ pillars }: { pillars: Pillar[] }) {
  const ranked = [...pillars]
    .filter((p) => p.level !== undefined)
    .sort((a, b) => (b.level as number) - (a.level as number));
  if (ranked.length === 0) {
    return <p className="text-[11px] text-[var(--muted)]">Needs eight quarters of filings.</p>;
  }

  return (
    <div className="space-y-2">
      {ranked.map((p) => (
        <div key={p.key} title={p.evidence}>
          <div className="mb-0.5 flex items-baseline justify-between gap-2 text-[11px]">
            <span>
              {p.label}
              {p.trend !== undefined && (
                <span
                  className="ml-1"
                  style={{
                    color:
                      p.trend >= 15 ? "var(--good)" : p.trend <= -15 ? "var(--bad)" : "var(--muted)",
                  }}
                >
                  {p.trend >= 15 ? "↑" : p.trend <= -15 ? "↓" : "→"}
                </span>
              )}
            </span>
            <span className="tabular" style={{ color: scoreColor(p.level) }}>
              {Math.round(p.level as number)}
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-[var(--panel-2)]">
            <div
              className="h-full rounded-full"
              style={{ width: `${p.level}%`, background: scoreColor(p.level) }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Reported growth against what management is guiding to. Two bars make the
 * direction of travel immediate in a way two percentages do not.
 */
export function Projections({
  revYoY,
  guidedGrowth,
  guidancePeriod,
  guidanceRevLow,
  guidanceRevHigh,
  guidanceEpsLow,
  guidanceEpsHigh,
  fwdPe,
  peTtm,
  fwdEpsBasis,
  sourceUrl,
}: {
  revYoY?: number;
  guidedGrowth?: number;
  guidancePeriod?: string;
  guidanceRevLow?: number;
  guidanceRevHigh?: number;
  guidanceEpsLow?: number;
  guidanceEpsHigh?: number;
  fwdPe?: number;
  peTtm?: number;
  fwdEpsBasis?: string;
  sourceUrl?: string;
}) {
  const hasGuide = guidedGrowth !== undefined;
  const scale = Math.max(Math.abs(revYoY ?? 0), Math.abs(guidedGrowth ?? 0), 0.1) * 1.15;
  const bar = (v?: number) => (v === undefined ? 0 : Math.min(100, (Math.abs(v) / scale) * 100));

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <GrowthBar label="Reported" value={revYoY} width={bar(revYoY)} />
        {hasGuide ? (
          <GrowthBar label={`Guided ${guidancePeriod ?? ""}`} value={guidedGrowth} width={bar(guidedGrowth)} />
        ) : (
          <p className="text-[10px] text-[var(--muted)]">
            No guidance found in the latest earnings release.
          </p>
        )}
      </div>

      {hasGuide && revYoY !== undefined && (
        <p className="text-[10px] leading-snug text-[var(--muted)]">
          Management is guiding to{" "}
          <span style={{ color: guidedGrowth >= revYoY ? "var(--good)" : "var(--bad)" }}>
            {guidedGrowth >= revYoY ? "acceleration" : "deceleration"}
          </span>{" "}
          of {Math.abs((guidedGrowth - revYoY) * 100).toFixed(1)}pp. This feeds the growth score.
        </p>
      )}

      <div className="space-y-1 border-t border-[var(--line)] pt-2 text-[11px]">
        {guidanceRevLow !== undefined && (
          <Line label="Guided revenue">
            {bigUsd(guidanceRevLow)}
            {guidanceRevHigh !== undefined && guidanceRevHigh !== guidanceRevLow
              ? `–${bigUsd(guidanceRevHigh)}`
              : ""}
          </Line>
        )}
        {guidanceEpsLow !== undefined && (
          <Line label="Guided EPS">
            {usd(guidanceEpsLow)}
            {guidanceEpsHigh !== undefined && guidanceEpsHigh !== guidanceEpsLow
              ? `–${usd(guidanceEpsHigh)}`
              : ""}
          </Line>
        )}
        <Line label="P/E trailing → forward">
          {mult(peTtm)} → <span className="text-[var(--text)]">{mult(fwdPe)}</span>
        </Line>
      </div>

      {fwdEpsBasis && fwdEpsBasis !== "consensus" && (
        <p className="text-[9px] leading-snug text-[var(--muted)]">
          Forward EPS is {fwdEpsBasis}, not analyst consensus.
          {sourceUrl && (
            <>
              {" "}
              <a href={sourceUrl} target="_blank" rel="noreferrer" className="underline">
                source
              </a>
            </>
          )}
        </p>
      )}
    </div>
  );
}

function GrowthBar({ label, value, width }: { label: string; value?: number; width: number }) {
  const positive = (value ?? 0) >= 0;
  return (
    <div>
      <div className="mb-0.5 flex items-baseline justify-between text-[11px]">
        <span className="text-[var(--muted)]">{label}</span>
        <span className="tabular" style={{ color: positive ? "var(--good)" : "var(--bad)" }}>
          {signedPct(value)}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-[var(--panel-2)]">
        <div
          className="h-full rounded-full"
          style={{ width: `${width}%`, background: positive ? "var(--good)" : "var(--bad)" }}
        />
      </div>
    </div>
  );
}

const Line = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="flex items-baseline justify-between gap-2">
    <span className="text-[var(--muted)]">{label}</span>
    <span className="tabular">{children}</span>
  </div>
);

/**
 * Closest competitors by size within the same industry, with this company
 * inlined so every column is a direct comparison rather than a lookup.
 */
export function PeerTable({
  rows,
  self,
}: {
  rows: PeerRow[];
  self: PeerRow;
}) {
  if (rows.length === 0) {
    return (
      <p className="text-[11px] leading-snug text-[var(--muted)]">
        No scored companies share this industry yet. Add competitors to the watchlist and they
        appear here — comparisons are never computed from a sample this thin.
      </p>
    );
  }

  const all = [self, ...rows];
  const best = {
    revYoY: Math.max(...all.map((r) => r.revYoY ?? -99)),
    grossMarginPct: Math.max(...all.map((r) => r.grossMarginPct ?? -99)),
    moatScore: Math.max(...all.map((r) => r.moatScore ?? -99)),
    asymmetry: Math.max(...all.map((r) => r.asymmetry ?? -99)),
  };

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[520px] text-[11px] tabular">
        <thead className="text-[9px] uppercase tracking-wider text-[var(--muted)]">
          <tr className="border-b border-[var(--line)]">
            <th className="py-1.5 text-left font-medium">Company</th>
            <th className="py-1.5 text-right font-medium">Size</th>
            <th className="py-1.5 text-right font-medium">Growth</th>
            <th className="py-1.5 text-right font-medium">GM</th>
            <th className="py-1.5 text-right font-medium">P/E</th>
            <th className="py-1.5 text-right font-medium">Moat</th>
            <th className="py-1.5 text-right font-medium">Asym</th>
          </tr>
        </thead>
        <tbody>
          {all.map((r, i) => {
            const isSelf = i === 0;
            return (
              <tr
                key={r.ticker}
                className="border-b border-[var(--line)] last:border-0"
                style={isSelf ? { background: "var(--panel-2)" } : undefined}
              >
                <td className="py-1.5 pr-2">
                  {isSelf ? (
                    <span className="font-semibold">{r.ticker}</span>
                  ) : (
                    <Link href={`/c/${r.ticker}`} className="hover:underline">
                      {r.ticker}
                    </Link>
                  )}
                  <span className="ml-1.5 hidden text-[10px] text-[var(--muted)] sm:inline">
                    {r.name.length > 22 ? `${r.name.slice(0, 22)}…` : r.name}
                  </span>
                </td>
                <td className="py-1.5 text-right text-[var(--muted)]">{bigUsd(r.marketCap)}</td>
                <Cell value={signedPct(r.revYoY)} best={r.revYoY === best.revYoY} />
                <Cell value={pct(r.grossMarginPct, 0)} best={r.grossMarginPct === best.grossMarginPct} />
                <td className="py-1.5 text-right">{multOrNm(r.fwdPe, 120)}</td>
                <Cell
                  value={r.moatScore === undefined ? "—" : String(Math.round(r.moatScore))}
                  best={r.moatScore === best.moatScore}
                />
                <Cell
                  value={r.asymmetry === undefined ? "—" : String(Math.round(r.asymmetry))}
                  best={r.asymmetry === best.asymmetry}
                />
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="mt-2 text-[9px] leading-snug text-[var(--muted)]">
        Closest by market-cap similarity within the same SIC industry. Green marks the best value in
        each column.
      </p>
    </div>
  );
}

const Cell = ({ value, best }: { value: string; best: boolean }) => (
  <td className="py-1.5 text-right" style={best ? { color: "var(--good)" } : undefined}>
    {value}
  </td>
);

export type ExpectationsData = {
  impliedGrowth: number;
  referenceGrowth?: number;
  horizonYears: number;
  discountRate: number;
  verdict: "undemanding" | "in line" | "demanding" | "heroic" | "unpriceable";
  summary: string;
  gap?: number;
};

const EXP_COLOR: Record<string, string> = {
  undemanding: "var(--good)",
  "in line": "var(--good)",
  demanding: "var(--warn)",
  heroic: "var(--bad)",
  unpriceable: "var(--muted)",
};

/**
 * What the price already assumes, rather than what the model thinks it is worth.
 *
 * This is the panel to read when everything looks expensive at once. A fair
 * value says "no" to the whole market in the same breath; the bar below says
 * how far today's price is reaching beyond what the business has actually
 * delivered — which still discriminates between names when nothing is cheap.
 */
export function ExpectationsPanel({ data }: { data: ExpectationsData }) {
  const unpriceable = data.verdict === "unpriceable";
  // Scale both bars against the larger of the two so the comparison is honest.
  const span = Math.max(Math.abs(data.impliedGrowth), Math.abs(data.referenceGrowth ?? 0), 5);

  return (
    <section className="panel p-4">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[11px] uppercase tracking-wider text-[var(--muted)]">
          What the price assumes
        </h2>
        <span
          className="text-[10px] font-medium uppercase tracking-wider"
          style={{ color: EXP_COLOR[data.verdict] }}
        >
          {data.verdict}
        </span>
      </div>

      {!unpriceable && (
        <div className="mb-3 space-y-2">
          <ExpectationRateBar
            label="Priced in"
            value={data.impliedGrowth}
            span={span}
            color={EXP_COLOR[data.verdict]}
          />
          {data.referenceGrowth !== undefined && (
            <ExpectationRateBar
              label="Delivered"
              value={data.referenceGrowth}
              span={span}
              color="var(--muted)"
            />
          )}
        </div>
      )}

      <p className="text-[11px] leading-relaxed text-[var(--muted)]">{data.summary}</p>

      {!unpriceable && (
        <p className="mt-2 border-t border-[var(--line)] pt-2 text-[10px] leading-relaxed text-[var(--muted)]">
          A high multiple is not the same thing as a bad price. What matters is whether the growth
          being paid for is growth this business has shown it can produce — so this stays readable
          when every name on the list looks expensive at once.
        </p>
      )}
    </section>
  );
}

function ExpectationRateBar({
  label,
  value,
  span,
  color,
}: {
  label: string;
  value: number;
  span: number;
  color: string;
}) {
  const w = Math.min(100, (Math.abs(value) / span) * 100);
  return (
    <div className="flex items-center gap-2.5">
      <span className="w-16 shrink-0 text-[10px] text-[var(--muted)]">{label}</span>
      <div className="relative h-3 flex-1 overflow-hidden rounded-sm bg-[var(--line)]">
        <div
          className="absolute inset-y-0 left-0 rounded-sm"
          style={{ width: `${w}%`, background: color, opacity: 0.75 }}
        />
      </div>
      <span className="tabular w-14 shrink-0 text-right text-[11px]">{value}%</span>
    </div>
  );
}
