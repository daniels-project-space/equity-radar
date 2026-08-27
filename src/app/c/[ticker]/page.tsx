"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { PriceChart } from "@/components/price-chart";
import {
  usd,
  bigUsd,
  pct,
  signedPct,
  mult,
  bps,
  num,
  isStale,
  VERDICT_COLOR,
  ACTION_COLOR,
  scoreColor,
} from "@/lib/format";
import { RefreshCw, Star, StarOff } from "lucide-react";

export default function CompanyPage() {
  const params = useParams<{ ticker: string }>();
  const ticker = (params.ticker ?? "").toUpperCase();

  const data = useQuery(api.watchlist.get, { ticker });
  const bars = useQuery(api.watchlist.priceSeries, { ticker, days: 1300 });
  const refresh = useAction(api.ingest.refreshTicker);
  const add = useMutation(api.watchlist.add);
  const remove = useMutation(api.watchlist.remove);
  const [busy, setBusy] = useState(false);

  if (data === undefined) return <p className="text-[12px] text-[var(--muted)]">Loading…</p>;
  if (data === null) return <p className="text-[12px] text-[var(--muted)]">{ticker} not found.</p>;

  const m = data.metrics;
  const p = data.priceStats;
  const s = data.score;
  const bandList = data.bands?.bands ?? [];
  const currentBand = bandList.find((b: { label: string }) => b.label === data.bands?.currentBand);

  async function doRefresh() {
    if (!data?.universe) return;
    setBusy(true);
    try {
      await refresh({ ticker, cik: data.universe.cik });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      {/* header */}
      <div className="panel flex flex-wrap items-start justify-between gap-4 p-5">
        <div>
          <div className="flex items-baseline gap-3">
            <h1 className="text-[22px] font-semibold">{ticker}</h1>
            <span className="text-[13px] text-[var(--muted)]">{data.universe?.name}</span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-[var(--muted)]">
            {data.universe?.exchange && <span className="chip">{data.universe.exchange}</span>}
            {data.universe?.industry && <span className="chip">{data.universe.industry}</span>}
            <span className="chip">Mkt cap {bigUsd(m?.marketCap)}</span>
            {m?.latestPeriodEnd && (
              <span
                className="chip"
                style={
                  isStale(m.latestPeriodEnd)
                    ? { color: "var(--warn)", borderColor: "var(--warn)" }
                    : undefined
                }
              >
                filed through {m.latestPeriodEnd}
                {isStale(m.latestPeriodEnd) && " · lagging"}
              </span>
            )}
            {data.bands && (
              <span className="chip">
                bands on {data.bands.basis === "fwdEps" ? "forward EPS" : data.bands.basis === "ttmEps" ? "TTM EPS" : "EV/Sales"} @ {data.bands.targetMultiple}x
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-5">
          <Stat label="Price" value={usd(p?.last)} sub={`${pct(p?.drawdownFromHigh, 0)} off high`} />
          <Stat
            label="Asymmetry"
            value={num(s?.asymmetry, 0)}
            color={scoreColor(s?.asymmetry)}
            sub="entry quality"
          />
          <Stat
            label="Composite"
            value={num(s?.composite, 0)}
            color={scoreColor(s?.composite)}
            sub="business quality"
          />
          <div className="text-right">
            <span
              className="chip text-[12px]"
              style={{
                color: VERDICT_COLOR[s?.verdict ?? "INSUFFICIENT_DATA"],
                borderColor: `${VERDICT_COLOR[s?.verdict ?? "INSUFFICIENT_DATA"]}55`,
              }}
            >
              {(s?.verdict ?? "—").replace(/_/g, " ")}
            </span>
            <div className="mt-2 flex justify-end gap-2">
              <button
                onClick={doRefresh}
                disabled={busy}
                className="chip flex items-center gap-1.5 hover:text-[var(--text)] disabled:opacity-50"
              >
                <RefreshCw size={11} className={busy ? "animate-spin" : ""} /> Refresh
              </button>
              {data.onWatchlist ? (
                <button
                  onClick={() => remove({ ticker })}
                  className="chip flex items-center gap-1.5 hover:text-[var(--text)]"
                >
                  <StarOff size={11} /> Remove
                </button>
              ) : (
                <button
                  onClick={() => add({ ticker })}
                  className="chip flex items-center gap-1.5 hover:text-[var(--text)]"
                >
                  <Star size={11} /> Watch
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* chart */}
      <div className="panel p-4">
        {bars && bars.length > 0 ? (
          <PriceChart bars={bars} bands={bandList} />
        ) : (
          <p className="py-16 text-center text-[12px] text-[var(--muted)]">
            No price history yet — hit Refresh.
          </p>
        )}
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr_380px]">
        <div className="space-y-5">
          {/* metrics */}
          <Panel title="Metrics">
            <div className="grid grid-cols-2 gap-x-6 gap-y-2.5 sm:grid-cols-3">
              <Metric label="Revenue TTM" value={bigUsd(m?.revenueTtm)} />
              <Metric label="Revenue YoY" value={signedPct(m?.revYoY)} good={(m?.revYoY ?? 0) > 0.15} />
              <Metric
                label="Acceleration"
                value={typeof m?.revAccel === "number" ? `${m.revAccel > 0 ? "+" : ""}${m.revAccel.toFixed(1)}pp` : "—"}
                good={(m?.revAccel ?? 0) > 0}
              />
              <Metric label="EPS TTM" value={usd(m?.epsTtm)} />
              <Metric label="EPS YoY" value={signedPct(m?.epsYoY)} good={(m?.epsYoY ?? 0) > 0.2} />
              <Metric label="Gross margin" value={pct(m?.grossMarginPct)} />
              <Metric label="GM trend" value={bps(m?.grossMarginDeltaYoY)} good={(m?.grossMarginDeltaYoY ?? 0) > 0} />
              <Metric label="Operating margin" value={pct(m?.opMarginPct)} />
              <Metric label="Net margin" value={pct(m?.netMarginPct)} />
              <Metric label="FCF TTM" value={bigUsd(m?.fcfTtm)} />
              <Metric label="FCF margin" value={pct(m?.fcfMarginPct)} />
              <Metric label="R&D intensity" value={pct(m?.rndIntensityPct)} />
              <Metric label="Dilution YoY" value={signedPct(m?.sharesYoY)} good={(m?.sharesYoY ?? 0) < 0.02} />
              <Metric label="Net cash" value={bigUsd(m?.netCash)} good={(m?.netCash ?? 0) > 0} />
              <Metric label="Net debt / EBITDA" value={num(m?.netDebtToEbitda, 2)} />
              <Metric label="P/E (TTM)" value={mult(m?.peTtm)} />
              <Metric label="P/E (forward)" value={mult(m?.fwdPe)} />
              <Metric label="EV / Sales" value={mult(m?.evToSales)} />
              <Metric label="P / FCF" value={mult(m?.pToFcf, 0)} />
              <Metric label="12m return" value={signedPct(p?.ret12m)} />
              <Metric label="3m return" value={signedPct(p?.ret3m)} />
            </div>
            {s?.missingInputs && s.missingInputs.length > 0 && (
              <p className="mt-3 border-t border-[var(--line)] pt-2 text-[10px] text-[var(--muted)]">
                Not available for this company: {s.missingInputs.join(", ")}. Those inputs are
                dropped from the score rather than assumed.
              </p>
            )}
          </Panel>

          {/* quarterly history */}
          <Panel title="Quarterly history">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-[11px] tabular">
                <thead className="text-[10px] uppercase tracking-wider text-[var(--muted)]">
                  <tr className="border-b border-[var(--line)]">
                    <th className="py-1.5 text-left font-medium">Period</th>
                    <th className="py-1.5 text-right font-medium">Revenue</th>
                    <th className="py-1.5 text-right font-medium">Gross margin</th>
                    <th className="py-1.5 text-right font-medium">Op income</th>
                    <th className="py-1.5 text-right font-medium">EPS</th>
                    <th className="py-1.5 text-right font-medium">Dil. shares</th>
                  </tr>
                </thead>
                <tbody>
                  {data.quarters.map((q) => (
                    <tr key={q._id} className="border-b border-[var(--line)] last:border-0">
                      <td className="py-1.5">
                        {q.fiscalPeriod}
                        <span className="ml-1.5 text-[var(--muted)]">{q.periodEnd}</span>
                      </td>
                      <td className="py-1.5 text-right">{bigUsd(q.revenue)}</td>
                      <td className="py-1.5 text-right">
                        {q.grossProfit && q.revenue ? pct(q.grossProfit / q.revenue) : "—"}
                      </td>
                      <td className="py-1.5 text-right">{bigUsd(q.opIncome)}</td>
                      <td className="py-1.5 text-right">{usd(q.epsDiluted)}</td>
                      <td className="py-1.5 text-right">
                        {q.sharesDiluted ? (q.sharesDiluted / 1e6).toFixed(1) + "M" : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-[10px] text-[var(--muted)]">
              GAAP figures parsed from SEC XBRL. Fiscal-Q4 rows are reconstructed by unwinding the
              annual total, which is the only way filers report them.
            </p>
          </Panel>
        </div>

        <div className="space-y-5">
          {/* buy bands */}
          <Panel title="Buy zones">
            {bandList.length === 0 && (
              <p className="text-[11px] text-[var(--muted)]">
                Not computable — needs positive EPS or revenue plus a share count.
              </p>
            )}
            {bandList.length > 0 && (
              <>
                <table className="w-full text-[11px] tabular">
                  <tbody>
                    {[...bandList].reverse().map((b) => {
                      const active = b.label === data.bands?.currentBand;
                      const color = ACTION_COLOR[b.action] ?? "#64748b";
                      return (
                        <tr
                          key={b.label}
                          className="border-b border-[var(--line)] last:border-0"
                          style={active ? { background: `${color}12` } : undefined}
                        >
                          <td className="py-1.5">
                            <span style={{ color }}>{b.label}</span>
                            {active && <span className="ml-1.5 text-[9px] text-[var(--muted)]">← now</span>}
                          </td>
                          <td className="py-1.5 text-right text-[var(--muted)]">
                            {b.multipleLo}–{b.multipleHi}x
                          </td>
                          <td className="py-1.5 text-right">
                            {usd(b.priceLo, 0)}–{usd(b.priceHi, 0)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <p className="mt-2 text-[10px] leading-snug text-[var(--muted)]">
                  Bands are {data.bands?.targetMultiple}x{" "}
                  {data.bands?.basis === "fwdEps"
                    ? "consensus forward EPS"
                    : data.bands?.basis === "ttmEps"
                      ? "trailing EPS"
                      : "EV/Sales"}
                  , scaled. They move as estimates and the peer group move — this table is
                  recomputed daily, not a fixed opinion.
                </p>
              </>
            )}
          </Panel>

          {/* score breakdown */}
          <Panel title="Score breakdown">
            {s ? (
              <div className="space-y-2">
                {(["growth", "quality", "valuation", "risk", "momentum"] as const).map((k) => (
                  <Bar key={k} label={k} value={s[k]} />
                ))}
                <Bar label="crowdedness" value={s.crowdedness} invert />
                <div className="mt-3 border-t border-[var(--line)] pt-2 text-[10px] leading-snug text-[var(--muted)]">
                  Crowdedness is subtracted, not added: it measures how much of the story the market
                  has already priced.
                </div>
              </div>
            ) : (
              <p className="text-[11px] text-[var(--muted)]">Not scored yet.</p>
            )}
          </Panel>

          {/* alerts + history */}
          <Panel title="Signals">
            {data.alerts.length === 0 && (
              <p className="text-[11px] text-[var(--muted)]">None fired yet.</p>
            )}
            <ul className="space-y-2">
              {data.alerts.slice(0, 8).map((a) => (
                <li key={a._id} className="text-[11px]">
                  <span className="font-medium">{a.title}</span>
                  <p className="text-[var(--muted)]">{a.detail}</p>
                  <span className="text-[9px] text-[var(--muted)]">
                    {new Date(a.firedAt).toLocaleDateString()}
                  </span>
                </li>
              ))}
            </ul>
          </Panel>

          <Panel title="Evaluation history">
            <ul className="space-y-1.5 text-[11px]">
              {data.evaluations.slice(0, 10).map((e) => (
                <li key={e._id} className="flex items-start justify-between gap-2">
                  <span className="text-[var(--muted)]">{e.date}</span>
                  <span className="flex-1 text-right">
                    {e.changesSincePrior.join(", ")}
                    <span className="ml-2" style={{ color: scoreColor(e.asymmetry) }}>
                      {e.asymmetry.toFixed(0)}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      </div>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="panel p-4">
      <h2 className="mb-3 text-[13px] font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function Stat({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="text-right">
      <div className="text-[10px] uppercase tracking-wider text-[var(--muted)]">{label}</div>
      <div className="text-[19px] font-semibold tabular" style={color ? { color } : undefined}>
        {value}
      </div>
      {sub && <div className="text-[10px] text-[var(--muted)]">{sub}</div>}
    </div>
  );
}

function Metric({ label, value, good }: { label: string; value: string; good?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-2 border-b border-[var(--line)] pb-1.5">
      <span className="text-[11px] text-[var(--muted)]">{label}</span>
      <span
        className="text-[12px] font-medium tabular"
        style={good === undefined ? undefined : { color: good ? "var(--good)" : undefined }}
      >
        {value}
      </span>
    </div>
  );
}

function Bar({ label, value, invert }: { label: string; value: number; invert?: boolean }) {
  const color = invert ? (value > 60 ? "var(--bad)" : "var(--muted)") : scoreColor(value);
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between text-[11px]">
        <span className="capitalize text-[var(--muted)]">{label}</span>
        <span className="tabular" style={{ color }}>
          {value.toFixed(0)}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-[var(--panel-2)]">
        <div className="h-full rounded-full" style={{ width: `${value}%`, background: color }} />
      </div>
    </div>
  );
}
