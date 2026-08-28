/**
 * Expectations investing — what the price already assumes, and what it would be
 * worth if those assumptions were defensible.
 *
 * A fair-value estimate answers "what is it worth?", which requires forecasting
 * growth, margins and duration, then presents a point estimate with false
 * precision. Worse, when the whole market is expensive every name fails at once
 * and the system says "buy nothing" — a statement about the regime, not about
 * the company.
 *
 * This inverts it, following Rappaport and Mauboussin: take the price as given
 * and solve for the growth the market is already paying for. The question stops
 * being "is this cheap?" and becomes "is what the market expects plausible?" —
 * answerable from history and moat evidence, still discriminating when
 * everything looks expensive, and not a binary.
 *
 * Growth fades linearly toward the terminal rate rather than holding flat.
 * That matters for more than realism: a constant 10-year rate is not comparable
 * to a trailing one-year growth number, so the flat version was quietly
 * overstating how modest an implied rate looked. With a fade, the solved
 * starting rate sits on the same footing as delivered growth.
 *
 * Both directions of the same model are exported. `readExpectations` solves
 * price -> implied growth for judgement; `justifiedValue` runs growth -> price
 * at a rate the business has earned the right to, and feeds the valuation as
 * one method among several.
 */

export type Expectations = {
  /** Starting annual FCF growth implied by today's price, fading to terminal. */
  impliedGrowth: number;
  /** What the business has actually been doing, for comparison. */
  referenceGrowth?: number;
  /** The rate the model thinks is defensible, after the moat cap. */
  justifiedGrowth?: number;
  horizonYears: number;
  discountRate: number;
  terminalGrowth: number;
  verdict: "undemanding" | "in line" | "demanding" | "heroic" | "unpriceable";
  summary: string;
  /** Gap in pp between implied and reference growth. Positive = market expects more. */
  gap?: number;
};

const TERMINAL_GROWTH = 0.025;

/**
 * Present value with growth fading linearly from `g0` to the terminal rate.
 *
 * No business sustains its current growth for a decade and then stops dead;
 * the fade is what keeps a hot trailing quarter from implying any price.
 */
function pvFading(fcf0: number, g0: number, years: number, wacc: number, tg: number): number {
  let total = 0;
  let cf = fcf0;
  for (let t = 1; t <= years; t++) {
    const g = g0 + (tg - g0) * (t / years);
    cf = cf * (1 + g);
    total += cf / Math.pow(1 + wacc, t);
  }
  // By the terminal year competition is assumed to have eroded excess returns.
  const terminal = (cf * (1 + tg)) / (wacc - tg);
  return total + terminal / Math.pow(1 + wacc, years);
}

/**
 * Solves for the starting growth rate that reproduces today's price.
 *
 * Bisection rather than a closed form: the fade plus terminal term makes this
 * awkward analytically, and 60 iterations is exact enough for a number that
 * gets rounded to a percent and read as a judgement, not a measurement.
 */
function solveInitialGrowth(
  ev: number,
  fcf0: number,
  years: number,
  wacc: number,
  tg: number
): number | null {
  if (fcf0 <= 0 || ev <= 0) return null;
  const lo0 = -0.6;
  const hi0 = 2.5;
  if (pvFading(fcf0, lo0, years, wacc, tg) > ev) return null; // cheaper than any scenario
  if (pvFading(fcf0, hi0, years, wacc, tg) < ev) return null; // beyond what this can express
  let lo = lo0;
  let hi = hi0;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (pvFading(fcf0, mid, years, wacc, tg) < ev) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * A wider moat can sustain high growth for longer, so it earns a longer
 * explicit forecast period. This is one of two places moat enters the
 * arithmetic rather than sitting in a score.
 */
export function horizonFor(moatScore?: number): number {
  const m = moatScore ?? 40;
  // Shortened across the board. A twelve-year explicit forecast implies the
  // model can see excess returns that far out, and Chan, Karceski and
  // Lakonishok found ten-year above-median earnings runs occurring in 0.2% of
  // cases against 0.1% expected by chance. The horizon should not outrun what
  // anyone has been able to forecast.
  if (m >= 75) return 9;
  if (m >= 55) return 8;
  if (m >= 35) return 7;
  return 5;
}

/** Riskier balance sheets and thinner moats deserve a higher hurdle. */
export function discountFor(moatScore?: number, netDebtToEbitda?: number): number {
  let w = 0.09;
  if ((moatScore ?? 40) >= 70) w -= 0.005;
  if ((moatScore ?? 40) < 35) w += 0.01;
  if ((netDebtToEbitda ?? 0) > 3) w += 0.01;
  return w;
}

/**
 * The growth rate a business has earned the right to be valued on.
 *
 * Anchored on what it actually delivered, never assuming acceleration, and
 * capped by moat — the second place moat does real work. Without the cap a
 * single boom year would justify any price, which is the failure mode this
 * whole module exists to avoid.
 */
export function justifiedGrowthRate(input: {
  revYoY?: number;
  revYoYPrior?: number;
  guidedGrowth?: number;
  moatScore?: number;
  /** Multi-year, per-share growth from the filed quarters. Preferred when present. */
  trajectoryGrowth?: number;
  /** 0-1 weight on that estimate; the rest reverts toward the terminal rate. */
  trajectoryConfidence?: number;
}): number | undefined {
  // A multi-year, per-share figure beats a single year-over-year reading, so it
  // wins when it exists — but only in proportion to how steady the history is.
  // The remainder reverts toward terminal rather than toward a second guess.
  let base: number | undefined;
  if (input.trajectoryGrowth !== undefined) {
    const c = input.trajectoryConfidence ?? 0.5;
    base = input.trajectoryGrowth * c + 0.025 * (1 - c);
  } else {
    const hist = [input.revYoY, input.revYoYPrior].filter(
      (x): x is number => typeof x === "number"
    );
    base =
      input.guidedGrowth !== undefined
        ? input.guidedGrowth
        : hist.length
          ? hist.reduce((a, b) => a + b, 0) / hist.length
          : undefined;
  }
  if (base === undefined) return undefined;

  // The cap used to be 35% for a wide moat, held over a twelve-year fade. That
  // was a guess, and the evidence says it was roughly a 99th-percentile
  // assumption applied to any good business.
  //
  // Chan, Karceski and Lakonishok ("The Level and Persistence of Growth Rates",
  // Journal of Finance 2003) measured this across the full cross section: only
  // about 10% of firms grow faster than 18% a year over ten years, the median
  // firm grows at roughly the rate of GDP, and — the part that matters most
  // here — there is no persistence in long-term earnings growth beyond chance.
  // Firms posting five consecutive above-median years occur at 3.0% against
  // 3.1% expected from luck alone.
  //
  // So the ceiling is now anchored to that documented 90th percentile rather
  // than to optimism, and moat moves it within a narrow band instead of setting
  // it outright. A wide moat buys a little more runway; it does not buy a
  // different distribution.
  const m = input.moatScore ?? 40;
  const cap = m >= 75 ? 0.18 : m >= 55 ? 0.14 : m >= 35 ? 0.1 : 0.06;

  // One further haircut. CKL found persistence in *sales* growth but showed it
  // does not carry through to the bottom line — competition dissipates the
  // margin before it reaches an owner. The estimate here is built from revenue,
  // so converting it to a cash-flow assumption at par would import exactly the
  // optimism they documented.
  const bottomLineHaircut = 0.8;

  // Never extrapolate acceleration, and never below a modest decline.
  return Math.max(-0.05, Math.min(base * bottomLineHaircut, cap));
}

/**
 * Per-share value implied by growth the business has actually demonstrated.
 *
 * This is the number that lets a high-multiple compounder and an expensive
 * melting ice cube be told apart — the multiple looks the same, the growth
 * behind it does not.
 */
export function justifiedValue(input: {
  fcfTtm?: number;
  netCash?: number;
  shares?: number;
  revYoY?: number;
  revYoYPrior?: number;
  guidedGrowth?: number;
  moatScore?: number;
  netDebtToEbitda?: number;
  trajectoryGrowth?: number;
  trajectoryConfidence?: number;
}): { perShare: number; growth: number; horizon: number; wacc: number } | null {
  const { fcfTtm, shares } = input;
  if (!fcfTtm || fcfTtm <= 0 || !shares || shares <= 0) return null;

  const g = justifiedGrowthRate(input);
  if (g === undefined) return null;

  const horizon = horizonFor(input.moatScore);
  const wacc = discountFor(input.moatScore, input.netDebtToEbitda);
  const ev = pvFading(fcfTtm, g, horizon, wacc, TERMINAL_GROWTH);
  const perShare = (ev + (input.netCash ?? 0)) / shares;
  if (!Number.isFinite(perShare) || perShare <= 0) return null;

  return { perShare, growth: g, horizon, wacc };
}

export function readExpectations(input: {
  marketCap?: number;
  netCash?: number;
  fcfTtm?: number;
  revenueTtm?: number;
  revYoY?: number;
  revYoYPrior?: number;
  guidedGrowth?: number;
  moatScore?: number;
  netDebtToEbitda?: number;
  trajectoryGrowth?: number;
  trajectoryConfidence?: number;
}): Expectations | null {
  const { marketCap, netCash, fcfTtm } = input;
  if (!marketCap || marketCap <= 0) return null;

  const horizonYears = horizonFor(input.moatScore);
  const discountRate = discountFor(input.moatScore, input.netDebtToEbitda);

  // Enterprise value: what the operating business itself is being priced at.
  const ev = marketCap - (netCash ?? 0);

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
  const justified = justifiedGrowthRate(input);

  const base = {
    referenceGrowth: referenceGrowth === undefined ? undefined : r1(referenceGrowth * 100),
    justifiedGrowth: justified === undefined ? undefined : r1(justified * 100),
    horizonYears,
    discountRate: r1(discountRate * 100),
    terminalGrowth: r1(TERMINAL_GROWTH * 100),
  };

  // A free cash flow that rounds to nothing against revenue is far more often a
  // bad parse than a real result, and solving a growth rate from it produces a
  // confident number built on noise. Say so instead.
  const implausible =
    !!fcfTtm && fcfTtm > 0 && !!input.revenueTtm && input.revenueTtm > 0 &&
    fcfTtm / input.revenueTtm < 0.01;

  if (!fcfTtm || fcfTtm <= 0 || implausible) {
    return {
      ...base,
      impliedGrowth: 0,
      verdict: "unpriceable",
      summary: implausible
        ? "Reported free cash flow is a rounding error against revenue, which usually means the " +
          "filing did not parse cleanly rather than that the business generates no cash. The " +
          "price is not being translated into a growth assumption until that figure is credible."
        : "No positive free cash flow to discount, so the price cannot be translated into an " +
          "expected growth rate. Judge this one on the balance sheet and the path to cash generation.",
    };
  }

  const g = solveInitialGrowth(ev, fcfTtm, horizonYears, discountRate, TERMINAL_GROWTH);
  if (g === null) {
    return {
      ...base,
      impliedGrowth: 0,
      verdict: "unpriceable",
      summary:
        "The price sits outside the range this model can express — either below any scenario " +
        "with positive growth, or beyond a 250% starting growth assumption.",
    };
  }

  const impliedPct = g * 100;
  const refPct = base.referenceGrowth;
  const gap = refPct === undefined ? undefined : impliedPct - refPct;

  let verdict: Expectations["verdict"] = "in line";
  if (gap === undefined) {
    verdict = impliedPct > 25 ? "demanding" : "in line";
  } else if (gap <= -5) verdict = "undemanding";
  else if (gap < 8) verdict = "in line";
  else if (gap < 20) verdict = "demanding";
  else verdict = "heroic";

  const refClause =
    refPct === undefined
      ? "There is no clean growth history to compare that against."
      : `It has recently been growing at ${refPct}%, so the market is asking for ` +
        `${gap! >= 0 ? `${r1(gap!)}pp more` : `${r1(-gap!)}pp less`} than the current run rate.`;

  return {
    ...base,
    impliedGrowth: r1(impliedPct),
    verdict,
    gap: gap === undefined ? undefined : r1(gap),
    summary:
      `At today's price a buyer is underwriting ${r1(impliedPct)}% free cash flow growth next year, ` +
      `fading to ${base.terminalGrowth}% over ${horizonYears} years, discounted at ${base.discountRate}%. ` +
      refClause,
  };
}

const r1 = (n: number) => Math.round(n * 10) / 10;
