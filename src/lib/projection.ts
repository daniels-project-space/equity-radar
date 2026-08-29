/**
 * What the current price could return over one, three and five years.
 *
 * This is a scenario, not a forecast, and the two assumptions behind it are
 * stated on screen rather than buried: fair value compounds at the growth rate
 * the business has earned the right to (delivered growth, capped by moat — see
 * convex/lib/expectations.ts), and the gap between today's price and fair value
 * closes gradually over about three years rather than instantly.
 *
 * The second assumption is the one that matters. A model that snaps price to
 * fair value in year one would show a 40% "expected return" for anything
 * trading at a discount, which is arithmetic dressed as insight — the whole
 * difficulty of value investing is that the gap can stay open for years. Three
 * years is a convention, not a measurement, and the spread below exists because
 * the point estimate should not be read as precise.
 */

export type Projection = {
  years: number;
  /** Same horizon under the bull case, when one is available. */
  bull?: number;
  /** Total return over the period, in %. */
  total: number;
  /** Annualised, in %. */
  annualised: number;
  /** Same, if the gap never closes and only the business compounds. */
  low: number;
  /** Same, if the gap closes and growth runs at the upper end. */
  high: number;
};

/** Years over which a price/value gap is assumed to close. */
const CONVERGENCE_YEARS = 3;
/** Years over which growth decays to the terminal rate. */
const FADE_YEARS = 10;
const TERMINAL_GROWTH = 0.025;

/**
 * Cumulative growth over `years`, with the rate fading toward terminal.
 *
 * Compounding a starting rate flat is what turned NVDA's projection into
 * +568% over five years: 35% held for five years is 4.5x on its own, before
 * any discount closes. Nothing grows at its current rate for five years and
 * then stops, and the DCF this borrows its inputs from already fades — not
 * fading here just made the two disagree.
 */
function fadedGrowth(g0: number, years: number): number {
  let acc = 1;
  for (let t = 1; t <= years; t++) {
    const g = g0 + (TERMINAL_GROWTH - g0) * Math.min(1, t / FADE_YEARS);
    acc *= 1 + g;
  }
  return acc;
}

export function projectReturns(input: {
  price?: number;
  fairValue?: number;
  /** Growth the business has earned the right to, as a fraction. */
  justifiedGrowth?: number;
  /** Method disagreement, 0-1.5 — widens the spread. */
  dispersion?: number;
  /** Where the growth number came from, passed through for display. */
  growthBasis?: string;
  /**
   * Upside in the bull case, from the scenario set. The projection compounds the
   * growth the filings support, which is capped at a documented 90th percentile
   * — deliberately, because that cap is what stopped the model justifying any
   * price. But quoting only that path understates a small, fast-re-rating
   * company, whose whole case is the tail. The bull path is carried alongside
   * rather than lifting the base, so the range widens without the central
   * estimate drifting into a story.
   */
  bullUpside?: number;
}): Projection[] | null {
  const { price, fairValue } = input;
  if (!price || price <= 0 || !fairValue || fairValue <= 0) return null;

  // A missing growth estimate is treated as a business that merely keeps pace
  // with inflation, which keeps the projection conservative rather than absent.
  const g = clamp(input.justifiedGrowth ?? 0.025, -0.05, 0.35);
  const spread = clamp(input.dispersion ?? 0.3, 0.1, 1.2);

  const at = (years: number, growth: number, converge: number): number => {
    const value = fairValue * fadedGrowth(growth, years);
    const closed = Math.min(1, years / CONVERGENCE_YEARS) * converge;
    const projected = price + (value - price) * closed;
    return projected / price - 1;
  };

  return [1, 3, 5].map((years) => {
    const total = at(years, g, 1);
    // Low: the discount never closes, only the business compounds.
    const low = at(years, g * 0.6, 0);
    // High: it closes fully and growth holds at the top of its range.
    const high = at(years, g * 1.25, 1) * (1 + spread * 0.15);
    // The bull case is a scenario about the next year or so, not a rate. It is
    // spread across the horizon so a five-year line does not simply repeat it.
    const bull =
      input.bullUpside === undefined
        ? undefined
        : r1((Math.pow(1 + input.bullUpside / 100, Math.min(1, years / 3)) - 1) * 100);

    return {
      years,
      total: r1(total * 100),
      annualised: r1((Math.pow(1 + total, 1 / years) - 1) * 100),
      low: r1(low * 100),
      high: r1(high * 100),
      bull,
    };
  });
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const r1 = (n: number) => Math.round(n * 10) / 10;
