"use client";

import { useEffect, useRef, useState } from "react";

export type LiveQuote = { last: number; prevClose?: number; asOf: number };

/**
 * Polls a live price while the page is actually being looked at.
 *
 * The stored price refreshes on a twelve-minute cron, which is right for the
 * evaluation but leaves the chart visibly stale if you sit on a page. This
 * fills the gap from the browser, which is free — it is the reader's own
 * connection rather than one server IP fetching on everyone's behalf.
 *
 * Three restraints, because "every few seconds" and "polite" have to be
 * reconciled: it stops entirely when the tab is hidden, it stops outside US
 * market hours when the number cannot move, and the route behind it caches for
 * ten seconds so extra tabs cost nothing upstream. Left running all day on a
 * visible tab this is a few hundred requests, not tens of thousands.
 */
export function useLiveQuote(ticker?: string, intervalMs = 8000): LiveQuote | null {
  const [quote, setQuote] = useState<LiveQuote | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!ticker) return;
    let cancelled = false;

    const poll = async () => {
      if (document.visibilityState !== "visible" || !marketMayBeOpen()) return;
      try {
        const res = await fetch(`/api/quote?ticker=${encodeURIComponent(ticker)}`);
        if (!res.ok) return;
        const j = (await res.json()) as LiveQuote & { error?: string };
        if (!cancelled && typeof j.last === "number") {
          setQuote({ last: j.last, prevClose: j.prevClose, asOf: j.asOf });
        }
      } catch {
        // A dropped poll is not worth surfacing — the next one is 8s away and
        // the stored price is still on screen.
      }
    };

    void poll();
    timer.current = setInterval(poll, intervalMs);

    const onVisible = () => {
      if (document.visibilityState === "visible") void poll();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      if (timer.current) clearInterval(timer.current);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [ticker, intervalMs]);

  return quote;
}

/**
 * Rough US session check in UTC, erring toward open.
 *
 * Deliberately crude: it ignores holidays and half-days, because the cost of
 * being wrong is one wasted request, while a strict check that drifts with
 * daylight saving would silently stop updating for an hour twice a year.
 */
function marketMayBeOpen(): boolean {
  const now = new Date();
  const day = now.getUTCDay();
  if (day === 0 || day === 6) return false;
  const h = now.getUTCHours();
  return h >= 13 && h < 21;
}
