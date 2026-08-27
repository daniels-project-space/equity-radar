"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { signedPct } from "@/lib/format";
import { visibleAlerts, SEVERITY_COLOR, type NotifyPrefs, type Severity } from "@/lib/notify";

type Row = {
  ticker: string;
  metrics?: {
    revYoY?: number;
    peerRevYoY?: number;
    peerRet3m?: number;
    peerCount?: number;
    moatTrend?: number;
  } | null;
  priceStats?: { ret3m?: number } | null;
};

const RANK: Record<Severity, number> = { critical: 0, high: 1, medium: 2 };
const VISIBLE_GROUPS = 6;

/**
 * Grouped by company, because a flat feed of every threshold crossing is a wall
 * of text, not a decision aid. One block per name, ranked by its most severe
 * signal, with the peer and moat context stated once rather than per row.
 */
export function ActionPanel({ rows }: { rows: Row[] }) {
  const alerts = useQuery(api.alerts.recent, { limit: 120, unacknowledgedOnly: true });
  const settings = useQuery(api.settings.all);
  const track = useQuery(api.journal.trackRecordByType);
  const ack = useMutation(api.alerts.acknowledge);
  const [expanded, setExpanded] = useState(false);

  const prefs = settings?.global.notify as NotifyPrefs | undefined;
  const shown = visibleAlerts(alerts ?? [], prefs);
  const byTicker = new Map(rows.map((r) => [r.ticker, r]));

  const groups = new Map<string, typeof shown>();
  for (const a of shown) {
    const list = groups.get(a.ticker) ?? [];
    list.push(a);
    groups.set(a.ticker, list);
  }

  const ordered = [...groups.entries()]
    .map(([ticker, list]) => ({
      ticker,
      list: [...list].sort((a, b) => RANK[a.severity] - RANK[b.severity]),
      worst: Math.min(...list.map((a) => RANK[a.severity])),
    }))
    .sort((a, b) => a.worst - b.worst || b.list.length - a.list.length);

  const visible = expanded ? ordered : ordered.slice(0, VISIBLE_GROUPS);

  return (
    <section>
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-[13px] font-semibold">Needs attention</h2>
        <span className="text-[11px] text-[var(--muted)]">
          {ordered.length === 0
            ? "clear"
            : `${ordered.length} ${ordered.length === 1 ? "company" : "companies"} · ${shown.length} signals`}
        </span>
      </div>

      {alerts === undefined && <p className="text-[11px] text-[var(--muted)]">Loading…</p>}

      {alerts !== undefined && ordered.length === 0 && (
        <div className="panel p-5 text-[11px] text-[var(--muted)]">
          {prefs?.enabled === false
            ? "Notifications are off. Signals are still recorded — turn them on from the bell."
            : "Nothing crossed a threshold. The watchlist is re-scored every weekday morning."}
        </div>
      )}

      <div className="grid gap-2 lg:grid-cols-2">
        {visible.map(({ ticker, list }) => {
          const row = byTicker.get(ticker);
          const m = row?.metrics;
          const ownRet = row?.priceStats?.ret3m;

          const context = [
            m?.peerRet3m !== undefined && ownRet !== undefined
              ? `3m ${signedPct(ownRet)} vs peers ${signedPct(m.peerRet3m)}`
              : null,
            m?.revYoY !== undefined && m?.peerRevYoY !== undefined
              ? `growth ${signedPct(m.revYoY)} vs peers ${signedPct(m.peerRevYoY)}`
              : null,
            m?.moatTrend !== undefined ? `moat ${m.moatTrend > 0 ? "+" : ""}${m.moatTrend}` : null,
          ].filter(Boolean) as string[];

          return (
            <div
              key={ticker}
              className="panel p-3"
              style={{ borderLeft: `2px solid ${SEVERITY_COLOR[list[0].severity]}` }}
            >
              <div className="mb-1.5 flex items-baseline justify-between gap-2">
                <Link href={`/c/${ticker}`} className="text-[12px] font-semibold hover:underline">
                  {ticker}
                </Link>
                {context.length > 0 && (
                  <span className="truncate text-[10px] tabular text-[var(--muted)]">
                    {context.join(" · ")}
                  </span>
                )}
              </div>

              <ul className="space-y-1.5">
                {list.map((a) => (
                  <li key={a._id} className="group flex items-start gap-2">
                    <span
                      className="mt-[5px] h-1 w-1 shrink-0 rounded-full"
                      style={{ background: SEVERITY_COLOR[a.severity] }}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-[11px] leading-snug">
                        {a.title.replace(`${a.ticker}: `, "").replace(`${a.ticker} `, "")}
                      </p>
                      <p className="text-[10px] leading-snug text-[var(--muted)]">{a.detail}</p>
                      {/* How this signal type has actually performed, once
                          there are enough closed observations to mean it. */}
                      {track?.[a.type] && (
                        <p className="mt-0.5 text-[10px] tabular text-[var(--muted)]">
                          track record:{" "}
                          <span
                            style={{
                              color:
                                track[a.type].medianAlpha >= 0 ? "var(--good)" : "var(--bad)",
                            }}
                          >
                            {track[a.type].medianAlpha >= 0 ? "+" : ""}
                            {track[a.type].medianAlpha}%
                          </span>{" "}
                          median 30d alpha, {track[a.type].hitRate}% hit, n={track[a.type].n}
                        </p>
                      )}
                    </div>
                    <button
                      onClick={() => ack({ id: a._id })}
                      className="shrink-0 text-[10px] text-transparent transition group-hover:text-[var(--muted)] hover:!text-[var(--text)]"
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>

      {ordered.length > VISIBLE_GROUPS && (
        <button
          onClick={() => setExpanded((v) => !v)}
          className="mt-2.5 text-[11px] text-[var(--muted)] hover:text-[var(--text)]"
        >
          {expanded ? "Show less" : `Show ${ordered.length - VISIBLE_GROUPS} more`}
        </button>
      )}
    </section>
  );
}
