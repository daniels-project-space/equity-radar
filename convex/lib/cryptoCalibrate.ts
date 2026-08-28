/**
 * Crypto signals, held to the same standard as the equity ones.
 *
 * The TSMSV result looked strong — positive volatility-scaled momentum followed
 * by a median +20% over 90 days against a 7.9% baseline, on a 71% hit rate. But
 * it was reported from 730 observations per bucket taken at daily steps with a
 * 90-day forward window, which means consecutive readings share 89 of their 90
 * days. Treating that as 730 independent observations overstates the evidence by
 * roughly an order of magnitude, and this project has already been burned once
 * by exactly that: the first dip calibration confidently demoted a state on what
 * turned out to be noise.
 *
 * So the same three corrections apply here as in lib/calibrate.ts — overlap
 * discount, multiple-comparison correction, and shrinkage proportional to the
 * evidence — with one addition that matters more for crypto than for equities:
 *
 *   CYCLE COVERAGE. Bitcoin moves in roughly four-year cycles. A measure that
 *   claims to locate you within a cycle cannot be validated on less than
 *   several cycles, because inside a single one it is indistinguishable from
 *   trend. The MVRV history available free is four years — one cycle — so its
 *   result is reported with the number of cycles stated rather than as though
 *   sample length were a detail.
 */

export type CryptoBucket = {
  signal: string;
  bucket: string;
  n: number;
  effectiveN: number;
  medianFwd: number;
  hitRate: number;
  edge: number;
  tStat: number;
  significant: boolean;
};

export type CryptoSignalStat = {
  signal: string;
  buckets: CryptoBucket[];
  spread: number;
  maxAbsT: number;
  /** Years of history the signal was measured on. */
  years: number;
  /** Roughly how many four-year cycles that covers. */
  cycles: number;
  /** True when every bucket is below the independent-observation floor. */
  thin: boolean;
  useful: boolean;
  note: string;
};

export type CryptoCalibration = {
  signals: CryptoSignalStat[];
  /** Signals that should have been tested but whose data did not load. */
  missing: string[];
  baseline: number;
  horizonDays: number;
  observations: number;
  testsRun: number;
  criticalT: number;
  inconclusive: boolean;
  method: string;
  computedAt: number;
};

const HORIZON = 90;
const STEP = 5;
const OVERLAP = HORIZON / STEP;
const MIN_EFFECTIVE_N = 15;

const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};
const stdev = (xs: number[]) => {
  if (xs.length < 2) return 0;
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
};
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const r1 = (n: number) => Math.round(n * 10) / 10;
const r2 = (n: number) => Math.round(n * 100) / 100;

function annualisedVol(closes: number[]): number | null {
  const rets: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    if (closes[i - 1] > 0 && closes[i] > 0) rets.push(Math.log(closes[i] / closes[i - 1]));
  }
  if (rets.length < 20) return null;
  const m = rets.reduce((a, b) => a + b, 0) / rets.length;
  const v = rets.reduce((a, b) => a + (b - m) ** 2, 0) / (rets.length - 1);
  return Math.sqrt(v) * Math.sqrt(365);
}

/** Bucket by quintile of the signal's own distribution up to that point. */
function quintileLabel(rank: number): string {
  if (rank < 0.2) return "lowest fifth";
  if (rank < 0.4) return "low";
  if (rank < 0.6) return "middle";
  if (rank < 0.8) return "high";
  return "highest fifth";
}

export function calibrateCrypto(input: {
  dates: string[];
  closes: number[];
  /** Optional on-chain series aligned by date. */
  mvrvZ?: Record<string, number>;
  nupl?: Record<string, number>;
  sopr?: Record<string, number>;
  /** Signals that were meant to be tested, including any whose fetch failed. */
  intended?: string[];
}): CryptoCalibration | null {
  const { dates, closes } = input;
  if (dates.length !== closes.length || closes.length < 400) return null;

  type Obs = { signal: string; value: number; fwd: number; date: string };
  const obs: Obs[] = [];
  const all: number[] = [];

  for (let i = 150; i + HORIZON < closes.length; i += STEP) {
    const px = closes[i];
    if (px <= 0) continue;
    const fwd = closes[i + HORIZON] / px - 1;
    all.push(fwd);
    const d = dates[i];

    const vol = annualisedVol(closes.slice(i - 120, i + 1));
    if (vol && vol > 0 && i >= 240) {
      obs.push({ signal: "tsmsv", value: (px / closes[i - 90] - 1) / vol, fwd, date: d });
    }
    if (input.mvrvZ?.[d] !== undefined) obs.push({ signal: "mvrvZ", value: input.mvrvZ[d], fwd, date: d });
    if (input.nupl?.[d] !== undefined) obs.push({ signal: "nupl", value: input.nupl[d], fwd, date: d });
    if (input.sopr?.[d] !== undefined) obs.push({ signal: "sopr", value: input.sopr[d], fwd, date: d });
  }

  if (all.length < 40) return null;
  const baseline = median(all);
  const dispersion = stdev(all);

  const bySignal = new Map<string, Obs[]>();
  for (const o of obs) {
    if (!bySignal.has(o.signal)) bySignal.set(o.signal, []);
    bySignal.get(o.signal)!.push(o);
  }

  // The threshold counts every bucket the search intended to look at, not just
  // the ones whose data happened to arrive. A rate-limited fetch once dropped
  // SOPR silently, which moved the bar from |t| 2.45 to 2.33 — a significance
  // threshold that loosens when the network hiccups is not a threshold.
  const intended = input.intended ?? [...bySignal.keys()];
  const missing = intended.filter((s) => !bySignal.has(s));
  const testsRun = intended.length * 5;
  const criticalT = Math.max(2, Math.sqrt(2 * Math.log(Math.max(2, testsRun))));

  const signals: CryptoSignalStat[] = [];

  for (const [signal, rows] of bySignal) {
    const values = rows.map((r) => r.value).sort((a, b) => a - b);
    const rankOf = (v: number) => values.filter((x) => x < v).length / Math.max(1, values.length - 1);

    const groups = new Map<string, number[]>();
    for (const r of rows) {
      const k = quintileLabel(rankOf(r.value));
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k)!.push(r.fwd);
    }

    const buckets: CryptoBucket[] = [...groups.entries()]
      .map(([bucket, xs]) => {
        const edge = median(xs) - baseline;
        const effectiveN = Math.max(1, xs.length / OVERLAP);
        const se = dispersion === 0 ? 0 : (1.2533 * dispersion) / Math.sqrt(effectiveN);
        const t = se === 0 ? 0 : edge / se;
        const thin = effectiveN < MIN_EFFECTIVE_N;
        return {
          signal,
          bucket,
          n: xs.length,
          effectiveN: Math.round(effectiveN),
          medianFwd: r1(median(xs) * 100),
          hitRate: Math.round((xs.filter((v) => v > 0).length / xs.length) * 100),
          edge: r1(edge * 100),
          tStat: r2(t),
          significant: !thin && Math.abs(t) >= criticalT,
        };
      })
      .sort((a, b) => b.edge - a.edge);

    // Spread and max |t| are computed over every bucket, not just the ones that
    // clear the thinness floor. Filtering first made both display as 0 when no
    // bucket was thick enough, which reads as "no spread at all" rather than
    // "a wide spread that cannot be trusted" — the opposite of the point.
    const edges = buckets.map((b) => b.edge);
    const thin = buckets.every((b) => b.effectiveN < MIN_EFFECTIVE_N);
    const days = new Set(rows.map((r) => r.date)).size * STEP;
    const years = r1(days / 365);
    const cycles = r1(days / 365 / 4);

    signals.push({
      signal,
      buckets,
      spread: edges.length ? r1(Math.max(...edges) - Math.min(...edges)) : 0,
      maxAbsT: buckets.length ? r2(Math.max(...buckets.map((b) => Math.abs(b.tStat)))) : 0,
      thin,
      years,
      cycles,
      useful: buckets.some((b) => b.significant),
      note:
        (signal === "tsmsv"
          ? `Measured over ${years} years. Volatility-scaled momentum is a trend measure rather than a cycle measure, so cycle coverage matters less for it than the overlap problem does.`
          : `Measured over ${years} years — about ${cycles} of Bitcoin's roughly four-year cycles. A cycle measure needs several cycles before it can be told apart from trend.`) +
        (thin
          ? ` Every bucket falls below ${MIN_EFFECTIVE_N} independent observations once overlapping windows are discounted, so the spread below describes this history without being evidence about the next one.`
          : ""),
    });
  }

  signals.sort((a, b) => b.maxAbsT - a.maxAbsT);

  return {
    signals,
    missing,
    baseline: r1(baseline * 100),
    horizonDays: HORIZON,
    observations: all.length,
    testsRun,
    criticalT: r2(criticalT),
    inconclusive: !signals.some((s) => s.useful),
    method:
      `${STEP}-day step, ${HORIZON}-day forward window, overlap discount ${OVERLAP}x, ` +
      `${testsRun} buckets counted toward the bar of |t| >= ${r2(criticalT)}` +
      (missing.length ? `; ${missing.join(", ")} did not load and is counted anyway` : ""),
    computedAt: Date.now(),
  };
}
