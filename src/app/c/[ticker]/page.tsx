"use client";

import { useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { PriceChart } from "@/components/price-chart";
import { Disclosure } from "@/components/disclosure";
import { keyFacts, TONE_COLOR } from "@/lib/key-facts";
import { signalLabel } from "@/lib/signal-label";
import { projectReturns } from "@/lib/projection";
import { rangeContext } from "@/lib/range-context";
import { useLiveQuote } from "@/lib/use-live-quote";
import {
  usd,
  bigUsd,
  pct,
  signedPct,
  mult,
  bps,
  num,
  pctOrNm,
  multOrNm,
  isStale,
  ARCHETYPE_LABEL,
  CONFIDENCE_COLOR,
  VERDICT_COLOR,
  ACTION_COLOR,
  scoreColor,
} from "@/lib/format";
import { SEVERITY_COLOR, type Severity } from "@/lib/notify";
import { DIP_LABEL, DIP_COLOR } from "@/lib/dip-labels";
import { ValuationLadder } from "@/components/valuation-ladder";
import {
  MethodBars,
  PillarBars,
  Projections,
  PeerTable,
  ExpectationsPanel,
  ReturnOutlook,
  RangePanel,
  ProfilePanel,
  ScenarioPanel,
  LinkagePanel,
  CyclePanel,
  type Method,
  type Pillar,
  type PeerRow,
} from "@/components/insight-panels";
import { RefreshCw, Star, StarOff } from "lucide-react";

export default function CompanyPage() {
  const params = useParams<{ ticker: string }>();
  const ticker = (params.ticker ?? "").toUpperCase();

  const data = useQuery(api.watchlist.get, { ticker });
  // Ten years. The anchor series now reaches back that far, and the zone
  // crossings can only be drawn where both exist — asking for five years of
  // bars threw away half the marks the model had already worked out.
  const series = useQuery(api.watchlist.priceSeries, { ticker, days: 2600 });
  // The query is columnar to avoid restating the field names 1,300 times. It is
  // widened back here, once, so every consumer below keeps working on bars.
  const bars = useMemo(() => {
    if (!series?.d) return undefined;
    const { d, c, o, h, l } = series as {
      d: string[];
      c: number[];
      o?: number[];
      h?: number[];
      l?: number[];
    };
    return d.map((date, i) => ({
      date,
      c: c[i],
      o: o ? o[i] : c[i],
      h: h ? h[i] : c[i],
      l: l ? l[i] : c[i],
      v: 0,
    }));
  }, [series]);
  const cryptoAsset = data?.metrics?.assetType === "crypto" ? ticker.toLowerCase() : undefined;
  const costBasis = useQuery(
    api.watchlist.costBasisSeries,
    cryptoAsset ? { asset: cryptoAsset } : "skip"
  );
  const refresh = useAction(api.ingest.refreshTicker);
  const add = useMutation(api.watchlist.add);
  const remove = useMutation(api.watchlist.remove);
  const [busy, setBusy] = useState(false);
  const isCrypto = data?.metrics?.assetType === "crypto";
  // Only for equities. The quote route resolves symbols on a stock exchange,
  // where several crypto tickers also exist as unrelated listings — "BTC" is a
  // Grayscale trust quoted near $34 while Bitcoin trades near $78,000. Polling
  // it for a crypto asset would overwrite the price with a different security.
  const live = useLiveQuote(isCrypto ? undefined : ticker);

  if (data === undefined) return <p className="text-[12px] text-[var(--muted)]">Loading…</p>;
  if (data === null) return <p className="text-[12px] text-[var(--muted)]">{ticker} not found.</p>;

  const m = data.metrics;
  // The live quote overrides the stored one for anything the reader sees as
  // "now" — price, day change, the zone the price falls in, and the return
  // outlook, which is quoted off the price you would actually pay.
  const stored = data.priceStats;
  const p = stored
    ? { ...stored, last: live?.last ?? stored.last, prevClose: live?.prevClose ?? stored.prevClose }
    : stored;
  const s = data.score;
  const b = data.bands;
  const bandList = b?.bands ?? [];
  const pillars = (m?.moatPillars ?? []) as Pillar[];
  const methods = (b?.methods ?? []) as Method[];
  const verdict = s?.verdict ?? "—";
  const upside = b?.upside;
  // Derived on every render rather than read from stored alert rows, so these
  // lines cannot contradict the chart or outlive the model that wrote them.
  const facts = keyFacts({ ticker, price: p, bands: b, metrics: m, score: s });
  const sig = signalLabel(s?.verdict, p?.dipState, p?.dipScore);
  // What the chart itself says, independent of the valuation. For names that
  // have traded far outside their zone table this is the missing half.
  const range = bars?.length ? rangeContext(bars.map((x) => x.c), bandList) : null;

  /**
   * Zones built from the volume profile - where this actually traded.
   *
   * The fundamental table is the honest answer to "what is it worth", and for a
   * structural grower it can sit so far under the market that its buy zone has
   * never been touched. A level nobody can reach is not a level. The value area
   * is reachable by construction because it is made of prices that happened,
   * so the chart can always offer somewhere to act even when the valuation
   * cannot. It replaces nothing: fair value and the verdict are untouched.
   */
  const prof = p?.profile as
    | { val?: number; poc?: number; vah?: number; basis?: string }
    | undefined;
  // Deliberately not a useMemo: this sits below the early returns for the
  // loading and not-found states, and a hook after a conditional return changes
  // the hook count between renders. It is five objects; memoising it bought
  // nothing and cost every detail page.
  const profileBands = (() => {
    const val = prof?.val, poc = prof?.poc, vah = prof?.vah;
    if (!val || !poc || !vah || !(vah > val) || !(poc >= val && poc <= vah)) return undefined;
    const span = vah - val;
    const mk = (label: string, action: string, lo: number, hi: number) => ({
      label, action, priceLo: lo, priceHi: hi,
      // Multiples are relative to the point of control, which is the one price
      // in a profile that means something on its own.
      multipleLo: lo / poc, multipleHi: hi / poc,
    });
    return [
      mk("Below everything it traded", "BUY_AGGRESSIVE", Math.max(0, val - span), val),
      mk("Lower value area", "BUY", val, poc),
      mk("Upper value area", "ACCUMULATE", poc, vah),
      mk("Above the value area", "HOLD", vah, vah + span * 0.5),
      mk("Far above where it traded", "TRIM", vah + span * 0.5, vah + span * 1.5),
    ];
  })();
  // Only on the detail view — a tile has room for what a stock is, not for a
  // five-year scenario with a range attached.
  // Not computed for crypto. The projection compounds a fair value at the growth
  // a business has earned; realized price is a cost basis, not a fair value, and
  // there are no earnings to grow. Compounding it at a default rate would be a
  // forecast with nothing behind it.
  const lv = m?.buyLevels as
    | {
        intrinsic?: number;
        relative?: number;
        blended?: number;
        relativeWeight?: number;
        discountToPrice?: number;
        summary?: string;
      }
    | undefined;

  const outlook = isCrypto ? null : projectReturns({
    price: p?.last,
    fairValue: b?.fairValue,
    justifiedGrowth:
      m?.expectations?.justifiedGrowth === undefined
        ? undefined
        : m.expectations.justifiedGrowth / 100,
    growthBasis: m?.trajectory?.basis,
    dispersion: b?.dispersion,
    bullUpside: (m?.scenarios?.scenarios ?? []).find(
      (x: { key: string }) => x.key === "bull"
    )?.upside,
  });

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
      {/* ---- the decision, as one line ---- */}
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h1 className="text-[20px] font-semibold">{ticker}</h1>
            <span className="text-[13px] text-[var(--muted)]">{data.universe?.name}</span>
          </div>

          <p className="mt-1.5 text-[14px] leading-relaxed">
            <span className="font-semibold tabular">{usd(p?.last)}</span>
            {upside !== undefined && (
              <>
                <span className="text-[var(--muted)]"> · </span>
                <span
                  className="tabular"
                  style={{ color: upside >= 0 ? "var(--good)" : "var(--bad)" }}
                >
                  {Math.abs(upside)}% {upside >= 0 ? "below" : "above"} fair value
                </span>
                <span className="text-[var(--muted)]"> of {usd(b?.fairValue)}</span>
              </>
            )}
            <span className="text-[var(--muted)]"> · </span>
            {/* Crypto has no verdict because it has no filings to score, so the
                header showed "Not enough data" beside ten years of history. The
                tiles were fixed for this; the header was missed. */}
            <span
              style={{
                color: isCrypto
                  ? "var(--muted)"
                  : sig.fallingKnife
                    ? "var(--warn)"
                    : VERDICT_COLOR[verdict],
              }}
              title={
                isCrypto
                  ? "Not scored on filings — this is where it sits against the price the network paid."
                  : sig.hint
              }
            >
              {isCrypto
                ? (m?.cycle?.hasOnChain ? (m.cycle.zone ?? "cycle unknown") : "price only")
                : sig.headline}
            </span>
          </p>

          <p className="mt-1 text-[11px] leading-relaxed text-[var(--muted)]">
            {b?.archetype && (
              <>
                {ARCHETYPE_LABEL[b.archetype] ?? b.archetype}, valued on {b.anchorLabel}
                {b.confidence && (
                  <>
                    {" at "}
                    <span style={{ color: CONFIDENCE_COLOR[b.confidence] }}>
                      {b.confidence} confidence
                    </span>
                  </>
                )}
                {". "}
              </>
            )}
            {m?.moatSummary}
            {p?.dipState && p.dipState !== "none" && (
              <>
                {" "}
                <span style={{ color: DIP_COLOR[p.dipState] }}>
                  {DIP_LABEL[p.dipState]}
                  {p.dipState !== "noVolume" && ` (${p.dipScore}/100)`}
                </span>
                {p.dipEvidence && <span> — {p.dipEvidence}.</span>}
              </>
            )}
            {isStale(m?.latestPeriodEnd) && (
              <span className="text-[var(--warn)]"> Filings lag — through {m?.latestPeriodEnd}.</span>
            )}
          </p>
        </div>

        <div className="flex items-center gap-4">
          <Stat label="Asymmetry" value={num(s?.asymmetry, 0)} color={scoreColor(s?.asymmetry)} />
          <Stat label="Moat" value={num(m?.moatScore, 0)} color={scoreColor(m?.moatScore)} />
          <div className="flex flex-col gap-1.5">
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
      </header>

      {/* ---- the chart ---- */}
      <div className="panel p-4">
        {bars && bars.length > 0 ? (
          <PriceChart
            bars={bars}
            bands={bandList}
            fairValue={b?.fairValue}
            earningsDates={data.earningsDates}
            costBasis={
              isCrypto
                ? (costBasis ?? undefined)
                : (m?.anchorHistory as { date: string; value: number }[] | undefined)
            }
            closesOnly={isCrypto}
            relativeBands={m?.relativeBands?.bands}
            buyLevel={m?.buyLevels?.blended}
            profileBands={profileBands}
            profileNote={
              prof?.val && prof?.vah && prof?.poc
                ? `Value area covers the bulk of the last year's traded volume: $${Math.round(prof.val)} to $${Math.round(prof.vah)}, heaviest at $${Math.round(prof.poc)}.`
                : undefined
            }
            relativeNote={
              m?.relativeBands
                ? `Measured over ${Math.max(1, Math.round((m.relativeBands.observations ?? 0) / 252))} years.` +
                  ` Over that window the anchor itself ranged ${m.relativeBands.anchorSpread}x against ${m.relativeBands.priceSpread}x for the price, so ${m.relativeBands.denominatorShare}x more of the ratio's movement is the denominator than the stock — read the percentile as a rough guide, not a level.`
                : undefined
            }
          />
        ) : (
          <p className="py-16 text-center text-[12px] text-[var(--muted)]">
            No price history yet — hit Refresh.
          </p>
        )}
      </div>

      {/* ---- the valuation, as a single strip ---- */}
      {bandList.length > 0 && (
        <div className="panel px-4 pb-3 pt-4">
          <ValuationLadder
            bands={bandList}
            price={p?.last}
            fairValue={b?.fairValue}
            currentBand={b?.currentBand}
          />
          {isCrypto ? (
            <p className="mt-1 text-[10px] text-[var(--muted)]">
              Zones are this asset&rsquo;s own history of trading above and below the price the
              network paid — quantiles of that ratio, not a margin of safety around a valuation.
            </p>
          ) : (
            b?.marginOfSafety !== undefined && (
              <p className="mt-1 text-[10px] text-[var(--muted)]">
                {Math.round(b.marginOfSafety * 100)}% margin of safety — the zones widen
                automatically when the valuation methods disagree.
              </p>
            )
          )}
        </div>
      )}

      {/* ---- three answers, side by side ---- */}
      <div className="grid gap-3 lg:grid-cols-3">
        <Column title={m?.assetType === "crypto" ? "Where it sits" : "What it's worth"}>
          {m?.assetType === "crypto" && m?.cycle ? (
            <CyclePanel data={m.cycle} price={p?.last} />
          ) : (
            <MethodBars methods={methods} price={p?.last} />
          )}
          {m?.assetType !== "crypto" && m?.expectations && (
            <ExpectationsPanel data={m.expectations} />
          )}
          {m?.scenarios && <ScenarioPanel data={m.scenarios} />}
          {outlook && (
            <ReturnOutlook rows={outlook} price={p?.last} basis={m?.trajectory?.basis} />
          )}
        </Column>

        {/* Moat pillars are read from filings, so the heading changes for an
            asset that has none rather than labelling a column of price
            statistics as a quality assessment. */}
        <Column title={isCrypto ? "How it behaves" : "How good it is"}>
          {m?.linkage && <LinkagePanel data={m.linkage} />}
          {!isCrypto && lv?.blended !== undefined && (
            <div className="rounded-xl border border-[var(--line)] bg-[var(--panel)] p-4">
              <h3 className="text-[11px] uppercase tracking-wide text-[var(--muted)]">
                Where to buy
              </h3>
              <p className="mt-2 text-[20px] font-semibold tabular" style={{ color: "var(--good)" }}>
                {usd(lv.blended)}
                {lv.discountToPrice !== undefined && (
                  <span className="ml-2 text-[13px] font-normal text-[var(--muted)]">
                    {Math.abs(lv.discountToPrice)}% below today
                  </span>
                )}
              </p>
              <div className="mt-3 grid grid-cols-2 gap-3 text-[12px]">
                <div>
                  <div className="text-[var(--muted)]">On cash flows</div>
                  <div className="tabular">{usd(lv.intrinsic)}</div>
                </div>
                <div>
                  <div className="text-[var(--muted)]">On its own record</div>
                  <div className="tabular">{usd(lv.relative)}</div>
                </div>
              </div>
              {lv.relativeWeight !== undefined && (
                <div className="mt-3">
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--panel-2)]">
                    <div
                      className="h-full rounded-full bg-[var(--good)]"
                      style={{ width: `${Math.round(lv.relativeWeight * 100)}%` }}
                    />
                  </div>
                  <p className="mt-1 text-[11px] text-[var(--muted)]">
                    {Math.round(lv.relativeWeight * 100)}% of the blend comes from its own trading
                    record — earned by how many quarters that record covers and how steady the
                    multiple has been, not chosen.
                  </p>
                </div>
              )}
              {lv.summary && (
                <p className="mt-3 text-[12px] leading-relaxed text-[var(--muted)]">{lv.summary}</p>
              )}
            </div>
          )}
          {range && <RangePanel data={range} price={p?.last} />}
          {p?.profile && <ProfilePanel data={p.profile} price={p?.last} />}
          {!isCrypto && <PillarBars pillars={pillars} />}
        </Column>

        {/* Guidance and forward multiples come from earnings releases. Bitcoin
            was being shown "no guidance found in the latest earnings release"
            and an empty P/E row, which describes a filing it will never make. */}
        {!isCrypto && (
        <Column title="What's next">
          <Projections
            revYoY={m?.revYoY}
            guidedGrowth={m?.guidedGrowth}
            guidancePeriod={m?.guidancePeriod}
            guidanceRevLow={m?.guidanceRevLow}
            guidanceRevHigh={m?.guidanceRevHigh}
            guidanceEpsLow={m?.guidanceEpsLow}
            guidanceEpsHigh={m?.guidanceEpsHigh}
            fwdPe={m?.fwdPe}
            peTtm={m?.peTtm}
            fwdEpsBasis={m?.fwdEpsBasis}
            sourceUrl={m?.guidanceSourceUrl}
          />
        </Column>
        )}
      </div>

      {/* ---- competitors ---- */}
      {/* Peers are found by SEC industry code, which crypto has none of. */}
      {!isCrypto && (
      <Column title="Closest competitors">
        <PeerTable
          rows={(m?.peerRows ?? []) as PeerRow[]}
          self={{
            ticker,
            name: data.universe?.name ?? ticker,
            marketCap: m?.marketCap,
            revYoY: m?.revYoY,
            grossMarginPct: m?.grossMarginPct,
            fwdPe: m?.fwdPe ?? m?.peTtm,
            moatScore: m?.moatScore,
            asymmetry: s?.asymmetry,
            upside: b?.upside,
          }}
        />
      </Column>
      )}

      {/* ---- the short version, computed live so it cannot go stale ---- */}
      {facts.length > 0 && (
        <section className="panel p-4">
          <h2 className="mb-2.5 text-[11px] uppercase tracking-wider text-[var(--muted)]">
            What matters now
          </h2>
          <ul className="space-y-2">
            {facts.map((f, i) => (
              <li key={i} className="flex items-start gap-2.5">
                <span
                  className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{ background: TONE_COLOR[f.tone] }}
                />
                <p className="text-[12px] leading-relaxed">{f.text}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ---- everything else, on request ---- */}
      <div className="panel px-4">
        <Disclosure title="Valuation detail" hint={`how the ${methods.length} methods combine`}>
          <table className="w-full text-[11px] tabular">
            <tbody>
              {[...bandList].reverse().map((band) => {
                const active = band.label === b?.currentBand;
                const color = ACTION_COLOR[band.action] ?? "#64748b";
                return (
                  <tr
                    key={band.label}
                    className="border-b border-[var(--line)] last:border-0"
                    style={active ? { background: `${color}12` } : undefined}
                  >
                    <td className="py-1.5" style={{ color }}>
                      {band.label}
                      {active && <span className="ml-1.5 text-[9px] text-[var(--muted)]">← now</span>}
                    </td>
                    <td className="py-1.5 text-right">
                      {usd(band.priceLo, 0)}–{usd(band.priceHi, 0)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <ul className="mt-3 space-y-1">
            {methods.map((mt) => (
              <li key={mt.key} className="text-[10px] text-[var(--muted)]">
                <span className="text-[var(--text)]">{mt.label}</span> {usd(mt.perShare)} — {mt.basis}
              </li>
            ))}
          </ul>
          <ZoneOverride ticker={ticker} />
          {m?.fwdEpsBasis && m.fwdEpsBasis !== "consensus" && (
            <p className="mt-2 text-[10px] leading-snug text-[var(--warn)]">
              Forward EPS is <strong>{m.fwdEpsBasis}</strong>, not analyst consensus.
              {m.fwdEpsBasis === "guided"
                ? " Rolled forward using management's own guided quarter."
                : " Trailing EPS grown by the damped median of recent YoY rates."}
            </p>
          )}
        </Disclosure>

        <Disclosure title="Moat pillars" hint={m?.moatScore !== undefined ? `${m.moatScore}/100` : undefined}>
          <ul className="space-y-2.5">
            {pillars.map((pl) => (
              <li key={pl.key}>
                <div className="mb-1 flex items-baseline justify-between gap-2 text-[11px]">
                  <span>{pl.label}</span>
                  <span className="tabular" style={{ color: scoreColor(pl.level) }}>
                    {pl.level === undefined ? "—" : Math.round(pl.level)}
                  </span>
                </div>
                {pl.level !== undefined && (
                  <div className="h-1 overflow-hidden rounded-full bg-[var(--panel-2)]">
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${pl.level}%`, background: scoreColor(pl.level) }}
                    />
                  </div>
                )}
                <p className="mt-1 text-[10px] leading-snug text-[var(--muted)]">{pl.evidence}</p>
              </li>
            ))}
          </ul>
        </Disclosure>

        <Disclosure title="All metrics" hint="every figure behind the summary">
          <div className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3">
            <Metric label="Revenue TTM" value={bigUsd(m?.revenueTtm)} />
            <Metric label="Revenue YoY" value={signedPct(m?.revYoY)} />
            <Metric
              label="Acceleration"
              value={typeof m?.revAccel === "number" ? `${m.revAccel > 0 ? "+" : ""}${m.revAccel.toFixed(1)}pp` : "—"}
            />
            <Metric label={`EPS TTM (${m?.epsBasis ?? "gaap"})`} value={usd(m?.epsTtm)} />
            <Metric label="EPS YoY" value={signedPct(m?.epsYoY)} />
            <Metric label="Gross margin" value={pctOrNm(m?.grossMarginPct)} />
            <Metric label="GM trend" value={bps(m?.grossMarginDeltaYoY)} />
            <Metric label="Operating margin" value={pctOrNm(m?.opMarginPct)} />
            <Metric label="Net margin" value={pctOrNm(m?.netMarginPct)} />
            <Metric label="FCF TTM" value={bigUsd(m?.fcfTtm)} />
            <Metric label="FCF margin" value={pctOrNm(m?.fcfMarginPct)} />
            <Metric label="R&D intensity" value={pct(m?.rndIntensityPct)} />
            <Metric label="Dilution YoY" value={signedPct(m?.sharesYoY)} />
            <Metric label="Net cash" value={bigUsd(m?.netCash)} />
            <Metric label="Net debt / EBITDA" value={num(m?.netDebtToEbitda, 2)} />
            <Metric label="P/E (TTM)" value={multOrNm(m?.peTtm, 200)} />
            <Metric label="P/E (forward)" value={mult(m?.fwdPe)} />
            <Metric label="EV / Sales" value={multOrNm(m?.evToSales)} />
            <Metric label="P / FCF" value={multOrNm(m?.pToFcf, 200, 0)} />
            <Metric label="Market cap" value={bigUsd(m?.marketCap)} />
            <Metric label="12m return" value={signedPct(p?.ret12m)} />
          </div>
          {s?.missingInputs && s.missingInputs.length > 0 && (
            <p className="mt-3 text-[10px] text-[var(--muted)]">
              Not available for this company: {s.missingInputs.join(", ")}. Dropped from the score
              rather than assumed.
            </p>
          )}
        </Disclosure>

        <Disclosure title="Quarterly history" hint={`${data.quarters.length} quarters as filed`}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-[11px] tabular">
              <thead className="text-[10px] uppercase tracking-wider text-[var(--muted)]">
                <tr className="border-b border-[var(--line)]">
                  <th className="py-1.5 text-left font-medium">Period</th>
                  <th className="py-1.5 text-right font-medium">Revenue</th>
                  <th className="py-1.5 text-right font-medium">GM</th>
                  <th className="py-1.5 text-right font-medium">EPS</th>
                  <th className="py-1.5 text-right font-medium">Adj EPS</th>
                </tr>
              </thead>
              <tbody>
                {data.quarters.map((q) => (
                  <tr key={q._id} className="border-b border-[var(--line)] last:border-0">
                    <td className="py-1.5">{q.fiscalPeriod}</td>
                    <td className="py-1.5 text-right">{bigUsd(q.revenue)}</td>
                    <td className="py-1.5 text-right">
                      {q.grossProfit && q.revenue ? pct(q.grossProfit / q.revenue, 0) : "—"}
                    </td>
                    <td className="py-1.5 text-right">{usd(q.epsDiluted)}</td>
                    <td className="py-1.5 text-right">
                      {q.adjEps !== undefined ? (
                        q.adjEpsSourceUrl ? (
                          <a
                            href={q.adjEpsSourceUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="underline decoration-dotted hover:text-[var(--accent)]"
                          >
                            {usd(q.adjEps)}
                          </a>
                        ) : (
                          usd(q.adjEps)
                        )
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[10px] text-[var(--muted)]">
            GAAP from SEC XBRL; fiscal-Q4 reconstructed by unwinding the annual total. Adjusted EPS
            is extracted from the 8-K release and links to its source.
          </p>
        </Disclosure>

        <Disclosure title="Score breakdown" hint="what each input contributed">
          {s ? (
            <div className="space-y-2">
              {(["growth", "quality", "valuation", "risk", "momentum"] as const).map((k) => (
                <Bar key={k} label={k} value={s[k]} />
              ))}
              <Bar label="crowdedness" value={s.crowdedness} invert />
              <p className="pt-1 text-[10px] leading-snug text-[var(--muted)]">
                Crowdedness is subtracted, not added — it measures how much of the story the market
                has already priced.
              </p>
            </div>
          ) : (
            <Muted>Not scored yet.</Muted>
          )}
        </Disclosure>

        <Disclosure title="Evaluation history" hint={`what the rating did over ${data.evaluations.length} runs`}>
          <ul className="space-y-1 text-[11px]">
            {data.evaluations.slice(0, 15).map((e) => (
              <li key={e._id} className="flex items-start justify-between gap-3">
                <span className="text-[var(--muted)]">{e.date}</span>
                <span className="flex-1 text-right">{e.changesSincePrior.join(", ")}</span>
              </li>
            ))}
          </ul>
        </Disclosure>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- */

function Column({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="panel p-4">
      <h2 className="mb-2.5 text-[11px] uppercase tracking-wider text-[var(--muted)]">{title}</h2>
      <div className="space-y-0.5">{children}</div>
    </section>
  );
}

function Row({
  label,
  hint,
  strong,
  children,
}: {
  label: string;
  hint?: string;
  strong?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between gap-2 py-0.5 text-[11px]">
      <span className="text-[var(--muted)]">
        {label}
        {hint && <span className="ml-1.5 opacity-60">{hint}</span>}
      </span>
      <span className={`tabular ${strong ? "font-medium" : ""}`}>{children}</span>
    </div>
  );
}

const Muted = ({ children }: { children: React.ReactNode }) => (
  <p className="pt-1.5 text-[10px] leading-snug text-[var(--muted)]">{children}</p>
);

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="text-right">
      <div className="text-[10px] uppercase tracking-wider text-[var(--muted)]">{label}</div>
      <div className="text-[18px] font-semibold tabular" style={color ? { color } : undefined}>
        {value}
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2 border-b border-[var(--line)] pb-1">
      <span className="text-[10px] text-[var(--muted)]">{label}</span>
      <span className="text-[11px] tabular">{value}</span>
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
      <div className="h-1 overflow-hidden rounded-full bg-[var(--panel-2)]">
        <div className="h-full rounded-full" style={{ width: `${value}%`, background: color }} />
      </div>
    </div>
  );
}

/** Per-stock valuation anchor. Clearing it falls back to the global preset. */
function ZoneOverride({ ticker }: { ticker: string }) {
  const settings = useQuery(api.settings.all);
  const setTickerBands = useMutation(api.settings.setTickerBands);
  const [draft, setDraft] = useState("");

  const override = settings?.overrides.find((o) => o.ticker === ticker);

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-[var(--line)] pt-2.5">
      <span className="text-[10px] uppercase tracking-wider text-[var(--muted)]">Anchor</span>
      <input
        type="number"
        min={0.5}
        max={90}
        step={0.5}
        placeholder={override?.bands?.fixedMultiple ? String(override.bands.fixedMultiple) : "auto"}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          const n = Number(draft);
          if (Number.isFinite(n) && n >= 0.5 && n <= 90) {
            setTickerBands({ ticker, bands: { mode: "fixed", fixedMultiple: n } });
          }
          setDraft("");
        }}
        className="w-20 rounded-md border border-[var(--line)] bg-[var(--panel-2)] px-2 py-0.5 text-[11px] tabular outline-none focus:border-[var(--accent)]"
      />
      <span className="text-[10px] text-[var(--muted)]">
        {override ? `pinned at ${override.bands?.fixedMultiple}x` : "following global"}
      </span>
      {override && (
        <button
          onClick={() => setTickerBands({ ticker, bands: null })}
          className="text-[10px] text-[var(--muted)] hover:text-[var(--text)]"
        >
          clear
        </button>
      )}
    </div>
  );
}
