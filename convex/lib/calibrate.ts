/**
 * Signal calibration.
 *
 * The dip multipliers started as judgement: "reversing" got 1.3x, "falling"
 * 0.6x. That is a guess unless it is measured. This walks the price history of
 * every tracked name, records a set of causal signals at each point, and
 * measures what actually happened over the following 30 and 60 sessions.
 *
 * Three things make the naive version of this misleading, and all are handled:
 *
 * 1. OVERLAP. Observations are taken every 5 sessions but the forward window is
 *    30, so consecutive readings share most of their return path. Raw `n` is
 *    roughly 6x the number of independent observations. Treating it as
 *    independent makes almost anything look significant.
 *
 * 2. MULTIPLE COMPARISONS. Six signals with several buckets each means ~25
 *    tests. At a nominal 5% threshold, one or two will look significant purely
 *    by chance. The bar is raised accordingly.
 *
 * 3. CORRELATION ACROSS NAMES. The watchlist is largely one sector moving
 *    together, so even the de-overlapped count overstates independence. The
 *    shrinkage is deliberately conservative for that reason.
 *
 * The output is used two ways: shown, so every claim can be checked, and fed
 * back as conviction multipliers — shrunk toward neutral in proportion to how
 * weak the evidence is. A signal with no real edge ends up at 1.00x, which is
 * the honest answer, rather than at whatever its point estimate happens to be.
 */

import { featuresAt } from "./signals";
import type { DipBar } from "./dip";

/** Sessions between observations. */
const STEP = 5;
/** Forward window in sessions. */
const HORIZON = 30;
/** Independent-observation discount from window overlap. */
const OVERLAP = HORIZON / STEP;
/** Buckets with fewer independent readings than this are never acted on. */
const MIN_EFFECTIVE_N = 20;
/** Joins signal and bucket into one map key. Must not occur inside either. */
const SEP = "::";

export type BucketStat = {
  signal: string;
  bucket: string;
  n: number;
  effectiveN: number;
  median30: number;
  median60: number;
  hit30: number;
  /** Median forward 30d return minus the all-observations median, in pp. */
  edge30: number;
  /** Edge in standard errors. */
  tStat: number;
  /** 0-1 weight the edge is given after shrinkage. */
  confidence: number;
  significant: boolean;
  multiplier: number;
};

export type SignalStat = {
  signal: string;
  buckets: BucketStat[];
  /** Best bucket edge minus worst, in pp — how much the signal separates at all. */
  spread: number;
  maxAbsT: number;
  useful: boolean;
};

export type Calibration = {
  signals: SignalStat[];
  baseline30: number;
  observations: number;
  /** signal -> bucket -> multiplier, consumed by the allocator. */
  multipliers: Record<string, Record<string, number>>;
  /** True when nothing cleared the corrected threshold. */
  inconclusive: boolean;
  testsRun: number;
  criticalT: number;
  method: string;
  computedAt: number;
};

const median = (xs: number[]) => {
  if (xs.length === 0) return 0;
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

export function calibrate(assets: { ticker: string; bars: DipBar[] }[]): Calibration | null {
  // key = `${signal}${SEP}${bucket}`
  const fwd30 = new Map<string, number[]>();
  const fwd60 = new Map<string, number[]>();
  const all30: number[] = [];

  for (const a of assets) {
    const bars = a.bars;
    if (bars.length < 160) continue;

    for (let i = 70; i + 60 < bars.length; i += STEP) {
      const px = bars[i].c;
      if (px <= 0) continue;

      // The window ends at the decision bar, so no feature can see forward.
      const window = bars.slice(Math.max(0, i - 220), i + 1);
      const feats = featuresAt(window);
      if (feats.length === 0) continue;

      const r30 = bars[i + 30].c / px - 1;
      const r60 = bars[i + 60].c / px - 1;
      all30.push(r30);

      for (const f of feats) {
        const key = `${f.signal}${SEP}${f.bucket}`;
        if (!fwd30.has(key)) fwd30.set(key, []);
        if (!fwd60.has(key)) fwd60.set(key, []);
        fwd30.get(key)!.push(r30);
        fwd60.get(key)!.push(r60);
      }
    }
  }

  if (all30.length < 40) return null;
  const baseline30 = median(all30);
  const dispersion = stdev(all30);

  // With this many buckets under test, |t| = 2 is not a meaningful bar. The
  // threshold rises with the number of tests so that a single lucky bucket
  // cannot masquerade as a discovery.
  const testsRun = fwd30.size;
  const criticalT = Math.max(2, Math.sqrt(2 * Math.log(Math.max(2, testsRun))));

  const bySignal = new Map<string, BucketStat[]>();

  for (const [key, xs] of fwd30) {
    const [signal, bucket] = key.split(SEP);
    const ys = fwd60.get(key) ?? [];
    const edge = median(xs) - baseline30;

    // Standard error of a median is ~1.253x that of a mean, and the usable
    // sample is the overlap-adjusted count, not the raw one.
    const effectiveN = Math.max(1, xs.length / OVERLAP);
    const se = dispersion === 0 ? 0 : (1.2533 * dispersion) / Math.sqrt(effectiveN);
    const tStat = se === 0 ? 0 : edge / se;

    // Shrinkage toward neutral, scaled to the corrected threshold: half weight
    // at |t| = criticalT, approaching full weight only well beyond it.
    const thin = effectiveN < MIN_EFFECTIVE_N;
    const confidence = thin
      ? 0
      : clamp((tStat * tStat) / (tStat * tStat + criticalT * criticalT), 0, 1);

    const stat: BucketStat = {
      signal,
      bucket,
      n: xs.length,
      effectiveN: Math.round(effectiveN),
      median30: r1(median(xs) * 100),
      median60: r1(median(ys) * 100),
      hit30: Math.round((xs.filter((v) => v > 0).length / xs.length) * 100),
      edge30: r1(edge * 100),
      tStat: r2(tStat),
      confidence: r2(confidence),
      significant: !thin && Math.abs(tStat) >= criticalT,
      // Measured edge becomes a conviction multiplier only to the extent the
      // evidence supports it. The band is deliberately narrow — this tilts an
      // allocation, it does not drive one.
      multiplier: r2(clamp(1 + (r1(edge * 100) / 10) * confidence, 0.75, 1.25)),
    };

    if (!bySignal.has(signal)) bySignal.set(signal, []);
    bySignal.get(signal)!.push(stat);
  }

  const signals: SignalStat[] = [...bySignal.entries()]
    .map(([signal, buckets]) => {
      buckets.sort((a, b) => b.edge30 - a.edge30);
      const usable = buckets.filter((b) => b.effectiveN >= MIN_EFFECTIVE_N);
      const edges = usable.map((b) => b.edge30);
      return {
        signal,
        buckets,
        spread: edges.length ? r1(Math.max(...edges) - Math.min(...edges)) : 0,
        maxAbsT: usable.length ? r2(Math.max(...usable.map((b) => Math.abs(b.tStat)))) : 0,
        useful: buckets.some((b) => b.significant),
      };
    })
    .sort((a, b) => b.maxAbsT - a.maxAbsT);

  const multipliers: Record<string, Record<string, number>> = {};
  for (const s of signals) {
    multipliers[s.signal] = {};
    for (const b of s.buckets) multipliers[s.signal][b.bucket] = b.multiplier;
  }

  return {
    signals,
    baseline30: r1(baseline30 * 100),
    observations: all30.length,
    multipliers,
    inconclusive: !signals.some((s) => s.useful),
    testsRun,
    criticalT: r2(criticalT),
    method:
      `${STEP}-session step, ${HORIZON}-session forward window, overlap discount ${OVERLAP}x, ` +
      `${testsRun} buckets tested so the significance bar is |t| ≥ ${r2(criticalT)}, ` +
      `edges shrunk toward neutral below it`,
    computedAt: Date.now(),
  };
}
