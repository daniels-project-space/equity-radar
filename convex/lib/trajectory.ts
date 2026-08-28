/**
 * Growth as the filings actually show it.
 *
 * The projection used to run on `revYoY` — one year-over-year reading, capped
 * by a moat bucket. That is a single noisy number carrying five years of
 * compounding: NVDA's 90% and Intel's 5% are both one observation each, and a
 * cyclical trough or a boom quarter sets the whole outlook.
 *
 * This derives the estimate from the full filed history instead:
 *
 *   - Revenue growth measured over three years and two years, not one, so a
 *     single quarter cannot dominate.
 *   - Free cash flow conversion, because revenue growth that does not turn into
 *     cash is not growth an owner receives.
 *   - Share count, because per-share is what a holder gets. A business growing
 *     15% while issuing 5% of itself a year delivers 10% to existing owners,
 *     and the old model quietly ignored that.
 *   - Stability, measured as dispersion of quarterly year-over-year growth,
 *     which decides how much of the estimate is trusted rather than being
 *     presented as equally solid for a utility and a semiconductor.
 *
 * Every figure comes from filed quarters. Nothing here is an analyst estimate.
 */

export type Quarter = {
  periodEnd: string;
  revenue?: number;
  operatingCashFlow?: number;
  capex?: number;
  sharesDiluted?: number;
  netIncome?: number;
};

export type Trajectory = {
  /** Blended annual growth rate the filings support, as a fraction. */
  growth: number;
  /** Same, after subtracting share issuance — what an owner actually compounds. */
  perShareGrowth: number;
  cagr3y?: number;
  cagr2y?: number;
  latestYoY?: number;
  /** Annualised change in diluted share count. Positive = dilution. */
  shareGrowth?: number;
  /** Free cash flow as a share of revenue, trailing twelve months. */
  fcfMargin?: number;
  /** Dispersion of quarterly YoY growth — high means the estimate is shaky. */
  volatility?: number;
  /** 0-1: how much weight the estimate deserves. */
  confidence: number;
  /** Plain-language statement of where the number came from. */
  basis: string;
  quartersUsed: number;
};

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const r1 = (n: number) => Math.round(n * 1000) / 10;

/** TTM total of `field` ending at index `i` (quarters newest-first). */
function ttm(qs: Quarter[], i: number, field: "revenue" | "netIncome"): number | undefined {
  const slice = qs.slice(i, i + 4);
  if (slice.length < 4) return undefined;
  const vals = slice.map((q) => q[field]).filter((v): v is number => typeof v === "number");
  if (vals.length < 4) return undefined;
  return sum(vals);
}

function cagr(now: number, then: number, years: number): number | undefined {
  if (!(now > 0) || !(then > 0) || years <= 0) return undefined;
  return Math.pow(now / then, 1 / years) - 1;
}

/**
 * Annualised share issuance, with stock splits removed.
 *
 * Filed share counts are not retroactively split-adjusted across periods, so a
 * naive count-then-versus-count-now comparison reads a 10-for-1 split as
 * dilution. NVDA came through at 240% a year, which turned its per-share growth
 * to -105% and knocked a quarter off its fair value.
 *
 * Splits are separated from issuance by size and speed: a company can issue a
 * few percent of itself in a quarter, but a 40%+ jump in one quarter is a
 * corporate action, not a financing. Those steps are divided out and the
 * remaining quarter-on-quarter changes compounded, which keeps genuine heavy
 * issuers honest — Strategy really does issue ~39% a year, and still does after
 * this.
 */
function dilutionRate(qs: Quarter[]): number | undefined {
  const counts: number[] = [];
  for (const q of qs.slice(0, 13)) {
    if (typeof q.sharesDiluted === "number" && q.sharesDiluted > 0) counts.push(q.sharesDiluted);
    else return undefined;
  }
  if (counts.length < 5) return undefined;

  // counts[0] is newest, so walk backwards through time.
  let compounded = 1;
  let steps = 0;
  for (let i = counts.length - 1; i > 0; i--) {
    const ratio = counts[i - 1] / counts[i];
    // A split (or reverse split) shows up as a large single-quarter step.
    if (ratio > 1.4 || ratio < 0.72) continue;
    compounded *= ratio;
    steps++;
  }
  if (steps < 4) return undefined;
  const years = steps / 4;
  return Math.pow(compounded, 1 / years) - 1;
}

const stdev = (xs: number[]) => {
  if (xs.length < 2) return 0;
  const m = sum(xs) / xs.length;
  return Math.sqrt(sum(xs.map((x) => (x - m) ** 2)) / (xs.length - 1));
};

/**
 * @param quarters newest first, as stored.
 */
export function readTrajectory(quarters: Quarter[]): Trajectory | null {
  const qs = quarters.filter((q) => q.periodEnd);
  if (qs.length < 5) return null;

  const revNow = ttm(qs, 0, "revenue");
  const rev2y = ttm(qs, 8, "revenue");
  const rev3y = ttm(qs, 12, "revenue");
  const rev1y = ttm(qs, 4, "revenue");

  const cagr3y = revNow && rev3y ? cagr(revNow, rev3y, 3) : undefined;
  const cagr2y = revNow && rev2y ? cagr(revNow, rev2y, 2) : undefined;
  const latestYoY = revNow && rev1y ? cagr(revNow, rev1y, 1) : undefined;

  // Longer windows get more weight — they contain more information and less
  // noise. If only the short window exists the estimate leans on it, and the
  // confidence below reflects that.
  const parts: { v: number; w: number }[] = [];
  if (cagr3y !== undefined) parts.push({ v: cagr3y, w: 0.45 });
  if (cagr2y !== undefined) parts.push({ v: cagr2y, w: 0.35 });
  if (latestYoY !== undefined) parts.push({ v: latestYoY, w: 0.2 });
  if (parts.length === 0) return null;

  const wsum = sum(parts.map((p) => p.w));
  const growth = sum(parts.map((p) => p.v * p.w)) / wsum;

  const shareGrowth = dilutionRate(qs);

  // Cash conversion, trailing twelve months.
  const ocf = sum(
    qs.slice(0, 4).map((q) => q.operatingCashFlow ?? 0)
  );
  const capex = sum(qs.slice(0, 4).map((q) => Math.abs(q.capex ?? 0)));
  const fcfMargin = revNow && revNow > 0 ? (ocf - capex) / revNow : undefined;

  // Stability of quarterly year-over-year growth.
  const yoys: number[] = [];
  for (let i = 0; i + 4 < qs.length && yoys.length < 8; i++) {
    const a = qs[i].revenue;
    const b = qs[i + 4].revenue;
    if (a && b && b > 0) yoys.push(a / b - 1);
  }
  const volatility = yoys.length >= 3 ? stdev(yoys) : undefined;

  // Confidence: more history and steadier growth earn more of the estimate.
  let confidence = 0.4;
  if (cagr3y !== undefined) confidence += 0.3;
  else if (cagr2y !== undefined) confidence += 0.15;
  if (volatility !== undefined) confidence += volatility < 0.15 ? 0.2 : volatility < 0.35 ? 0.1 : 0;
  if (fcfMargin !== undefined && fcfMargin > 0.05) confidence += 0.1;
  confidence = clamp(confidence, 0.2, 1);

  // What an owner compounds is growth net of the shares issued to fund it.
  const perShareGrowth = growth - (shareGrowth ?? 0);

  const bits: string[] = [];
  if (cagr3y !== undefined) bits.push(`${r1(cagr3y)}% over three years`);
  if (cagr2y !== undefined) bits.push(`${r1(cagr2y)}% over two`);
  if (latestYoY !== undefined) bits.push(`${r1(latestYoY)}% in the last twelve months`);
  const dilutionClause =
    shareGrowth === undefined
      ? ""
      : shareGrowth > 0.005
        ? ` Share count grew ${r1(shareGrowth)}% a year, leaving ${r1(perShareGrowth)}% per share.`
        : shareGrowth < -0.005
          ? ` Buybacks shrank the count ${r1(-shareGrowth)}% a year, lifting it to ${r1(perShareGrowth)}% per share.`
          : "";

  return {
    growth,
    perShareGrowth,
    cagr3y,
    cagr2y,
    latestYoY,
    shareGrowth,
    fcfMargin,
    volatility,
    confidence: Math.round(confidence * 100) / 100,
    quartersUsed: qs.length,
    basis:
      `Revenue grew ${bits.join(", ")}, from ${qs.length} filed quarters.` +
      dilutionClause +
      (fcfMargin !== undefined
        ? ` ${r1(fcfMargin)}% of revenue converts to free cash flow.`
        : ""),
  };
}
