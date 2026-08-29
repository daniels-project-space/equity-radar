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

export type ProjectionRow = {
  years: number;
  total: number;
  annualised: number;
  low: number;
  high: number;
};

/**
 * Expected return from today's price over one, three and five years.
 *
 * Shown as a range rather than a number because the spread is the honest part:
 * the difference between the low and high cases is mostly the question of
 * whether the discount ever closes, which no model here can answer.
 */
export function ReturnOutlook({
  rows,
  price,
  basis,
}: {
  rows: ProjectionRow[];
  price?: number;
  basis?: string;
}) {
  const span = Math.max(...rows.map((r) => Math.abs(r.high)), 10);

  return (
    <section className="panel p-4">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[11px] uppercase tracking-wider text-[var(--muted)]">
          If you bought at {price ? usd(price) : "today's price"}
        </h2>
        <span className="text-[10px] text-[var(--muted)]">total return, range</span>
      </div>

      <div className="space-y-2.5">
        {rows.map((r) => (
          <div key={r.years} className="flex items-center gap-3">
            <span className="w-9 shrink-0 text-[11px] text-[var(--muted)]">{r.years}y</span>
            <div className="relative h-4 flex-1 rounded-sm bg-[var(--line)]">
              <div
                className="absolute inset-y-0 rounded-sm opacity-40"
                style={{
                  left: `${((Math.min(r.low, 0) + span) / (2 * span)) * 100}%`,
                  width: `${((Math.max(r.high, r.low) - Math.min(r.low, r.high)) / (2 * span)) * 100}%`,
                  background: r.total >= 0 ? "var(--good)" : "var(--bad)",
                }}
              />
              <div
                className="absolute inset-y-0 w-[2px]"
                style={{
                  left: `${((r.total + span) / (2 * span)) * 100}%`,
                  background: r.total >= 0 ? "var(--good)" : "var(--bad)",
                }}
              />
              <div
                className="absolute inset-y-0 w-px bg-[var(--muted)] opacity-50"
                style={{ left: "50%" }}
              />
            </div>
            <span
              className="tabular w-16 shrink-0 text-right text-[12px] font-semibold"
              style={{ color: r.total >= 0 ? "var(--good)" : "var(--bad)" }}
            >
              {r.total >= 0 ? "+" : ""}
              {r.total}%
            </span>
            <span className="tabular w-14 shrink-0 text-right text-[10px] text-[var(--muted)]">
              {r.annualised >= 0 ? "+" : ""}
              {r.annualised}%/yr
            </span>
          </div>
        ))}
      </div>

      <p className="mt-3 border-t border-[var(--line)] pt-2 text-[10px] leading-relaxed text-[var(--muted)]">
        A scenario, not a forecast. Fair value compounds at the growth the filings support — faded
        toward a terminal rate, capped by the moat, and net of shares issued — and the gap to fair
        value is assumed to close over about three years. The shaded range is the difference between
        that discount never closing and it closing with growth at the top of its range, which is the
        part no model here can settle.
      </p>
      {basis && (
        <p className="mt-1.5 text-[10px] leading-relaxed text-[var(--muted)]">
          <span className="text-[var(--text)]">Growth basis:</span> {basis}
        </p>
      )}
    </section>
  );
}

export type CycleData = {
  mvrvZ?: number;
  nupl?: number;
  sopr?: number;
  realizedPrice?: number;
  mvrvRatio?: number;
  percentile?: number;
  zone: string;
  tsmsv?: number;
  summary: string;
  caveat: string;
};

const ZONE_COLOR: Record<string, string> = {
  capitulation: "var(--good)",
  accumulation: "var(--good)",
  "mid-cycle": "var(--muted)",
  extended: "var(--warn)",
  euphoric: "var(--bad)",
  unknown: "var(--muted)",
};

/**
 * Where a crypto asset sits against what the network actually paid.
 *
 * This replaces the valuation panel rather than sitting beside it, because
 * there is no cash flow to discount and pretending otherwise would be the
 * whole error. The cost basis is the only anchor crypto has.
 */
export function CyclePanel({ data, price }: { data: CycleData; price?: number }) {
  const pct = data.percentile;
  return (
    <section className="panel p-4">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[11px] uppercase tracking-wider text-[var(--muted)]">
          Cycle position
        </h2>
        <span
          className="text-[10px] font-medium uppercase tracking-wider"
          style={{ color: ZONE_COLOR[data.zone] ?? "var(--muted)" }}
        >
          {data.zone}
        </span>
      </div>

      {pct !== undefined && (
        <div className="mb-3">
          <div className="relative h-5 overflow-hidden rounded-sm bg-[var(--line)]">
            <div
              className="absolute inset-y-0 left-0 opacity-30"
              style={{ width: `${pct * 100}%`, background: ZONE_COLOR[data.zone] }}
            />
            <div
              className="absolute inset-y-0 w-[2px]"
              style={{ left: `${pct * 100}%`, background: ZONE_COLOR[data.zone] }}
            />
          </div>
          <div className="mt-1 flex justify-between text-[9px] text-[var(--muted)]">
            <span>capitulation</span>
            <span>{Math.round(pct * 100)}th percentile of its own history</span>
            <span>euphoria</span>
          </div>
        </div>
      )}

      <dl className="mb-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-[11px]">
        {data.realizedPrice !== undefined && (
          <Row label="Network cost basis" value={usd(data.realizedPrice)} />
        )}
        {data.mvrvRatio !== undefined && (
          <Row label="Price vs cost basis" value={`${data.mvrvRatio.toFixed(2)}x`} />
        )}
        {data.mvrvZ !== undefined && <Row label="MVRV Z-score" value={data.mvrvZ.toFixed(2)} />}
        {data.nupl !== undefined && (
          <Row label="Unrealised profit" value={`${(data.nupl * 100).toFixed(0)}%`} />
        )}
        {data.sopr !== undefined && <Row label="SOPR" value={data.sopr.toFixed(3)} />}
        {data.tsmsv !== undefined && (
          <Row label="Momentum / volatility" value={data.tsmsv.toFixed(2)} />
        )}
      </dl>

      <p className="text-[11px] leading-relaxed text-[var(--muted)]">{data.summary}</p>

      <p className="mt-2 border-t border-[var(--line)] pt-2 text-[10px] leading-relaxed" style={{ color: "var(--warn)" }}>
        {data.caveat}
      </p>
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-[var(--muted)]">{label}</dt>
      <dd className="tabular text-right">{value}</dd>
    </>
  );
}

export type RangeData = {
  low: number;
  high: number;
  position: number;
  fromHigh: number;
  fromLow: number;
  sessions: number;
  bandCoverage?: number;
  sessionsInBand?: number;
  retracements: { label: string; price: number }[];
  note?: string;
};

/**
 * The range the asset has actually traded in, alongside how much of it the
 * valuation speaks to.
 *
 * Sits next to the valuation rather than inside it, because the two answer
 * different questions and the useful moment is when they disagree.
 */
export function RangePanel({ data, price }: { data: RangeData; price?: number }) {
  const pos = Math.max(0, Math.min(100, data.position));

  return (
    <section className="panel p-4">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[11px] uppercase tracking-wider text-[var(--muted)]">
          Where it sits in its own range
        </h2>
        <span className="text-[10px] text-[var(--muted)]">{data.sessions} sessions</span>
      </div>

      <div className="mb-1 relative h-6 rounded-sm bg-[var(--line)]">
        <div
          className="absolute inset-y-0 left-0 rounded-sm opacity-25"
          style={{ width: `${pos}%`, background: "var(--accent)" }}
        />
        <div
          className="absolute inset-y-0 w-[2px] bg-[var(--accent)]"
          style={{ left: `${pos}%` }}
        />
        {/* Retracement landmarks, drawn faintly — see lib/range-context.ts for
            why they are not treated as levels where anything should happen. */}
        {data.retracements.map((r) => {
          const at = ((r.price - data.low) / (data.high - data.low)) * 100;
          if (at < 2 || at > 98) return null;
          return (
            <div
              key={r.label}
              className="absolute inset-y-0 w-px bg-[var(--muted)] opacity-30"
              style={{ left: `${at}%` }}
              title={`${r.label} retracement — ${usd(r.price)}`}
            />
          );
        })}
      </div>
      <div className="mb-3 flex justify-between text-[10px] text-[var(--muted)]">
        <span>{usd(data.low)}</span>
        <span className="text-[var(--text)]">
          {Math.round(pos)}% of range{price ? ` · ${usd(price)}` : ""}
        </span>
        <span>{usd(data.high)}</span>
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[11px]">
        <dt className="text-[var(--muted)]">From the high</dt>
        <dd className="tabular text-right" style={{ color: "var(--bad)" }}>
          {data.fromHigh}%
        </dd>
        <dt className="text-[var(--muted)]">From the low</dt>
        <dd className="tabular text-right" style={{ color: "var(--good)" }}>
          +{data.fromLow}%
        </dd>
        {data.bandCoverage !== undefined && (
          <>
            <dt className="text-[var(--muted)]">Range the zones cover</dt>
            <dd className="tabular text-right">{data.bandCoverage}%</dd>
          </>
        )}
        {data.sessionsInBand !== undefined && (
          <>
            <dt className="text-[var(--muted)]">Sessions inside the zones</dt>
            <dd className="tabular text-right">{data.sessionsInBand}%</dd>
          </>
        )}
      </dl>

      {data.note && (
        <p className="mt-2.5 border-t border-[var(--line)] pt-2 text-[10px] leading-relaxed text-[var(--warn)]">
          {data.note}
        </p>
      )}

      <p className="mt-2 text-[10px] leading-relaxed text-[var(--muted)]">
        The faint marks are Fibonacci retracements of this range. They are drawn as landmarks, not
        as levels where price is expected to turn: tested across the Dow, NASDAQ and DAX, the odds
        of a bounce on a Fibonacci zone were statistically indistinguishable from a randomly chosen
        level, and this project&rsquo;s own tournament scored the 38&ndash;62% zone at &minus;5.4pp
        against buy-and-hold.
      </p>
    </section>
  );
}

export type ProfileData = {
  poc: number;
  vah: number;
  val: number;
  rows: { price: number; weight: number }[];
  highVolumeNodes: number[];
  lowVolumeNodes: number[];
  basis: "volume" | "time";
  location: string;
  summary: string;
};

/**
 * Where trade actually concentrated, as a sideways histogram.
 *
 * Included because it is measured rather than chosen — the point of control is
 * the mode of the distribution, not a level anyone drew. Whether that makes it
 * useful for timing is a separate question, and the answer below is no.
 */
export function ProfilePanel({ data, price }: { data: ProfileData; price?: number }) {
  const max = Math.max(...data.rows.map((r) => r.weight), 0.0001);
  const lo = data.rows[0]?.price ?? 0;
  const hi = data.rows[data.rows.length - 1]?.price ?? 1;
  const at = (p: number) => ((p - lo) / (hi - lo)) * 100;

  return (
    <section className="panel p-4">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[11px] uppercase tracking-wider text-[var(--muted)]">
          {data.basis === "volume" ? "Volume profile" : "Time profile"}
        </h2>
        <span className="text-[10px] text-[var(--muted)]">{data.location}</span>
      </div>

      {/* Rows run bottom-up so price increases upward, matching the chart. */}
      <div className="relative mb-2 flex h-[150px] flex-col-reverse gap-px">
        {data.rows.map((r, i) => {
          const inValue = r.price >= data.val && r.price <= data.vah;
          const isPoc = Math.abs(r.price - data.poc) < (hi - lo) / data.rows.length;
          return (
            <div key={i} className="flex flex-1 items-center gap-1">
              <div
                className="h-full rounded-r-[1px]"
                style={{
                  width: `${(r.weight / max) * 100}%`,
                  background: isPoc ? "var(--accent)" : inValue ? "var(--good)" : "var(--line)",
                  opacity: isPoc ? 0.9 : inValue ? 0.45 : 0.5,
                }}
              />
            </div>
          );
        })}
        {price !== undefined && at(price) >= 0 && at(price) <= 100 && (
          <div
            className="pointer-events-none absolute inset-x-0 h-px bg-[var(--text)]"
            style={{ bottom: `${at(price)}%` }}
            title={`Price ${usd(price)}`}
          />
        )}
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[11px]">
        <dt className="text-[var(--muted)]">Value area high</dt>
        <dd className="tabular text-right">{usd(data.vah)}</dd>
        <dt style={{ color: "var(--accent)" }}>Point of control</dt>
        <dd className="tabular text-right" style={{ color: "var(--accent)" }}>
          {usd(data.poc)}
        </dd>
        <dt className="text-[var(--muted)]">Value area low</dt>
        <dd className="tabular text-right">{usd(data.val)}</dd>
      </dl>

      <p className="mt-2.5 text-[11px] leading-relaxed text-[var(--muted)]">{data.summary}</p>

      <p className="mt-2 border-t border-[var(--line)] pt-2 text-[10px] leading-relaxed text-[var(--muted)]">
        These levels are computed from where trade concentrated, not drawn by hand — which makes
        them a better class of reference than most lines on a chart. It does not make them a signal.
        Tested as entry rules against buy-and-hold across thirteen names and four periods, buying
        below the value area scored &minus;23pp and buying back inside it &minus;28pp, both among
        the worst of the eighteen rules tried. Read this as a map of where business happened.
      </p>
    </section>
  );
}

export type ScenarioData = {
  scenarios: { key: string; label: string; fairValue: number; upside: number; condition: string }[];
  price: number;
  payoffRatio?: number;
  convex: boolean;
  summary: string;
};

export type LinkageData = {
  primary?: { driver: string; beta: number; rSquared: number; assetVol: number; driverVol: number };
  all: { driver: string; beta: number; rSquared: number }[];
  summary: string;
};

const SCEN_COLOR: Record<string, string> = {
  bear: "var(--bad)",
  base: "var(--muted)",
  bull: "var(--good)",
};

/**
 * The three cases and what each requires.
 *
 * Replaces a single number where a single number misleads. Conditions are
 * stated instead of probabilities because "28% growth held for nine years" can
 * be checked against the world and "a 20% chance" cannot.
 */
export function ScenarioPanel({ data }: { data: ScenarioData }) {
  const span = Math.max(...data.scenarios.map((s) => Math.abs(s.upside)), 20);

  return (
    <section className="panel p-4">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[11px] uppercase tracking-wider text-[var(--muted)]">
          What it is worth if
        </h2>
        {data.payoffRatio !== undefined && (
          <span className="text-[10px] text-[var(--muted)]">
            {data.payoffRatio}:1 upside against downside
          </span>
        )}
      </div>

      <div className="mb-3 space-y-2.5">
        {data.scenarios.map((s) => (
          <div key={s.key}>
            <div className="mb-0.5 flex items-baseline justify-between gap-2 text-[11px]">
              <span style={{ color: SCEN_COLOR[s.key] }}>{s.label}</span>
              <span className="tabular">
                {usd(s.fairValue)}
                <span
                  className="ml-2 font-semibold"
                  style={{ color: s.upside >= 0 ? "var(--good)" : "var(--bad)" }}
                >
                  {s.upside >= 0 ? "+" : ""}
                  {s.upside}%
                </span>
              </span>
            </div>
            <div className="relative h-1.5 rounded-sm bg-[var(--line)]">
              <div
                className="absolute inset-y-0 w-px bg-[var(--muted)] opacity-60"
                style={{ left: "50%" }}
              />
              <div
                className="absolute inset-y-0 rounded-sm"
                style={{
                  left: s.upside >= 0 ? "50%" : `${50 + (s.upside / span) * 50}%`,
                  width: `${(Math.abs(s.upside) / span) * 50}%`,
                  background: SCEN_COLOR[s.key],
                  opacity: 0.7,
                }}
              />
            </div>
            <p className="mt-1 text-[10px] leading-snug text-[var(--muted)]">{s.condition}</p>
          </div>
        ))}
      </div>

      <p
        className="border-t border-[var(--line)] pt-2 text-[10px] leading-relaxed"
        style={{ color: data.convex ? "var(--warn)" : "var(--muted)" }}
      >
        {data.summary}
      </p>
    </section>
  );
}

/**
 * What the asset actually tracks.
 *
 * The valuation reads filings and therefore cannot see that a company is a
 * levered claim on something else. This measures it instead of asserting it.
 */
export function LinkagePanel({ data }: { data: LinkageData }) {
  const p = data.primary;
  return (
    <section className="panel p-4">
      <h2 className="mb-2 text-[11px] uppercase tracking-wider text-[var(--muted)]">
        What it trades on
      </h2>

      <div className="mb-2.5 space-y-1.5">
        {data.all.slice(0, 3).map((l) => (
          <div key={l.driver} className="flex items-center gap-2.5">
            <span className="w-24 shrink-0 text-[11px]">{l.driver}</span>
            <div className="relative h-2.5 flex-1 rounded-sm bg-[var(--line)]">
              <div
                className="absolute inset-y-0 left-0 rounded-sm"
                style={{
                  width: `${Math.min(100, l.rSquared * 100)}%`,
                  background: l.rSquared >= 0.25 ? "var(--accent)" : "var(--muted)",
                  opacity: l.rSquared >= 0.25 ? 0.8 : 0.4,
                }}
              />
            </div>
            <span className="tabular w-24 shrink-0 text-right text-[10px] text-[var(--muted)]">
              {Math.round(l.rSquared * 100)}% · {l.beta.toFixed(2)}x
            </span>
          </div>
        ))}
      </div>

      <p className="text-[11px] leading-relaxed text-[var(--muted)]">{data.summary}</p>

      {p && p.beta > 1.3 && (
        <p className="mt-2 border-t border-[var(--line)] pt-2 text-[10px] leading-relaxed text-[var(--warn)]">
          At {p.beta.toFixed(2)}x, a 30% fall in {p.driver} implies roughly{" "}
          {Math.round(30 * p.beta)}% here. The leverage that explains the premium is the same
          leverage that removes it.
        </p>
      )}
    </section>
  );
}
