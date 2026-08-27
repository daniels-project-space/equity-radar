"use client";

import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { usd, signedPct } from "@/lib/format";

const label = (t: string) => t.replace(/_/g, " ").toLowerCase();

function Cell({ s }: { s: { n: number; medianAlpha: number; hitRate: number } | null }) {
  if (!s) return <span className="text-[var(--muted)]">—</span>;
  return (
    <span className="tabular">
      <span style={{ color: s.medianAlpha >= 0 ? "var(--good)" : "var(--bad)" }}>
        {s.medianAlpha >= 0 ? "+" : ""}
        {s.medianAlpha}%
      </span>
      <span className="ml-1.5 text-[10px] text-[var(--muted)]">
        {s.hitRate}% · n={s.n}
      </span>
    </span>
  );
}

export default function JournalPage() {
  const stats = useQuery(api.journal.stats);
  const recent = useQuery(api.journal.recent, { limit: 40 });

  if (stats === undefined) return <p className="text-[12px] text-[var(--muted)]">Loading…</p>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[17px] font-semibold">Signal journal</h1>
        <p className="mt-1 max-w-2xl text-[11px] leading-relaxed text-[var(--muted)]">
          Every alert is recorded at the price it fired, then scored against SPY at 30, 90 and 180
          days. Alpha, not raw return — a signal that made 8% while the market made 12% did not
          work. Until these numbers exist the scoring weights are opinion.
        </p>
      </div>

      <div className="flex flex-wrap gap-5 text-[12px]">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-[var(--muted)]">Recorded</div>
          <div className="text-[19px] font-semibold tabular">{stats.totalSignals}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-[var(--muted)]">Scored</div>
          <div className="text-[19px] font-semibold tabular">{stats.scoredSignals}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-[var(--muted)]">Maturing</div>
          <div className="text-[19px] font-semibold tabular text-[var(--muted)]">
            {stats.pendingSignals}
          </div>
        </div>
        {stats.overall && (
          <div>
            <div className="text-[10px] uppercase tracking-wider text-[var(--muted)]">
              Median alpha (30d)
            </div>
            <div
              className="text-[19px] font-semibold tabular"
              style={{ color: stats.overall.medianAlpha >= 0 ? "var(--good)" : "var(--bad)" }}
            >
              {stats.overall.medianAlpha >= 0 ? "+" : ""}
              {stats.overall.medianAlpha}%
            </div>
          </div>
        )}
      </div>

      {stats.scoredSignals === 0 && (
        <div className="panel p-5 text-[11px] leading-relaxed text-[var(--muted)]">
          Nothing has matured yet. The first 30-day windows close a month after the signals that
          are currently open, and the table below fills in from there. This is the honest state of
          a track record that has just started — it cannot be backfilled without look-ahead bias,
          because the scoring model itself changes over time.
        </div>
      )}

      {stats.perType.length > 0 && (
        <section className="panel overflow-x-auto">
          <table className="w-full min-w-[560px] text-[12px]">
            <thead className="text-[10px] uppercase tracking-wider text-[var(--muted)]">
              <tr className="border-b border-[var(--line)]">
                <th className="px-3 py-2.5 text-left font-medium">Signal</th>
                <th className="px-3 py-2.5 text-right font-medium">Fired</th>
                <th className="px-3 py-2.5 text-right font-medium">30d alpha</th>
                <th className="px-3 py-2.5 text-right font-medium">90d alpha</th>
                <th className="px-3 py-2.5 text-right font-medium">180d alpha</th>
              </tr>
            </thead>
            <tbody>
              {stats.perType.map((t) => (
                <tr key={t.type} className="border-b border-[var(--line)] last:border-0">
                  <td className="px-3 py-2 capitalize">{label(t.type)}</td>
                  <td className="px-3 py-2 text-right tabular text-[var(--muted)]">{t.total}</td>
                  <td className="px-3 py-2 text-right"><Cell s={t.d30} /></td>
                  <td className="px-3 py-2 text-right"><Cell s={t.d90} /></td>
                  <td className="px-3 py-2 text-right"><Cell s={t.d180} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="px-3 py-2 text-[10px] text-[var(--muted)]">
            Percentages are median alpha versus SPY; the second figure is the share of signals with
            positive alpha.
          </p>
        </section>
      )}

      {recent && recent.length > 0 && (
        <section>
          <h2 className="mb-2 text-[13px] font-semibold">Recent signals</h2>
          <div className="panel overflow-x-auto">
            <table className="w-full min-w-[620px] text-[11px]">
              <thead className="text-[10px] uppercase tracking-wider text-[var(--muted)]">
                <tr className="border-b border-[var(--line)]">
                  <th className="px-3 py-2 text-left font-medium">Date</th>
                  <th className="px-3 py-2 text-left font-medium">Ticker</th>
                  <th className="px-3 py-2 text-left font-medium">Signal</th>
                  <th className="px-3 py-2 text-right font-medium">Price</th>
                  <th className="px-3 py-2 text-right font-medium">30d</th>
                  <th className="px-3 py-2 text-right font-medium">Alpha</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((r) => (
                  <tr key={r._id} className="border-b border-[var(--line)] last:border-0">
                    <td className="px-3 py-1.5 text-[var(--muted)]">{r.firedDate}</td>
                    <td className="px-3 py-1.5">
                      <Link href={`/c/${r.ticker}`} className="font-medium hover:underline">
                        {r.ticker}
                      </Link>
                    </td>
                    <td className="px-3 py-1.5 capitalize text-[var(--muted)]">{label(r.type)}</td>
                    <td className="px-3 py-1.5 text-right tabular">{usd(r.priceAtSignal)}</td>
                    <td className="px-3 py-1.5 text-right tabular">{signedPct(r.ret30d)}</td>
                    <td
                      className="px-3 py-1.5 text-right tabular"
                      style={{
                        color:
                          r.alpha30d === undefined
                            ? undefined
                            : r.alpha30d >= 0
                              ? "var(--good)"
                              : "var(--bad)",
                      }}
                    >
                      {signedPct(r.alpha30d)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
