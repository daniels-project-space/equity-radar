"use client";

import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { StockCard, type CardAlert } from "@/components/stock-card";
import { DcaWidget } from "@/components/dca-widget";
import { visibleAlerts, type NotifyPrefs, type Severity } from "@/lib/notify";

const RANK: Record<Severity, number> = { critical: 0, high: 1, medium: 2 };

/**
 * One surface. Cards carry their own signals, so there is no second list
 * restating them — the grid is sorted so whatever needs a decision is simply
 * at the top.
 */
export default function Dashboard() {
  const rows = useQuery(api.watchlist.listCompact);
  const alerts = useQuery(api.alerts.recent, { limit: 120, unacknowledgedOnly: true });
  const settings = useQuery(api.settings.all);

  const prefs = settings?.global.notify as NotifyPrefs | undefined;
  const shown = visibleAlerts(alerts ?? [], prefs);

  const byTicker = new Map<string, CardAlert[]>();
  for (const a of shown) {
    const list = byTicker.get(a.ticker) ?? [];
    list.push({ _id: a._id, type: a.type, severity: a.severity, title: a.title });
    byTicker.set(a.ticker, list);
  }
  for (const list of byTicker.values()) list.sort((x, y) => RANK[x.severity] - RANK[y.severity]);

  const ordered = [...(rows ?? [])].sort((a, b) => {
    const sa = byTicker.get(a.ticker)?.[0];
    const sb = byTicker.get(b.ticker)?.[0];
    const ra = sa ? RANK[sa.severity] : 9;
    const rb = sb ? RANK[sb.severity] : 9;
    if (ra !== rb) return ra - rb;
    return (b.score?.asymmetry ?? -1) - (a.score?.asymmetry ?? -1);
  });

  return (
    <div className="space-y-5">
      {rows && rows.length > 0 && <DcaWidget />}

      {rows === undefined && <p className="text-[12px] text-[var(--muted)]">Loading…</p>}

      {rows && rows.length === 0 && (
        <div className="panel p-10 text-center">
          <p className="text-[13px] text-[var(--muted)]">Add a company from the search box above.</p>
          <p className="mx-auto mt-2 max-w-md text-[11px] leading-relaxed text-[var(--muted)]">
            Fundamentals are pulled from its SEC filings and scored on the spot — no API keys,
            nothing typed in by hand.
          </p>
        </div>
      )}

      {rows && rows.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {ordered.map((r) => (
            <StockCard key={r._id} row={r} alerts={byTicker.get(r.ticker)} />
          ))}
        </div>
      )}
    </div>
  );
}
