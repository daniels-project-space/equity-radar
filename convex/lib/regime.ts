/**
 * Market regime, and how much to deploy because of it.
 *
 * The previous allocator answered one question — "is this cheap in absolute
 * terms?" — and went to 100% cash when the answer was no across the board. That
 * is the single most expensive mistake a valuation-driven system can make, and
 * it is well documented rather than a matter of taste:
 *
 *   AQR (Asness, Ilmanen, Maloney, "Market Timing: Sin a Little") tested
 *   CAPE-based contrarian timing over 1900-2015. It beat buy-and-hold by ~80bp
 *   a year across the full sample but added nothing from the 1950s onward, and
 *   the mechanism is exactly this failure: valuations drifted up for decades, so
 *   the strategy sat underweight — an 80% average position — the entire time.
 *   Dimensional put a number on the same point: CAPE explains ~29% of ten-year
 *   returns, which implies a timing rule beats buy-and-hold about 18% of the
 *   time. Worse than a coin flip.
 *
 * Their prescriptions are adopted here directly. Don't be binary: a 0%/100%
 * switch is the worst version of the idea. Act symmetrically: a rule that can
 * only refuse to buy is structurally biased to lose, because it only ever
 * declines exposure to something with a positive long-run return. And size the
 * tilt modestly — "sin a little".
 *
 * So valuation no longer decides *whether* to invest. It scales *how much*,
 * within a floor and a ceiling, and never reaches zero.
 */

export type Regime = {
  /** Fraction of a normal contribution to deploy. Never 0. */
  deploymentRate: number;
  /** Median upside across everything tracked, in %. */
  medianUpside: number;
  /** Share of tracked names trading below fair value, 0-1. */
  breadth: number;
  /** Spread between the cheapest and dearest quartile, in pp. */
  valueSpread: number;
  label: "broadly cheap" | "mixed" | "broadly expensive" | "stretched";
  summary: string;
  /** Standing caveat about what this number can and cannot do. */
  caveat: string;
};

/** Never fall below this: the sidelines have a cost and it compounds. */
export const MIN_DEPLOYMENT = 0.5;
/** Never exceed this: leaning in is allowed, but not without limit. */
export const MAX_DEPLOYMENT = 1.5;

const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const r1 = (n: number) => Math.round(n * 10) / 10;

export function readRegime(upsides: number[]): Regime {
  const xs = upsides.filter((x) => typeof x === "number" && Number.isFinite(x));

  if (xs.length < 3) {
    return {
      deploymentRate: 1,
      medianUpside: 0,
      breadth: 0,
      valueSpread: 0,
      label: "mixed",
      summary: "Too few scored names to read a regime — deploying a normal contribution.",
      caveat: CAVEAT,
    };
  }

  const sorted = [...xs].sort((a, b) => a - b);
  const med = median(xs);
  const breadth = xs.filter((x) => x > 0).length / xs.length;
  const q1 = sorted[Math.floor(sorted.length * 0.25)];
  const q3 = sorted[Math.floor(sorted.length * 0.75)];
  const valueSpread = q3 - q1;

  // Map the median discount to a deployment rate. Roughly: everything 30%+
  // above fair value halves the contribution, everything 30% below doubles the
  // tilt toward the ceiling, and fair value is a normal contribution. The slope
  // is deliberately gentle — the evidence says this signal is weak, so it earns
  // a small lever, not a switch.
  const deploymentRate = clamp(1 + med / 60, MIN_DEPLOYMENT, MAX_DEPLOYMENT);

  const label: Regime["label"] =
    med >= 15 ? "broadly cheap" : med >= -10 ? "mixed" : med >= -35 ? "broadly expensive" : "stretched";

  const summary =
    label === "broadly cheap"
      ? `Most of the list trades below fair value (median ${r1(med)}% upside, ${Math.round(breadth * 100)}% of names cheap). Leaning in at ${r1(deploymentRate)}x a normal contribution.`
      : label === "mixed"
        ? `Roughly fairly priced overall (median ${r1(med)}%, ${Math.round(breadth * 100)}% of names cheap). Deploying ${r1(deploymentRate)}x a normal contribution.`
        : `Almost everything tracked is expensive on absolute measures (median ${r1(med)}%, only ${Math.round(breadth * 100)}% of names below fair value). Trimming to ${r1(deploymentRate)}x rather than stopping — the spread between the cheapest and dearest quartile is still ${r1(valueSpread)}pp, so there is a meaningful relative choice to make.`;

  return {
    deploymentRate: Math.round(deploymentRate * 100) / 100,
    medianUpside: r1(med),
    breadth: Math.round(breadth * 100) / 100,
    valueSpread: r1(valueSpread),
    label,
    summary,
    caveat: CAVEAT,
  };
}

const CAVEAT =
  "This scales the size of a contribution, never to zero. Valuation is a poor market-timing " +
  "signal — CAPE-based timing added nothing over buy-and-hold from the 1950s on, because " +
  "valuations drift for decades and keep such rules underinvested. Treat it as a small tilt, " +
  "not a forecast.";
