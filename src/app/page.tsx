"use client";

import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { TickerSearch } from "@/components/ticker-search";
import {
  usd,
  pct,
  signedPct,
  mult,
  num,
  isStale,
  VERDICT_COLOR,
  ACTION_COLOR,
  scoreColor,
} from "@/lib/format";

export default function Dashboard() {
  const rows = useQuery(api.watchlist.list);
  const alerts = useQuery(api.alerts.recent, { limit: 12, unacknowledgedOnly: true });
  const ack = useMutation(api.alerts.acknowledge);

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
      <section className="min-w-0">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-[17px] font-semibold">Watchlist</h1>
          <TickerSearch />
        </div>

        {rows === undefined && <p className="text-[12px] text-[var(--muted)]">Loading…</p>}

        {rows && rows.length === 0 && (
          <div className="panel p-8 text-center">
            <p className="text-[13px] text-[var(--muted)]">
              No companies yet. Search above to add one — fundamentals come straight from its SEC
              filings and the first score is computed on the spot.
            </p>
          </div>
        )}

        {rows && rows.length > 0 && (
          <div className="panel overflow-x-auto">
            <table className="w-full min-w-[900px] text-[12px] tabular">
              <thead className="text-[10px] uppercase tracking-wider text-[var(--muted)]">
                <tr className="border-b border-[var(--line)]">
                  <th className="px-3 py-2.5 text-left font-medium">Company</th>
                  <th className="px-3 py-2.5 text-right font-medium">Price</th>
                  <th className="px-3 py-2.5 text-right font-medium">Zone</th>
                  <th className="px-3 py-2.5 text-right font-medium">Asym</th>
                  <th className="px-3 py-2.5 text-right font-medium">Comp</th>
                  <th className="px-3 py-2.5 text-right font-medium">Rev YoY</th>
                  <th className="px-3 py-2.5 text-right font-medium">Accel</th>
                  <th className="px-3 py-2.5 text-right font-medium">GM</th>
                  <th className="px-3 py-2.5 text-right font-medium">P/E</th>
                  <th className="px-3 py-2.5 text-right font-medium">Off high</th>
                  <th className="px-3 py-2.5 text-right font-medium">Filed thru</th>
                  <th className="px-3 py-2.5 text-right font-medium">Verdict</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const m = r.metrics;
                  const p = r.priceStats;
                  const band = r.bands?.bands?.find(
                    (b: { label: string }) => b.label === r.bands?.currentBand
                  );
                  return (
                    <tr
                      key={r._id}
                      className="border-b border-[var(--line)] last:border-0 hover:bg-[var(--panel-2)]"
                    >
                      <td className="px-3 py-2.5">
                        <Link href={`/c/${r.ticker}`} className="block">
                          <span className="font-semibold">{r.ticker}</span>
                          <span className="ml-2 text-[var(--muted)]">{r.name}</span>
                        </Link>
                      </td>
                      <td className="px-3 py-2.5 text-right">{usd(p?.last)}</td>
                      <td className="px-3 py-2.5 text-right">
                        {band ? (
                          <span
                            className="chip"
                            style={{
                              color: ACTION_COLOR[band.action],
                              borderColor: `${ACTION_COLOR[band.action]}55`,
                            }}
                          >
                            {band.label}
                          </span>
                        ) : (
                          <span className="text-[var(--muted)]">—</span>
                        )}
                      </td>
                      <td
                        className="px-3 py-2.5 text-right font-semibold"
                        style={{ color: scoreColor(r.score?.asymmetry) }}
                      >
                        {num(r.score?.asymmetry, 0)}
                      </td>
                      <td className="px-3 py-2.5 text-right" style={{ color: scoreColor(r.score?.composite) }}>
                        {num(r.score?.composite, 0)}
                      </td>
                      <td className="px-3 py-2.5 text-right">{signedPct(m?.revYoY)}</td>
                      <td
                        className="px-3 py-2.5 text-right"
                        style={{ color: (m?.revAccel ?? 0) >= 0 ? "var(--good)" : "var(--bad)" }}
                      >
                        {typeof m?.revAccel === "number" ? `${m.revAccel > 0 ? "+" : ""}${m.revAccel.toFixed(1)}pp` : "—"}
                      </td>
                      <td className="px-3 py-2.5 text-right">{pct(m?.grossMarginPct, 0)}</td>
                      <td className="px-3 py-2.5 text-right">{mult(m?.fwdPe ?? m?.peTtm)}</td>
                      <td className="px-3 py-2.5 text-right">{pct(p?.drawdownFromHigh, 0)}</td>
                      <td
                        className="px-3 py-2.5 text-right"
                        style={{ color: isStale(m?.latestPeriodEnd) ? "var(--warn)" : "var(--muted)" }}
                        title={
                          isStale(m?.latestPeriodEnd)
                            ? "Fundamentals lag — this filer's newest tagged period is old"
                            : undefined
                        }
                      >
                        {m?.latestPeriodEnd ?? "—"}
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <span
                          className="chip"
                          style={{
                            color: VERDICT_COLOR[r.score?.verdict ?? "INSUFFICIENT_DATA"],
                            borderColor: `${VERDICT_COLOR[r.score?.verdict ?? "INSUFFICIENT_DATA"]}55`,
                          }}
                        >
                          {(r.score?.verdict ?? "—").replace(/_/g, " ")}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <p className="mt-3 text-[11px] leading-relaxed text-[var(--muted)]">
          <strong className="text-[var(--text)]">Asym</strong> is the entry score: business quality
          minus how expensive and how already-discovered the name is.{" "}
          <strong className="text-[var(--text)]">Comp</strong> is the business score on its own. They
          disagree on purpose — an excellent company that has already run 600% scores high on one and
          low on the other.
        </p>
      </section>

      <aside className="space-y-4">
        <div className="panel p-4">
          <h2 className="mb-3 text-[13px] font-semibold">Alerts</h2>
          {alerts === undefined && <p className="text-[11px] text-[var(--muted)]">Loading…</p>}
          {alerts && alerts.length === 0 && (
            <p className="text-[11px] text-[var(--muted)]">Nothing outstanding.</p>
          )}
          <ul className="space-y-2.5">
            {alerts?.map((a) => (
              <li key={a._id} className="border-l-2 pl-2.5" style={{ borderColor: sevColor(a.severity) }}>
                <div className="flex items-start justify-between gap-2">
                  <Link href={`/c/${a.ticker}`} className="text-[12px] font-medium hover:underline">
                    {a.title}
                  </Link>
                  <button
                    onClick={() => ack({ id: a._id })}
                    className="shrink-0 text-[10px] text-[var(--muted)] hover:text-[var(--text)]"
                  >
                    dismiss
                  </button>
                </div>
                <p className="mt-0.5 text-[11px] leading-snug text-[var(--muted)]">{a.detail}</p>
              </li>
            ))}
          </ul>
        </div>

        <RunsPanel />
      </aside>
    </div>
  );
}

function RunsPanel() {
  const runs = useQuery(api.alerts.lastRuns);
  if (!runs || runs.length === 0) return null;
  return (
    <div className="panel p-4">
      <h2 className="mb-2 text-[13px] font-semibold">Pipeline</h2>
      <ul className="space-y-1 text-[11px] text-[var(--muted)]">
        {runs.slice(0, 5).map((r) => (
          <li key={r._id} className="flex items-center justify-between gap-2">
            <span>{r.task}</span>
            <span style={{ color: r.ok === false ? "var(--bad)" : "var(--muted)" }}>
              {r.ok === false ? "failed" : r.finishedAt ? `${r.processed ?? 0} ok` : "running"}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const sevColor = (s: string) =>
  s === "critical" ? "var(--bad)" : s === "high" ? "var(--warn)" : "var(--line)";
