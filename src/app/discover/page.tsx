"use client";

import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { bigUsd, num, signedPct, VERDICT_COLOR, scoreColor } from "@/lib/format";

/**
 * Companies the engine pulled in on its own to make peer comparison real.
 * They are scored but not watched — this page is where one graduates.
 */
export default function DiscoverPage() {
  const rows = useQuery(api.discovery.candidates, { limit: 40 });
  const stats = useQuery(api.discovery.stats);
  const add = useMutation(api.watchlist.add);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[17px] font-semibold">Discovered</h1>
        <p className="mt-1 max-w-3xl text-[11px] leading-relaxed text-[var(--muted)]">
          Same-industry companies pulled from the full SEC universe so that
          &ldquo;closest competitors&rdquo; means the industry rather than whatever you happen to
          follow. They are scored on identical rules but raise no alerts and never enter the DCA
          allocation until you add them.
          {stats && <> {stats.discovered} found so far.</>}
        </p>
      </div>

      {rows === undefined && <p className="text-[12px] text-[var(--muted)]">Loading…</p>}

      {rows && rows.length === 0 && (
        <div className="panel p-6 text-[11px] leading-relaxed text-[var(--muted)]">
          Nothing discovered yet. The sweep runs nightly and adds a few names at a time, starting
          with the watchlist companies whose peer groups are thinnest — deliberately slow, because
          each new name costs a full SEC ingest.
        </div>
      )}

      {rows && rows.length > 0 && (
        <div className="panel overflow-x-auto">
          <table className="w-full min-w-[720px] text-[12px] tabular">
            <thead className="text-[10px] uppercase tracking-wider text-[var(--muted)]">
              <tr className="border-b border-[var(--line)]">
                <th className="px-3 py-2.5 text-left font-medium">Company</th>
                <th className="px-3 py-2.5 text-left font-medium">Found for</th>
                <th className="px-3 py-2.5 text-right font-medium">Size</th>
                <th className="px-3 py-2.5 text-right font-medium">Upside</th>
                <th className="px-3 py-2.5 text-right font-medium">Moat</th>
                <th className="px-3 py-2.5 text-right font-medium">Asym</th>
                <th className="px-3 py-2.5 text-right font-medium">Verdict</th>
                <th className="px-3 py-2.5 text-right font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.ticker} className="border-b border-[var(--line)] last:border-0">
                  <td className="px-3 py-2">
                    <Link href={`/c/${r.ticker}`} className="font-medium hover:underline">
                      {r.ticker}
                    </Link>
                    <span className="ml-2 text-[11px] text-[var(--muted)]">
                      {r.name.length > 30 ? `${r.name.slice(0, 30)}…` : r.name}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-[10px] text-[var(--muted)]">
                    {r.discoveredFor.join(", ")}
                  </td>
                  <td className="px-3 py-2 text-right text-[var(--muted)]">
                    {bigUsd(r.marketCap)}
                  </td>
                  <td
                    className="px-3 py-2 text-right"
                    style={{ color: (r.upside ?? 0) >= 0 ? "var(--good)" : "var(--bad)" }}
                  >
                    {r.upside === undefined ? "—" : signedPct(r.upside / 100)}
                  </td>
                  <td className="px-3 py-2 text-right" style={{ color: scoreColor(r.moatScore) }}>
                    {num(r.moatScore, 0)}
                  </td>
                  <td className="px-3 py-2 text-right" style={{ color: scoreColor(r.asymmetry) }}>
                    {num(r.asymmetry, 0)}
                  </td>
                  <td
                    className="px-3 py-2 text-right text-[10px]"
                    style={{ color: VERDICT_COLOR[r.verdict ?? ""] }}
                  >
                    {(r.verdict ?? "—").replace(/_/g, " ")}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button
                      onClick={() => add({ ticker: r.ticker, reason: "promoted from discovery" })}
                      className="chip hover:text-[var(--text)]"
                    >
                      Watch
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
