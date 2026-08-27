"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { Search, Loader2 } from "lucide-react";

/**
 * Add a company by ticker or name. Selecting a result adds it to the watchlist
 * and immediately runs the full ingest so the chart and scores are populated
 * by the time the dossier opens, rather than waiting for the nightly cron.
 */
export function TickerSearch() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  const results = useQuery(api.universe.search, debounced ? { q: debounced, limit: 8 } : "skip");
  const add = useMutation(api.watchlist.add);
  const refresh = useAction(api.ingest.refreshTicker);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 180);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  async function pick(ticker: string, cik: string) {
    setBusy(ticker);
    setError(null);
    try {
      await add({ ticker, reason: "added from search" });
      // Fire the first evaluation now; this takes a few seconds.
      await refresh({ ticker, cik });
      setQ("");
      setOpen(false);
      router.push(`/c/${ticker}`);
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e).slice(0, 200));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div ref={boxRef} className="relative w-full max-w-md">
      <div className="flex items-center gap-2 rounded-xl border border-[var(--line)] bg-[var(--panel-2)] px-3 py-2">
        <Search size={15} className="text-[var(--muted)]" />
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder="Add a company — ticker or name"
          className="w-full bg-transparent text-[13px] outline-none placeholder:text-[var(--muted)]"
        />
        {busy && <Loader2 size={14} className="animate-spin text-[var(--accent)]" />}
      </div>

      {open && debounced && results && results.length > 0 && (
        <ul className="panel absolute z-30 mt-1 w-full overflow-hidden py-1">
          {results.map((r) => (
            <li key={r.ticker}>
              <button
                disabled={!!busy}
                onClick={() => pick(r.ticker, r.cik)}
                className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-[var(--panel-2)] disabled:opacity-50"
              >
                <span className="flex items-baseline gap-2">
                  <span className="text-[13px] font-semibold">{r.ticker}</span>
                  <span className="truncate text-[12px] text-[var(--muted)]">{r.name}</span>
                </span>
                <span className="text-[10px] text-[var(--muted)]">{r.exchange}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {busy && (
        <p className="mt-2 text-[11px] text-[var(--muted)]">
          Pulling SEC filings and prices for {busy} — this takes a few seconds.
        </p>
      )}
      {error && <p className="mt-2 text-[11px] text-[var(--bad)]">{error}</p>}
    </div>
  );
}
