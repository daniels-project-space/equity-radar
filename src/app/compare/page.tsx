"use client";

import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { usd, pct, signedPct, mult, num, VERDICT_COLOR, scoreColor } from "@/lib/format";

/**
 * The side-by-side view — the same shape as a hand-written comparison table,
 * but every cell is computed from filings rather than typed in.
 */
type Row = NonNullable<ReturnType<typeof useWatchlist>>[number];
const useWatchlist = () => useQuery(api.watchlist.list);

export default function ComparePage() {
  const rows = useWatchlist();

  if (rows === undefined) return <p className="text-[12px] text-[var(--muted)]">Loading…</p>;
  if (rows.length === 0)
    return <p className="text-[12px] text-[var(--muted)]">Add companies to the watchlist first.</p>;

  const fields: {
    label: string;
    get: (r: Row) => string;
    color?: (r: Row) => string | undefined;
  }[] = [
    { label: "Price", get: (r) => usd(r.priceStats?.last) },
    { label: "Revenue YoY", get: (r) => signedPct(r.metrics?.revYoY) },
    {
      label: "Acceleration",
      get: (r) =>
        typeof r.metrics?.revAccel === "number"
          ? `${r.metrics.revAccel > 0 ? "+" : ""}${r.metrics.revAccel.toFixed(1)}pp`
          : "—",
      color: (r) => ((r.metrics?.revAccel ?? 0) >= 0 ? "var(--good)" : "var(--bad)"),
    },
    { label: "EPS YoY", get: (r) => signedPct(r.metrics?.epsYoY) },
    { label: "Gross margin", get: (r) => pct(r.metrics?.grossMarginPct) },
    { label: "Operating margin", get: (r) => pct(r.metrics?.opMarginPct) },
    { label: "FCF margin", get: (r) => pct(r.metrics?.fcfMarginPct) },
    { label: "Dilution YoY", get: (r) => signedPct(r.metrics?.sharesYoY) },
    { label: "P/E", get: (r) => mult(r.metrics?.fwdPe ?? r.metrics?.peTtm) },
    { label: "EV / Sales", get: (r) => mult(r.metrics?.evToSales) },
    { label: "12m return", get: (r) => signedPct(r.priceStats?.ret12m) },
    { label: "Off 52w high", get: (r) => pct(r.priceStats?.drawdownFromHigh, 0) },
    {
      label: "Composite",
      get: (r) => num(r.score?.composite, 0),
      color: (r) => scoreColor(r.score?.composite),
    },
    {
      label: "Crowdedness",
      get: (r) => num(r.score?.crowdedness, 0),
      color: (r) => ((r.score?.crowdedness ?? 0) > 60 ? "var(--bad)" : undefined),
    },
    {
      label: "Asymmetry",
      get: (r) => num(r.score?.asymmetry, 0),
      color: (r) => scoreColor(r.score?.asymmetry),
    },
    { label: "Zone", get: (r) => r.bands?.currentBand ?? "—" },
  ];

  return (
    <div>
      <h1 className="mb-4 text-[17px] font-semibold">Compare</h1>
      <div className="panel overflow-x-auto">
        <table className="w-full text-[12px] tabular">
          <thead>
            <tr className="border-b border-[var(--line)]">
              <th className="px-3 py-2.5 text-left text-[10px] uppercase tracking-wider font-medium text-[var(--muted)]">
                Metric
              </th>
              {rows.map((r) => (
                <th key={r._id} className="px-3 py-2.5 text-right">
                  <Link href={`/c/${r.ticker}`} className="hover:underline">
                    {r.ticker}
                  </Link>
                  <div
                    className="text-[9px] font-normal"
                    style={{ color: VERDICT_COLOR[r.score?.verdict ?? "INSUFFICIENT_DATA"] }}
                  >
                    {(r.score?.verdict ?? "—").replace(/_/g, " ")}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {fields.map((f) => (
              <tr key={f.label} className="border-b border-[var(--line)] last:border-0">
                <td className="px-3 py-2 text-[var(--muted)]">{f.label}</td>
                {rows.map((r) => (
                  <td key={r._id} className="px-3 py-2 text-right" style={{ color: f.color?.(r) }}>
                    {f.get(r)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
