/**
 * Deterministic scoring. No LLM, no ML — explicit thresholds only, so every
 * score is decomposable back to the inputs that produced it.
 *
 * Two numbers matter:
 *   composite  — how good is this business, all-in
 *   asymmetry  — how good is this *entry*, i.e. business quality net of how
 *                expensive and how already-discovered it is
 *
 * They deliberately disagree. A company can be excellent (high composite) and
 * a poor entry (low asymmetry) because it has already re-rated 600%.
 */

export type ScoreInputs = {
  // growth
  revYoY?: number; // 0.45 = +45%
  revAccel?: number; // percentage points, revYoY - revYoYPrior
  epsYoY?: number;
  guidanceDelta?: number; // new guide midpoint vs prior, as a fraction
  // quality
  grossMarginPct?: number;
  grossMarginDeltaYoY?: number; // bps
  opMarginPct?: number;
  fcfMarginPct?: number;
  rndIntensityPct?: number;
  sharesYoY?: number; // 0.08 = 8% dilution
  // valuation
  fwdPe?: number;
  peTtm?: number;
  evToSales?: number;
  // risk
  netDebtToEbitda?: number;
  isGaapLoss?: boolean;
  netCash?: number;
  // momentum / crowding
  ret3m?: number;
  ret12m?: number;
  drawdownFromHigh?: number; // 0.42 = 42% off the high
  // peer context
  peerMedianFwdPe?: number;
  peerMedianEvToSales?: number;
};

export type Bucket = {
  score: number;
  parts: { key: string; raw: number | null; norm: number | null; weight: number }[];
  missing: string[];
};

export type ScoreResult = {
  growth: number;
  quality: number;
  valuation: number;
  risk: number;
  momentum: number;
  composite: number;
  crowdedness: number;
  asymmetry: number;
  verdict: Verdict;
  components: Record<string, Bucket>;
  missingInputs: string[];
};

export type Verdict =
  | "STRONG_BUY"
  | "BUY"
  | "ACCUMULATE"
  | "HOLD"
  | "TRIM"
  | "AVOID"
  | "INSUFFICIENT_DATA";

export const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));

/** Linear normalize into 0..100. `lo` may be greater than `hi` to invert. */
export function norm(value: number | undefined | null, lo: number, hi: number): number | null {
  if (value === undefined || value === null || !Number.isFinite(value)) return null;
  if (lo === hi) return 50;
  return clamp(((value - lo) / (hi - lo)) * 100);
}

/**
 * Weighted average that renormalizes over whatever inputs are present, so a
 * missing field dilutes confidence rather than silently scoring zero.
 */
function weigh(parts: { key: string; raw: number | null; norm: number | null; weight: number }[]): Bucket {
  const present = parts.filter((p) => p.norm !== null);
  const missing = parts.filter((p) => p.norm === null).map((p) => p.key);
  if (present.length === 0) return { score: 0, parts, missing };
  const totalWeight = present.reduce((s, p) => s + p.weight, 0);
  const score = present.reduce((s, p) => s + (p.norm as number) * p.weight, 0) / totalWeight;
  return { score: clamp(score), parts, missing };
}

function growthBucket(i: ScoreInputs): Bucket {
  return weigh([
    { key: "revYoY", raw: i.revYoY ?? null, norm: norm(i.revYoY, -0.1, 0.6), weight: 0.4 },
    { key: "revAccel", raw: i.revAccel ?? null, norm: norm(i.revAccel, -10, 15), weight: 0.25 },
    { key: "epsYoY", raw: i.epsYoY ?? null, norm: norm(i.epsYoY, -0.2, 1.0), weight: 0.25 },
    {
      key: "guidanceDelta",
      raw: i.guidanceDelta ?? null,
      norm: norm(i.guidanceDelta, -0.05, 0.1),
      weight: 0.1,
    },
  ]);
}

function qualityBucket(i: ScoreInputs): Bucket {
  return weigh([
    { key: "grossMargin", raw: i.grossMarginPct ?? null, norm: norm(i.grossMarginPct, 0.1, 0.7), weight: 0.25 },
    {
      key: "grossMarginTrend",
      raw: i.grossMarginDeltaYoY ?? null,
      norm: norm(i.grossMarginDeltaYoY, -300, 300),
      weight: 0.15,
    },
    { key: "fcfMargin", raw: i.fcfMarginPct ?? null, norm: norm(i.fcfMarginPct, -0.1, 0.35), weight: 0.2 },
    { key: "opMargin", raw: i.opMarginPct ?? null, norm: norm(i.opMarginPct, -0.15, 0.4), weight: 0.15 },
    { key: "rndIntensity", raw: i.rndIntensityPct ?? null, norm: norm(i.rndIntensityPct, 0, 0.25), weight: 0.1 },
    // inverted: heavy dilution is a quality defect, not just a risk
    { key: "dilution", raw: i.sharesYoY ?? null, norm: norm(i.sharesYoY, 0.15, 0.0), weight: 0.15 },
  ]);
}

/** Higher = cheaper relative to peers and to its own growth. */
function valuationBucket(i: ScoreInputs): Bucket {
  const pe = i.fwdPe ?? i.peTtm;
  const relPe =
    pe && i.peerMedianFwdPe && i.peerMedianFwdPe > 0 ? pe / i.peerMedianFwdPe : undefined;
  const relEvs =
    i.evToSales && i.peerMedianEvToSales && i.peerMedianEvToSales > 0
      ? i.evToSales / i.peerMedianEvToSales
      : undefined;
  const growthPct = i.revYoY !== undefined ? i.revYoY * 100 : undefined;
  const peg = pe && growthPct && growthPct > 0 ? pe / growthPct : undefined;

  return weigh([
    // inverted ranges: 1.8x the peer multiple scores 0, 0.5x scores 100
    { key: "peVsPeers", raw: relPe ?? null, norm: norm(relPe, 1.8, 0.5), weight: 0.3 },
    { key: "evsVsPeers", raw: relEvs ?? null, norm: norm(relEvs, 1.8, 0.5), weight: 0.2 },
    { key: "peAbsolute", raw: pe ?? null, norm: norm(pe, 55, 12), weight: 0.2 },
    { key: "evsAbsolute", raw: i.evToSales ?? null, norm: norm(i.evToSales, 20, 1.5), weight: 0.1 },
    { key: "peg", raw: peg ?? null, norm: norm(peg, 3.0, 0.4), weight: 0.2 },
  ]);
}

/** Higher = safer. Starts from the balance sheet, then applies flat penalties. */
function riskBucket(i: ScoreInputs): Bucket {
  const base = weigh([
    {
      key: "netDebtToEbitda",
      raw: i.netDebtToEbitda ?? null,
      norm: norm(i.netDebtToEbitda, 4.5, -1.0),
      weight: 0.6,
    },
    { key: "netCash", raw: i.netCash ?? null, norm: i.netCash === undefined ? null : i.netCash > 0 ? 100 : 40, weight: 0.4 },
  ]);
  let score = base.score;
  const parts = [...base.parts];
  if (i.isGaapLoss) {
    score -= 30;
    parts.push({ key: "gaapLossPenalty", raw: 1, norm: -30, weight: 0 });
  }
  if (i.sharesYoY !== undefined && i.sharesYoY > 0.08) {
    score -= 25;
    parts.push({ key: "dilutionPenalty", raw: i.sharesYoY, norm: -25, weight: 0 });
  }
  return { score: clamp(score), parts, missing: base.missing };
}

function momentumBucket(i: ScoreInputs): Bucket {
  return weigh([
    { key: "ret3m", raw: i.ret3m ?? null, norm: norm(i.ret3m, -0.3, 0.3), weight: 0.5 },
    { key: "ret12m", raw: i.ret12m ?? null, norm: norm(i.ret12m, -0.5, 0.8), weight: 0.5 },
  ]);
}

/**
 * How discovered is this already? High = the market has found it.
 * This is what separates "great company" from "great entry".
 */
function crowdednessBucket(i: ScoreInputs): Bucket {
  const notDrawnDown =
    i.drawdownFromHigh === undefined ? undefined : 1 - i.drawdownFromHigh;
  return weigh([
    { key: "ret12mCrowding", raw: i.ret12m ?? null, norm: norm(i.ret12m, -0.2, 2.0), weight: 0.45 },
    { key: "multipleCrowding", raw: i.evToSales ?? null, norm: norm(i.evToSales, 3, 25), weight: 0.35 },
    { key: "nearHighs", raw: notDrawnDown ?? null, norm: norm(notDrawnDown, 0.5, 1.0), weight: 0.2 },
  ]);
}

export function verdictFor(asymmetry: number, composite: number, missingCount: number): Verdict {
  if (missingCount > 8) return "INSUFFICIENT_DATA";
  if (asymmetry >= 75 && composite >= 60) return "STRONG_BUY";
  if (asymmetry >= 62) return "BUY";
  if (asymmetry >= 52) return "ACCUMULATE";
  if (asymmetry >= 40) return "HOLD";
  if (asymmetry >= 28) return "TRIM";
  return "AVOID";
}

export function score(i: ScoreInputs): ScoreResult {
  const growth = growthBucket(i);
  const quality = qualityBucket(i);
  const valuation = valuationBucket(i);
  const risk = riskBucket(i);
  const momentum = momentumBucket(i);
  const crowding = crowdednessBucket(i);

  const composite = clamp(
    0.3 * growth.score +
      0.25 * quality.score +
      0.2 * valuation.score +
      0.15 * risk.score +
      0.1 * momentum.score
  );

  // richness = how expensive; crowdedness = how already-found
  const qualityGrowth = 0.5 * growth.score + 0.5 * quality.score;
  const richness = 100 - valuation.score;
  const raw = qualityGrowth - 0.45 * richness - 0.35 * crowding.score;
  // raw spans [-80, 100] -> map onto 0..100
  const asymmetry = clamp(((raw + 80) / 180) * 100);

  const missingInputs = Array.from(
    new Set([
      ...growth.missing,
      ...quality.missing,
      ...valuation.missing,
      ...risk.missing,
      ...momentum.missing,
      ...crowding.missing,
    ])
  );

  return {
    growth: round1(growth.score),
    quality: round1(quality.score),
    valuation: round1(valuation.score),
    risk: round1(risk.score),
    momentum: round1(momentum.score),
    composite: round1(composite),
    crowdedness: round1(crowding.score),
    asymmetry: round1(asymmetry),
    verdict: verdictFor(asymmetry, composite, missingInputs.length),
    components: { growth, quality, valuation, risk, momentum, crowding },
    missingInputs,
  };
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/* ------------------------------------------------------------------ */
/* Buy bands — the shaded zones drawn on the price chart               */
/* ------------------------------------------------------------------ */

export type Band = {
  label: string;
  action: string;
  priceLo: number;
  priceHi: number;
  multipleLo: number;
  multipleHi: number;
};

/**
 * Band edges expressed as fractions of a target multiple, so the whole table
 * shifts automatically when the peer group re-rates or estimates move.
 */
const BAND_SHAPE: { label: string; action: string; lo: number; hi: number }[] = [
  { label: "Extremely attractive", action: "BUY_AGGRESSIVE", lo: 0.0, hi: 0.7 },
  { label: "Strong buy", action: "BUY", lo: 0.7, hi: 0.85 },
  { label: "Attractive", action: "BUY", lo: 0.85, hi: 1.0 },
  { label: "Accumulate", action: "ACCUMULATE", lo: 1.0, hi: 1.15 },
  { label: "Hold", action: "HOLD", lo: 1.15, hi: 1.35 },
  { label: "Expensive", action: "TRIM", lo: 1.35, hi: 2.2 },
];

export const DEFAULT_TARGET_PE = 26;
export const DEFAULT_TARGET_EVS = 6;

export type BandResult = {
  basis: "fwdEps" | "ttmEps" | "evSales";
  basisValue: number;
  targetMultiple: number;
  bands: Band[];
  currentBand?: string;
};

/**
 * Earnings-based bands when EPS is positive; falls back to EV/Sales for
 * loss-making names so a pre-profit company still gets a zone rather than
 * a blank panel.
 */
export function buildBands(args: {
  price?: number;
  fwdEps?: number;
  ttmEps?: number;
  revenueTtm?: number;
  netCash?: number;
  sharesDiluted?: number;
  peerMedianFwdPe?: number;
  peerMedianEvToSales?: number;
  targetMultipleOverride?: number;
}): BandResult | null {
  const {
    price,
    fwdEps,
    ttmEps,
    revenueTtm,
    netCash = 0,
    sharesDiluted,
    peerMedianFwdPe,
    peerMedianEvToSales,
    targetMultipleOverride,
  } = args;

  const eps = fwdEps && fwdEps > 0 ? fwdEps : ttmEps && ttmEps > 0 ? ttmEps : undefined;

  if (eps) {
    const target =
      targetMultipleOverride ??
      (peerMedianFwdPe && peerMedianFwdPe > 5 && peerMedianFwdPe < 90
        ? peerMedianFwdPe
        : DEFAULT_TARGET_PE);
    const bands = BAND_SHAPE.map((b) => ({
      label: b.label,
      action: b.action,
      multipleLo: r2(target * b.lo),
      multipleHi: r2(target * b.hi),
      priceLo: r2(eps * target * b.lo),
      priceHi: r2(eps * target * b.hi),
    }));
    return {
      basis: fwdEps && fwdEps > 0 ? "fwdEps" : "ttmEps",
      basisValue: eps,
      targetMultiple: r2(target),
      bands,
      currentBand: price ? bands.find((b) => price >= b.priceLo && price < b.priceHi)?.label : undefined,
    };
  }

  if (revenueTtm && revenueTtm > 0 && sharesDiluted && sharesDiluted > 0) {
    const target =
      targetMultipleOverride ??
      (peerMedianEvToSales && peerMedianEvToSales > 0.3 ? peerMedianEvToSales : DEFAULT_TARGET_EVS);
    const priceAt = (m: number) => (m * revenueTtm + netCash) / sharesDiluted;
    const bands = BAND_SHAPE.map((b) => ({
      label: b.label,
      action: b.action,
      multipleLo: r2(target * b.lo),
      multipleHi: r2(target * b.hi),
      priceLo: r2(priceAt(target * b.lo)),
      priceHi: r2(priceAt(target * b.hi)),
    }));
    return {
      basis: "evSales",
      basisValue: revenueTtm,
      targetMultiple: r2(target),
      bands,
      currentBand: price ? bands.find((b) => price >= b.priceLo && price < b.priceHi)?.label : undefined,
    };
  }

  return null;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export function median(values: number[]): number | undefined {
  const xs = values.filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (xs.length === 0) return undefined;
  const mid = Math.floor(xs.length / 2);
  return xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
}
