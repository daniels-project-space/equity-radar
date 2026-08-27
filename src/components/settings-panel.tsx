"use client";

import { useEffect, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { X, BellRing } from "lucide-react";
import {
  currentState,
  subscribe as subscribePush,
  unsubscribe as unsubscribePush,
  type PushState,
} from "@/lib/push-client";

/**
 * Native Web Push. The browser's own push service delivers these at the OS
 * level, so an alert arrives whether or not the app is open.
 */
function PushSection() {
  const vapid = useQuery(api.notify.publicKey);
  const devices = useQuery(api.notify.deviceCount);
  const save = useMutation(api.notify.subscribe);
  const drop = useMutation(api.notify.unsubscribe);
  const sendTest = useAction(api.pushActions.sendTest);

  const [state, setState] = useState<PushState | "loading">("loading");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    currentState().then(setState);
  }, []);

  async function enable() {
    if (!vapid?.key) {
      setMessage("No VAPID key configured on the server.");
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const result = await subscribePush(vapid.key);
      if ("error" in result) {
        setMessage(result.error);
      } else {
        await save({ ...result, label: navigator.userAgent.slice(0, 60) });
        setState("subscribed");
        setMessage("This device will now receive alerts.");
      }
    } catch (e) {
      setMessage(String(e instanceof Error ? e.message : e).slice(0, 160));
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    try {
      const endpoint = await unsubscribePush();
      if (endpoint) await drop({ endpoint });
      setState("prompt");
      setMessage("This device will no longer receive alerts.");
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    setBusy(true);
    setMessage(null);
    try {
      const r = await sendTest({});
      setMessage(
        !r.configured
          ? "Server has no VAPID keys configured."
          : r.delivered > 0
            ? `Sent to ${r.delivered} device${r.delivered === 1 ? "" : "s"}.`
            : "No devices are subscribed yet."
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mb-7">
      <h3 className="mb-1 flex items-center gap-1.5 text-[12px] font-semibold">
        <BellRing size={12} /> Push notifications
      </h3>
      <p className="mb-3 text-[11px] leading-snug text-[var(--muted)]">
        Delivered by your browser&apos;s own push service — no third party. Works on desktop and
        Android; on iPhone, add the site to your home screen first.
      </p>

      {state === "unsupported" && (
        <p className="text-[11px] text-[var(--muted)]">This browser does not support push.</p>
      )}
      {state === "insecure" && (
        <p className="text-[11px] text-[var(--warn)]">
          Push requires https — open the deployed site rather than a local address.
        </p>
      )}
      {state === "denied" && (
        <p className="text-[11px] text-[var(--bad)]">
          Notifications are blocked for this site. Re-allow them in your browser&apos;s site
          settings, then reload.
        </p>
      )}

      {(state === "prompt" || state === "subscribed") && (
        <div className="flex flex-wrap items-center gap-2">
          {state === "prompt" ? (
            <button
              onClick={enable}
              disabled={busy}
              className="rounded-md border border-[var(--accent)] px-2.5 py-1 text-[11px] text-[var(--accent)] transition hover:bg-[var(--accent)]/10 disabled:opacity-50"
            >
              Enable on this device
            </button>
          ) : (
            <button
              onClick={disable}
              disabled={busy}
              className="rounded-md border border-[var(--line)] px-2.5 py-1 text-[11px] text-[var(--muted)] transition hover:text-[var(--text)] disabled:opacity-50"
            >
              Disable on this device
            </button>
          )}
          <button
            onClick={test}
            disabled={busy}
            className="rounded-md border border-[var(--line)] px-2.5 py-1 text-[11px] text-[var(--muted)] transition hover:text-[var(--text)] disabled:opacity-50"
          >
            Send test
          </button>
          {devices !== undefined && (
            <span className="text-[10px] text-[var(--muted)]">
              {devices} device{devices === 1 ? "" : "s"} subscribed
            </span>
          )}
        </div>
      )}

      {message && <p className="mt-2 text-[10px] text-[var(--muted)]">{message}</p>}
    </section>
  );
}

const ALERT_TYPES: { type: string; label: string }[] = [
  { type: "BUY_ZONE_ENTERED", label: "Entered a buy zone" },
  { type: "FUNDAMENTALS_UP_PRICE_DOWN", label: "Fundamentals up, price down" },
  { type: "OVERVALUED_EXIT", label: "Above the band table" },
  { type: "MOAT_WEAKENING", label: "Moat weakening" },
  { type: "MOAT_STRENGTHENING", label: "Moat strengthening" },
  { type: "PEER_LAGGING", label: "Lagging peers" },
  { type: "PEER_LEADING", label: "Leading peers" },
  { type: "MARGIN_COMPRESSION", label: "Margin compression" },
  { type: "DILUTION_SPIKE", label: "Dilution spike" },
  { type: "GROWTH_DECEL", label: "Growth decelerating" },
  { type: "VALUATION_STRETCHED", label: "Valuation stretched" },
  { type: "VERDICT_CHANGE", label: "Verdict changed" },
];

const SEVERITIES = ["medium", "high", "critical"] as const;

export function SettingsPanel({ onClose }: { onClose: () => void }) {
  const settings = useQuery(api.settings.all);
  const setBands = useMutation(api.settings.setGlobalBands);
  const setNotify = useMutation(api.settings.setGlobalNotify);
  const [multipleDraft, setMultipleDraft] = useState<string>("");

  if (!settings) return null;
  const { bands, notify } = settings.global;

  const toggleType = (type: string) => {
    const muted = notify.mutedTypes.includes(type)
      ? notify.mutedTypes.filter((t) => t !== type)
      : [...notify.mutedTypes, type];
    setNotify({ notify: { ...notify, mutedTypes: muted } });
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/50" onClick={onClose}>
      <div
        className="h-full w-full max-w-[420px] overflow-y-auto border-l border-[var(--line)] bg-[var(--panel)] p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-[15px] font-semibold">Settings</h2>
          <button onClick={onClose} className="text-[var(--muted)] hover:text-[var(--text)]">
            <X size={16} />
          </button>
        </div>

        <section className="mb-7">
          <h3 className="mb-1 text-[12px] font-semibold">Buy zones</h3>
          <p className="mb-3 text-[11px] leading-snug text-[var(--muted)]">
            Zones are a target multiple, scaled into bands. Track the peer median so zones
            re-rate with the sector, or pin a fixed multiple you believe in.
          </p>

          <div className="space-y-2">
            <label className="flex cursor-pointer items-start gap-2.5">
              <input
                type="radio"
                checked={bands.mode === "peerMedian"}
                onChange={() => setBands({ bands: { mode: "peerMedian" } })}
                className="mt-0.5 accent-[var(--accent)]"
              />
              <span className="text-[12px]">
                Peer median
                <span className="block text-[10px] text-[var(--muted)]">
                  Falls back to 26x when a peer group has fewer than 3 scored names.
                </span>
              </span>
            </label>

            <label className="flex cursor-pointer items-start gap-2.5">
              <input
                type="radio"
                checked={bands.mode === "fixed"}
                onChange={() =>
                  setBands({ bands: { mode: "fixed", fixedMultiple: bands.fixedMultiple ?? 25 } })
                }
                className="mt-0.5 accent-[var(--accent)]"
              />
              <span className="text-[12px]">
                Fixed multiple
                <span className="block text-[10px] text-[var(--muted)]">
                  Applies to every stock without its own override.
                </span>
              </span>
            </label>

            {bands.mode === "fixed" && (
              <div className="ml-6 flex items-center gap-2">
                <input
                  type="number"
                  min={3}
                  max={90}
                  step={0.5}
                  value={multipleDraft || String(bands.fixedMultiple ?? 25)}
                  onChange={(e) => setMultipleDraft(e.target.value)}
                  onBlur={() => {
                    const n = Number(multipleDraft);
                    if (Number.isFinite(n) && n >= 3 && n <= 90) {
                      setBands({ bands: { mode: "fixed", fixedMultiple: n } });
                    }
                    setMultipleDraft("");
                  }}
                  className="w-20 rounded-md border border-[var(--line)] bg-[var(--panel-2)] px-2 py-1 text-[12px] tabular outline-none focus:border-[var(--accent)]"
                />
                <span className="text-[11px] text-[var(--muted)]">x earnings</span>
              </div>
            )}
          </div>

          {settings.overrides.length > 0 && (
            <div className="mt-3 border-t border-[var(--line)] pt-2">
              <p className="mb-1 text-[10px] uppercase tracking-wider text-[var(--muted)]">
                Per-stock overrides
              </p>
              <ul className="space-y-0.5 text-[11px]">
                {settings.overrides.map((o) => (
                  <li key={o.ticker} className="flex justify-between">
                    <span>{o.ticker}</span>
                    <span className="text-[var(--muted)]">
                      {o.bands?.mode === "fixed" ? `${o.bands.fixedMultiple}x fixed` : "peer median"}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-1 text-[10px] text-[var(--muted)]">
                Set these on a company page.
              </p>
            </div>
          )}
        </section>

        <PushSection />

        <section>
          <h3 className="mb-1 text-[12px] font-semibold">Alert rules</h3>
          <p className="mb-3 text-[11px] leading-snug text-[var(--muted)]">
            These apply to both the in-app bell and push notifications.
          </p>

          <label className="mb-3 flex cursor-pointer items-center justify-between">
            <span className="text-[12px]">Enabled</span>
            <input
              type="checkbox"
              checked={notify.enabled}
              onChange={(e) => setNotify({ notify: { ...notify, enabled: e.target.checked } })}
              className="accent-[var(--accent)]"
            />
          </label>

          <div className="mb-4">
            <p className="mb-1.5 text-[11px] text-[var(--muted)]">Minimum level</p>
            <div className="flex gap-1">
              {SEVERITIES.map((s) => (
                <button
                  key={s}
                  onClick={() => setNotify({ notify: { ...notify, minSeverity: s } })}
                  className={`flex-1 rounded-md border px-2 py-1 text-[11px] capitalize transition ${
                    notify.minSeverity === s
                      ? "border-[var(--accent)] text-[var(--text)]"
                      : "border-[var(--line)] text-[var(--muted)] hover:text-[var(--text)]"
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          <p className="mb-1.5 text-[11px] text-[var(--muted)]">Types</p>
          <ul className="space-y-1">
            {ALERT_TYPES.map((t) => (
              <li key={t.type}>
                <label className="flex cursor-pointer items-center justify-between text-[11px]">
                  <span className={notify.mutedTypes.includes(t.type) ? "text-[var(--muted)]" : ""}>
                    {t.label}
                  </span>
                  <input
                    type="checkbox"
                    checked={!notify.mutedTypes.includes(t.type)}
                    onChange={() => toggleType(t.type)}
                    className="accent-[var(--accent)]"
                  />
                </label>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
