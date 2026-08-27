"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { Bell, BellOff, Settings2 } from "lucide-react";
import { TickerSearch } from "./ticker-search";
import { SettingsPanel } from "./settings-panel";
import { visibleAlerts, SEVERITY_COLOR, type NotifyPrefs } from "@/lib/notify";

export function TopBar() {
  const alerts = useQuery(api.alerts.recent, { limit: 60, unacknowledgedOnly: true });
  const settings = useQuery(api.settings.all);
  const ack = useMutation(api.alerts.acknowledge);
  const ackAll = useMutation(api.alerts.acknowledgeAll);
  const setNotify = useMutation(api.settings.setGlobalNotify);

  const [showBell, setShowBell] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const bellRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (bellRef.current && !bellRef.current.contains(e.target as Node)) setShowBell(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const prefs = settings?.global.notify as NotifyPrefs | undefined;
  const shown = visibleAlerts(alerts ?? [], prefs);

  return (
    <>
      <header className="mb-7 flex items-center gap-3">
        <Link href="/" className="flex shrink-0 items-center gap-2.5">
          <span className="grid h-8 w-8 place-items-center rounded-lg border border-[var(--line)] bg-[var(--panel-2)] text-[11px] font-semibold text-[var(--accent)]">
            ER
          </span>
          <span className="hidden text-[14px] font-semibold sm:block">Equity Radar</span>
        </Link>

        <Link
          href="/journal"
          className="hidden shrink-0 text-[11px] text-[var(--muted)] transition hover:text-[var(--text)] sm:block"
        >
          Journal
        </Link>

        <div className="flex-1" />
        <TickerSearch />

        <div ref={bellRef} className="relative shrink-0">
          <button
            onClick={() => setShowBell((v) => !v)}
            className="relative grid h-9 w-9 place-items-center rounded-xl border border-[var(--line)] bg-[var(--panel-2)] text-[var(--muted)] transition hover:text-[var(--text)]"
            aria-label="Notifications"
          >
            {prefs?.enabled === false ? <BellOff size={15} /> : <Bell size={15} />}
            {shown.length > 0 && (
              <span className="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-[var(--accent)] px-1 text-[9px] font-semibold text-black">
                {shown.length > 99 ? "99+" : shown.length}
              </span>
            )}
          </button>

          {showBell && (
            <div className="panel absolute right-0 z-40 mt-2 max-h-[70vh] w-[340px] overflow-y-auto p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-[12px] font-semibold">Notifications</span>
                <div className="flex items-center gap-2">
                  {prefs && (
                    <button
                      onClick={() => setNotify({ notify: { ...prefs, enabled: !prefs.enabled } })}
                      className="text-[10px] text-[var(--muted)] hover:text-[var(--text)]"
                    >
                      {prefs.enabled ? "turn off" : "turn on"}
                    </button>
                  )}
                  {shown.length > 0 && (
                    <button
                      onClick={() => ackAll({})}
                      className="text-[10px] text-[var(--muted)] hover:text-[var(--text)]"
                    >
                      clear all
                    </button>
                  )}
                </div>
              </div>

              {prefs?.enabled === false && (
                <p className="py-6 text-center text-[11px] text-[var(--muted)]">
                  Notifications are off. Signals are still recorded.
                </p>
              )}

              {prefs?.enabled !== false && shown.length === 0 && (
                <p className="py-6 text-center text-[11px] text-[var(--muted)]">Nothing new.</p>
              )}

              <ul className="space-y-2.5">
                {shown.map((a) => (
                  <li
                    key={a._id}
                    className="border-l-2 pl-2.5"
                    style={{ borderColor: SEVERITY_COLOR[a.severity] }}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <Link
                        href={`/c/${a.ticker}`}
                        onClick={() => setShowBell(false)}
                        className="text-[11px] font-medium hover:underline"
                      >
                        {a.title}
                      </Link>
                      <button
                        onClick={() => ack({ id: a._id })}
                        className="shrink-0 text-[10px] text-[var(--muted)] hover:text-[var(--text)]"
                      >
                        ×
                      </button>
                    </div>
                    <p className="mt-0.5 text-[10px] leading-snug text-[var(--muted)]">{a.detail}</p>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <button
          onClick={() => setShowSettings(true)}
          className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-[var(--line)] bg-[var(--panel-2)] text-[var(--muted)] transition hover:text-[var(--text)]"
          aria-label="Settings"
        >
          <Settings2 size={15} />
        </button>
      </header>

      {showSettings && <SettingsPanel onClose={() => setShowSettings(false)} />}
    </>
  );
}
