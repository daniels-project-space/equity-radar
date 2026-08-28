"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { usd, signedPct } from "@/lib/format";
import { DcaWidget } from "@/components/dca-widget";
import { DIP_LABEL } from "@/lib/dip-labels";

type Point = { date: string; deposited: number; value: number; cash: number; benchmark: number };
type Trade = { date: string; ticker: string; side: "buy" | "sell"; amount: number; depth: number };
type Sim = {
  series: Point[];
  trades: Trade[];
  deposited: number;
  finalValue: number;
  returnPct: number;
  benchmarkReturnPct: number;
  cashPct: number;
  tradeCount: number;
  perTicker: { ticker: string; invested: number; value: number; shares: number }[];
};

/**
 * Contributions vs portfolio value vs benchmark, all as a percentage of money
 * put in — the only framing where a DCA curve is readable, since the absolute
 * amount rises every period regardless of performance.
 */
function Curve({ series }: { series: Point[] }) {
  if (series.length < 2) return null;
  const w = 900;
  const h = 240;
  const pad = { l: 6, r: 6, t: 10, b: 6 };

  const ratios = series.flatMap((p) => [
    p.value / p.deposited,
    p.benchmark > 0 ? p.benchmark / p.deposited : 1,
  ]);
  const min = Math.min(1, ...ratios) * 0.98;
  const max = Math.max(1, ...ratios) * 1.02;
  const span = max - min || 1;

  const x = (i: number) => pad.l + (i / (series.length - 1)) * (w - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - (v - min) / span) * (h - pad.t - pad.b);

  const path = (get: (p: Point) => number) =>
    series
      .map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(get(p)).toFixed(1)}`)
      .join(" ");

  const strategy = path((p) => p.value / p.deposited);
  const bench = path((p) => (p.benchmark > 0 ? p.benchmark / p.deposited : 1));
  const breakEven = y(1);

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full" style={{ height: h }}>
      <line x1={pad.l} x2={w - pad.r} y1={breakEven} y2={breakEven} stroke="var(--line)" strokeDasharray="3 3" />
      <text x={pad.l + 2} y={breakEven - 4} className="fill-[var(--muted)] text-[9px]">
        break even
      </text>
      <path d={bench} fill="none" stroke="var(--muted)" strokeWidth="1.2" strokeDasharray="4 3" />
      <path d={strategy} fill="none" stroke="var(--accent)" strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  );
}

type BucketStat = {
  signal: string;
  bucket: string;
  n: number;
  effectiveN: number;
  median30: number;
  median60: number;
  hit30: number;
  edge30: number;
  tStat: number;
  confidence: number;
  significant: boolean;
  multiplier: number;
};

type Calib = {
  signals: { signal: string; buckets: BucketStat[]; spread: number; maxAbsT: number; useful: boolean }[];
  baseline30: number;
  observations: number;
  inconclusive: boolean;
  testsRun: number;
  criticalT: number;
  method: string;
};

const SIGNAL_LABEL: Record<string, string> = {
  trend: "Position vs long trend",
  drawdown: "Drawdown from high",
  volume: "Volume regime",
  momentum: "60-day momentum",
  rsi: "Short-term stretch",
  dipState: "Dip state machine",
};

/**
 * What each signal was actually worth.
 *
 * This panel exists to make the indicators falsifiable, so it is deliberately
 * blunt about weak evidence: a bucket whose edge does not clear the corrected
 * noise floor is shown as such and left at 1.00x rather than quietly tuned.
 */
function CalibrationPanel() {
  const calib = useQuery(api.allocation.calibration);
  const [open, setOpen] = useState<string | null>(null);
  const r = calib?.result as Calib | undefined;
  if (!r?.signals?.length) return null;

  return (
    <section className="panel p-4">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[11px] uppercase tracking-wider text-[var(--muted)]">
          Signal calibration
        </h2>
        <span className="text-[10px] text-[var(--muted)]">
          {r.observations} readings · baseline 30d {r.baseline30}%
        </span>
      </div>

      <p className="mb-3 text-[11px] leading-snug text-[var(--muted)]">
        Every indicator tested against its own forward returns, on equal footing.{" "}
        <span className="text-[var(--fg)]">Spread</span> is the gap between the best and worst
        bucket; <span className="text-[var(--fg)]">max |t|</span> is the strongest edge in standard
        errors, after discounting for overlapping windows and for the {r.testsRun} buckets under
        test. A signal has to clear |t| = {r.criticalT} to move an allocation at all.
      </p>

      <div className="space-y-1">
        {r.signals.map((s) => {
          const isOpen = open === s.signal;
          return (
            <div key={s.signal} className="border-b border-[var(--line)] last:border-0">
              <button
                onClick={() => setOpen(isOpen ? null : s.signal)}
                className="flex w-full items-center justify-between gap-3 py-2 text-left text-[11px] hover:opacity-80"
              >
                <span className="flex items-center gap-2">
                  <span
                    className="inline-block h-1.5 w-1.5 rounded-full"
                    style={{ background: s.useful ? "var(--good)" : "var(--line)" }}
                  />
                  {SIGNAL_LABEL[s.signal] ?? s.signal}
                </span>
                <span className="flex shrink-0 items-center gap-3 tabular text-[10px] text-[var(--muted)]">
                  <span>spread {s.spread}pp</span>
                  <span style={{ color: s.useful ? "var(--good)" : undefined }}>
                    max |t| {s.maxAbsT}
                  </span>
                  <span className="w-3 text-center">{isOpen ? "\u2212" : "+"}</span>
                </span>
              </button>

              {isOpen && (
                <div className="overflow-x-auto pb-2">
                  <table className="w-full min-w-[400px] text-[11px] tabular">
                    <thead className="text-[9px] uppercase tracking-wider text-[var(--muted)]">
                      <tr>
                        <th className="py-1 text-left font-medium">Bucket</th>
                        <th className="py-1 text-right font-medium">N</th>
                        <th className="py-1 text-right font-medium">Ind.</th>
                        <th className="py-1 text-right font-medium">30d</th>
                        <th className="py-1 text-right font-medium">60d</th>
                        <th className="py-1 text-right font-medium">Hit</th>
                        <th className="py-1 text-right font-medium">Edge</th>
                        <th className="py-1 text-right font-medium">t</th>
                        <th className="py-1 text-right font-medium">Weight</th>
                      </tr>
                    </thead>
                    <tbody>
                      {s.buckets.map((b) => (
                        <tr key={b.bucket} className="border-t border-[var(--line)]">
                          <td className="py-1 whitespace-nowrap">
                            {s.signal === "dipState" ? (DIP_LABEL[b.bucket] ?? b.bucket) : b.bucket}
                          </td>
                          <td className="py-1 text-right text-[var(--muted)]">{b.n}</td>
                          <td className="py-1 text-right text-[var(--muted)]">{b.effectiveN}</td>
                          <td className="py-1 text-right">{b.median30}%</td>
                          <td className="py-1 text-right text-[var(--muted)]">{b.median60}%</td>
                          <td className="py-1 text-right text-[var(--muted)]">{b.hit30}%</td>
                          <td
                            className="py-1 text-right"
                            style={{ color: b.edge30 >= 0 ? "var(--good)" : "var(--bad)" }}
                          >
                            {b.edge30 >= 0 ? "+" : ""}
                            {b.edge30}pp
                          </td>
                          <td
                            className="py-1 text-right"
                            style={{ color: b.significant ? "var(--fg)" : "var(--muted)" }}
                          >
                            {b.tStat}
                          </td>
                          <td className="py-1 text-right">{b.multiplier.toFixed(2)}x</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-3 space-y-2 border-t border-[var(--line)] pt-2 text-[10px] leading-relaxed">
        <p style={{ color: r.inconclusive ? "var(--warn)" : "var(--muted)" }}>
          {r.inconclusive
            ? `Nothing clears the bar. Across ${r.testsRun} buckets, no signal separates forward returns by more than noise \u2014 including the dip detector, which was hand-weighted above neutral before it was ever tested. Every weight now sits at roughly 1.00x, so these read as descriptive labels and the allocation is driven by valuation and moat alone.`
            : "Signals above the threshold carry most of their measured edge into the weight; everything else is shrunk toward neutral."}
        </p>
        <p className="text-[var(--muted)]">
          Measured in-sample, on correlated names, over one market regime. A genuine test needs
          out-of-sample data this watchlist does not yet have, so treat a passing signal as a
          hypothesis worth keeping rather than a proven effect.
        </p>
        <p className="text-[9px] text-[var(--muted)]">{r.method}</p>
      </div>
    </section>
  );
}


type Entrant = {
  label: string;
  samples: number;
  medianEdge: number;
  winRate: number;
  nameWinRate: number;
  foldWinRate: number;
  medianExposure: number;
  tStat: number;
  survives: boolean;
};

type TournamentResult = {
  rounds: { round: number; tested: number; survived: number; entrants: Entrant[] }[];
  champion: Entrant | null;
  benchmarkNote: string;
  names: number;
  folds: number;
  totalTests: number;
  criticalT: number;
  verdict: string;
};

/**
 * The signal tournament.
 *
 * Every entry rule run across every name, in four separate periods, against
 * buy-and-hold. A rule has to beat it on most names AND in most periods to
 * survive — winning on one chart or one regime is what luck looks like.
 */
function TournamentPanel() {
  const t = useQuery(api.allocation.tournament);
  const r = t?.result as TournamentResult | undefined;
  if (!r?.rounds?.length) return null;
  const round1 = r.rounds[0];

  return (
    <section className="panel p-4">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[11px] uppercase tracking-wider text-[var(--muted)]">
          Signal tournament
        </h2>
        <span className="text-[10px] text-[var(--muted)]">
          {r.totalTests} rules · {r.names} names · {r.folds} periods
        </span>
      </div>

      <p
        className="mb-3 text-[11px] leading-relaxed"
        style={{ color: r.champion ? "var(--good)" : "var(--warn)" }}
      >
        {r.verdict}
      </p>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] text-[11px] tabular">
          <thead className="text-[9px] uppercase tracking-wider text-[var(--muted)]">
            <tr className="border-b border-[var(--line)]">
              <th className="py-1.5 text-left font-medium">Rule</th>
              <th className="py-1.5 text-right font-medium">Edge</th>
              <th className="py-1.5 text-right font-medium">Names</th>
              <th className="py-1.5 text-right font-medium">Periods</th>
              <th className="py-1.5 text-right font-medium">Invested</th>
              <th className="py-1.5 text-right font-medium">t</th>
            </tr>
          </thead>
          <tbody>
            {round1.entrants.map((e) => (
              <tr key={e.label} className="border-b border-[var(--line)] last:border-0">
                <td className="py-1.5 pr-2">{e.label}</td>
                <td
                  className="py-1.5 text-right"
                  style={{ color: e.medianEdge >= 0 ? "var(--good)" : "var(--bad)" }}
                >
                  {e.medianEdge >= 0 ? "+" : ""}
                  {e.medianEdge}pp
                </td>
                <td className="py-1.5 text-right text-[var(--muted)]">{e.nameWinRate}%</td>
                <td className="py-1.5 text-right text-[var(--muted)]">{e.foldWinRate}%</td>
                <td className="py-1.5 text-right text-[var(--muted)]">
                  {Math.round(e.medianExposure * 100)}%
                </td>
                <td
                  className="py-1.5 text-right"
                  style={{ color: Math.abs(e.tStat) >= r.criticalT ? "var(--fg)" : "var(--muted)" }}
                >
                  {e.tStat}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-3 space-y-2 border-t border-[var(--line)] pt-2 text-[10px] leading-relaxed text-[var(--muted)]">
        <p>
          <span className="text-[var(--text)]">Edge</span> is against buy-and-hold, so negative means
          the rule cost money. <span className="text-[var(--text)]">Names</span> and{" "}
          <span className="text-[var(--text)]">Periods</span> are how often it won across the
          thirteen charts and the four separate stretches of history — both must clear 60% to
          survive, so a rule cannot pass on one lucky chart.{" "}
          <span className="text-[var(--text)]">Invested</span> is time in the market; buy-and-hold is
          87% by construction.
        </p>
        <p>
          What these rules mostly vary is exposure, not timing. Sitting out part of an advance costs
          more than the entries avoided are worth, which is why the strongest negative numbers belong
          to the trend filters that keep you out the longest. Combinations were never built — nothing
          survived the first round, and pairing losers produces a worse loser.
        </p>
      </div>
    </section>
  );
}

export default function StrategyPage() {
  const sim = useQuery(api.allocation.latestSimulation);
  const history = useQuery(api.allocation.history, { limit: 14 });

  const result = sim?.result as Sim | undefined;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[17px] font-semibold">Strategy</h1>
        <p className="mt-1 max-w-3xl text-[11px] leading-relaxed text-[var(--muted)]">
          What the engine would do with a regular contribution, and how that rule behaves across
          the price history.
        </p>
      </div>

      <DcaWidget />

      <section className="panel p-4">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="text-[11px] uppercase tracking-wider text-[var(--muted)]">
            £100 per week, sized by depth
          </h2>
          {result && (
            <div className="flex flex-wrap gap-4 text-[11px] tabular">
              <span>
                <span className="text-[var(--muted)]">In </span>
                {usd(result.deposited, 0)}
              </span>
              <span>
                <span className="text-[var(--muted)]">Value </span>
                {usd(result.finalValue, 0)}
              </span>
              <span style={{ color: result.returnPct >= 0 ? "var(--good)" : "var(--bad)" }}>
                {result.returnPct >= 0 ? "+" : ""}
                {result.returnPct}%
              </span>
              <span className="text-[var(--muted)]">
                SPY {result.benchmarkReturnPct >= 0 ? "+" : ""}
                {result.benchmarkReturnPct}%
              </span>
            </div>
          )}
        </div>

        {result === undefined && (
          <p className="text-[11px] text-[var(--muted)]">
            Not computed yet — it runs nightly, or trigger it manually.
          </p>
        )}

        {result && (
          <>
            <Curve series={result.series} />
            <div className="mt-2 flex flex-wrap gap-4 text-[10px] text-[var(--muted)]">
              <span>
                <span style={{ color: "var(--accent)" }}>—</span> strategy
              </span>
              <span>- - SPY, same contributions</span>
              <span>{result.tradeCount} trades</span>
              <span>{result.cashPct}% currently in cash</span>
            </div>

            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div>
                <h3 className="mb-1.5 text-[10px] uppercase tracking-wider text-[var(--muted)]">
                  Positions
                </h3>
                <table className="w-full text-[11px] tabular">
                  <tbody>
                    {result.perTicker
                      .filter((p) => p.value > 0.5)
                      .map((p) => (
                        <tr key={p.ticker} className="border-b border-[var(--line)] last:border-0">
                          <td className="py-1">
                            <Link href={`/c/${p.ticker}`} className="hover:underline">
                              {p.ticker}
                            </Link>
                          </td>
                          <td className="py-1 text-right text-[var(--muted)]">
                            {usd(p.invested, 0)} in
                          </td>
                          <td className="py-1 text-right">{usd(p.value, 0)}</td>
                          <td
                            className="py-1 text-right"
                            style={{
                              color: p.value >= p.invested ? "var(--good)" : "var(--bad)",
                            }}
                          >
                            {p.invested > 0
                              ? signedPct(p.value / p.invested - 1)
                              : "—"}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>

              <div>
                <h3 className="mb-1.5 text-[10px] uppercase tracking-wider text-[var(--muted)]">
                  Recent decisions
                </h3>
                <ul className="space-y-0.5 text-[11px]">
                  {[...result.trades].reverse().slice(0, 10).map((t, i) => (
                    <li key={i} className="flex items-baseline justify-between gap-2">
                      <span className="text-[var(--muted)]">{t.date}</span>
                      <span>
                        <span style={{ color: t.side === "buy" ? "var(--good)" : "var(--bad)" }}>
                          {t.side}
                        </span>{" "}
                        {t.ticker}
                      </span>
                      <span className="tabular text-[var(--muted)]">
                        {usd(t.amount, 0)} · depth {Math.round(t.depth * 100)}%
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </>
        )}

        <div className="mt-4 space-y-1.5 border-t border-[var(--line)] pt-2 text-[10px] leading-relaxed text-[var(--muted)]">
          <p>
            Every input is <strong className="text-[var(--text)]">causal</strong> — the reference is
            each stock&apos;s own trailing 200-day average and the dip read uses only bars up to the
            decision date, so nothing here knows the future. Buys scale with depth below that
            average and are cut to 60% when selling pressure is still heavy; trims start 15% above
            it. Positions are capped at 25% of the book at purchase.
          </p>
          <p className="text-[var(--warn)]">
            It is still a simulation, not a track record. These are companies you already chose,
            over one particular stretch of market history — a different watchlist or a different
            two years would give a different answer. The unbiased forward record is the{" "}
            <Link href="/journal" className="underline">
              signal journal
            </Link>
            .
          </p>
        </div>
      </section>

      <TournamentPanel />

      <CalibrationPanel />

      {history && history.length > 0 && (
        <section>
          <h2 className="mb-2 text-[13px] font-semibold">Recommendation history</h2>
          <div className="panel divide-y divide-[var(--line)]">
            {history.map((h) => (
              <div key={h._id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-3 py-2">
                <span className="text-[11px] text-[var(--muted)]">{h.date}</span>
                <span className="text-[11px]">{h.headline}</span>
                <span className="ml-auto flex gap-2 text-[10px] tabular text-[var(--muted)]">
                  {h.slices.map((s) => (
                    <span key={s.ticker}>
                      {s.ticker} {Math.round(s.weight * 100)}%
                    </span>
                  ))}
                  {h.cash > 0.001 && <span>cash {Math.round(h.cash * 100)}%</span>}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
