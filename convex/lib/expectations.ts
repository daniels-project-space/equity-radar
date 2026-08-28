/**
 * Expectations investing — what the price already assumes.
 *
 * A fair-value estimate answers "what is it worth?", which requires forecasting
 * growth, margins and duration, and then presents a point estimate with false
 * precision. Worse, when the whole market is expensive, every name fails at
 * once and the system says "buy nothing" — which is a statement about the
 * regime, not about the company.
 *
 * This inverts it, following Rappaport and Mauboussin: take the price as given
 * and solve for the growth the market is already paying for. The question stops
 * being "is this cheap?" and becomes "is what the market expects plausible?" —
 * which is answerable from history and moat evidence, stays informative when
 * everything is expensive, and does not collapse to a binary.
 *
 * A high-multiple compounder priced for growth it has actually delivered is a
 * different proposition from one priced for growth nobody has ever sustained.
 * A fair-value gate cannot tell those apart. This can.
 */

export type Expectations = {
  /** Annual FCF growth over the horizon implied by today's price. */
  impliedGrowth: number;
  /** What the business has actually been doing, for comparison. */
  referenceGrowth?: number;
  horizonYears: number;
  discountRate: number;
  terminalGrowth: number;
  /** How demanding the implied growth is against the reference. */
  verdict: "undemanding" | "in line" | "demanding" | "heroic" | "unpriceable";
  /** Plain-language statement of what the buyer is underwriting. */
  summary: string;
  /** Gap in pp between implied and reference growth. Positive = market expects more. */
  gap?: number;
};

/** Present value of a growing cash flow stream plus a terminal value. */
function pv(fcf0: number, g: number, years: number, wacc: number, tg: number): number {
  let total = 0;
  let cf = fcf0;
  for (let t = 1; t <= years; t++) {
    cf = cf * (1 + g);
    total += cf / Math.pow(1 + wacc, t);
  }
  // Terminal value assumes competition has eroded excess returns by then.
  const terminal = (cf * (1 + tg)) / (wacc - tg);
  return total + terminal / Math.pow(1 + wacc, years);
}

/**
 * Solves for the growth rate that makes the model reproduce today's price.
 *
 * Bisection rather than a closed form: the terminal term makes this awkward
 * analytically, and 60 iterations is exact enough for a number that will be
 * rounded to a percent and read as a judgement, not a measurement.
 */
function solveGrowth(
  ev: number,
  fcf0: number,
  years: number,
  wacc: number,
  tg: number
): number | null {
  if (fcf0 <= 0 || ev <= 0) return null;
  let lo = -0.5;
  let hi = 1.5;
  if (pv(fcf0, lo, years, wacc, tg) > ev) return null; // cheaper than any scenario
  if (pv(fcf0, hi, years, wacc, tg) < ev) return null; // needs implausible growth
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (pv(fcf0, mid, years, wacc, tg) < ev) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * A wider moat can sustain high growth for longer, so it earns a longer
 * explicit forecast period. This is the one place moat feeds the arithmetic
 * rather than a score.
 */
function horizonFor(moatScore?: number): number {
  const m = moatScore ?? 40;
  if (m >= 75) return 12;
  if (m >= 55) return 10;
  if (m >= 35) return 8;
  return 6;
}

/** Riskier balance sheets and thinner moats deserve a higher hurdle. */
function discountFor(moatScore?: number, netDebtToEbitda?: number): number {
  let w = 0.09;
  if ((moatScore ?? 40) >= 70) w -= 0.005;
  if ((moatScore ?? 40) < 35) w += 0.01;
  if ((netDebtToEbitda ?? 0) > 3) w += 0.01;
  return w;
}

export function readExpectations(input: {
  marketCap?: number;
  netCash?: number;
  fcfTtm?: number;
  revYoY?: number;
  revYoYPrior?: number;
  guidedGrowth?: number;
  moatScore?: number;
  netDebtToEbitda?: number;
}): Expectations | null {
  const { marketCap, netCash, fcfTtm } = input;
  if (!marketCap || marketCap <= 0) return null;

  const horizonYears = horizonFor(input.moatScore);
  const discountRate = discountFor(input.moatScore, input.netDebtToEbitda);
  const terminalGrowth = 0.025;

  // Enterprise value: what the operating business itself is being priced at.
  const ev = marketCap - (netCash ?? 0);

  // The reference is what the business has actually been delivering. Guidance
  // is used when management has given it, since that is the more current claim.
  // Both arrive as fractions (0.5 = 50%), matching the rest of the pipeline.
  const hist = [input.revYoY, input.revYoYPrior].filter(
    (x): x is number => typeof x === "number"
  );
  const referenceGrowth =
    input.guidedGrowth !== undefined
      ? input.guidedGrowth
      : hist.length
        ? hist.reduce((a, b) => a + b, 0) / hist.length
        : undefined;

  if (!fcfTtm || fcfTtm <= 0) {
    return {
      impliedGrowth: 0,
      referenceGrowth,
      horizonYears,
      discountRate,
      terminalGrowth,
      verdict: "unpriceable",
      summary:
        "No positive free cash flow to discount, so the price cannot be translated into an " +
        "expected growth rate. Judge this one on the balance sheet and the path to cash generation.",
    };
  }

  const g = solveGrowth(ev, fcfTtm, horizonYears, discountRate, terminalGrowth);
  if (g === null) {
    return {
      impliedGrowth: 0,
      referenceGrowth,
      horizonYears,
      discountRate,
      terminalGrowth,
      verdict: "unpriceable",
      summary:
        "The price sits outside the range this model can express — either far below any " +
        "reasonable scenario or beyond a 150% annual growth assumption.",
    };
  }

  const impliedPct = g * 100;
  const refPct = referenceGrowth === undefined ? undefined : referenceGrowth * 100;
  const gap = refPct === undefined ? undefined : impliedPct - refPct;

  let verdict: Expectations["verdict"] = "in line";
  if (gap === undefined) {
    verdict = impliedPct > 25 ? "demanding" : "in line";
  } else if (gap <= -5) verdict = "undemanding";
  else if (gap < 8) verdict = "in line";
  else if (gap < 20) verdict = "demanding";
  else verdict = "heroic";

  const r = (n: number) => Math.round(n * 10) / 10;
  const refClause =
    refPct === undefined
      ? "There is no clean growth history to compare that against."
      : `It has recently been growing at ${r(refPct)}%, so the market is asking for ` +
        `${gap! >= 0 ? `${r(gap!)}pp more` : `${r(-gap!)}pp less`} than the current run rate.`;

  return {
    impliedGrowth: r(impliedPct),
    referenceGrowth: refPct === undefined ? undefined : r(refPct),
    horizonYears,
    discountRate: r(discountRate * 100),
    terminalGrowth: r(terminalGrowth * 100),
    verdict,
    gap: gap === undefined ? undefined : r(gap),
    summary:
      `At today's price a buyer is underwriting ${r(impliedPct)}% annual free cash flow growth ` +
      `for ${horizonYears} years, discounted at ${r(discountRate * 100)}%. ${refClause}`,
  };
}
