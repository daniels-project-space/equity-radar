"use client";

import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { StockCard } from "@/components/stock-card";
import { ActionPanel } from "@/components/action-panel";

export default function Dashboard() {
  const rows = useQuery(api.watchlist.list);

  return (
    <div className="space-y-9">
      <section>
        {rows === undefined && <p className="text-[12px] text-[var(--muted)]">Loading…</p>}

        {rows && rows.length === 0 && (
          <div className="panel p-10 text-center">
            <p className="text-[13px] text-[var(--muted)]">
              Add a company from the search box above.
            </p>
            <p className="mx-auto mt-2 max-w-md text-[11px] leading-relaxed text-[var(--muted)]">
              Fundamentals are pulled from its SEC filings and scored on the spot — no API keys,
              nothing typed in by hand.
            </p>
          </div>
        )}

        {rows && rows.length > 0 && (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {rows.map((r) => (
              <StockCard key={r._id} row={r} />
            ))}
          </div>
        )}
      </section>

      {rows && rows.length > 0 && <ActionPanel rows={rows} />}
    </div>
  );
}
