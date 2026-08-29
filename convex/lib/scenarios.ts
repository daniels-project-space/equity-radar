/**
 * Bear, base and bull — and what each one requires to be true.
 *
 * A single fair value collapses a distribution into its middle and then a
 * verdict collapses that into a word. For most companies that is a fair
 * summary. For a convex one it is actively misleading: an asset whose base case
 * is poor and whose tail is enormous has an expected value that describes
 * neither outcome, and "trim" is a strange thing to say about a position whose
 * whole purpose is the tail.
 *
 * The fix is not to inflate fair value until the model agrees with the price.
 * It is to stop reporting one number. Each scenario is priced by the same
 * machinery on different assumptions, and — the part that makes it useful —
 * each is stated as a condition rather than a probability, because "the bull
 * case needs 28% growth held for nine years" is checkable against the world
 * while "20% chance of the bull case" is a number nobody can defend.
 *
 * This is the honest version of pricing in potential. It does not claim to know
 * whether the strategic position or the balance-sheet bet will pay. It says what
 * the price is currently assuming, what it would be worth if the good case lands,
 * and what is left if it does not — which is the information needed to size a
 * position rather than to accept or reject one.
 */

export type Scenario = {
  key: "bear" | "base" | "bull";
  label: string;
  fairValue: number;
  /** Return from today's price if this case lands, in %. */
  upside: number;
  growth: number;
  /** What has to happen for this case. */
  condition: string;
};

export type ScenarioSet = {
  scenarios: Scenario[];
  price: number;
  /** Bull upside divided by bear downside. Above 2 means the tail pays for the risk. */
  payoffRatio?: number;
  /** True when the spread is wide enough that a single fair value misleads. */
  convex: boolean;
  summary: string;
};

const TERMINAL = 0.025;
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
// `+ 0` collapses negative zero, which Math.round produces from any tiny
// negative and Convex then stores as a tagged float the UI cannot format.
const r1 = (n: number) => Math.round(n * 10) / 10 + 0;

/** Present value with growth fading to terminal, matching lib/expectations.ts. */
function pvFading(fcf0: number, g0: number, years: number, wacc: number): number {
  let total = 0;
  let cf = fcf0;
  for (let t = 1; t <= years; t++) {
    const g = g0 + (TERMINAL - g0) * (t / years);
    cf = cf * (1 + g);
    total += cf / Math.pow(1 + wacc, t);
  }
  return total + ((cf * (1 + TERMINAL)) / (wacc - TERMINAL)) / Math.pow(1 + wacc, years);
}

export function buildScenarios(input: {
  price?: number;
  fairValue?: number;
  fcfTtm?: number;
  netCash?: number;
  shares?: number;
  justifiedGrowth?: number;
  deliveredGrowth?: number;
  horizonYears?: number;
  discountRate?: number;
  moatScore?: number;
  /** Needed to sanity-check the cash-flow figure before discounting it. */
  revenueTtm?: number;
  /** Set when the asset is largely a levered claim on something else. */
  link?: { driver: string; beta: number; rSquared: number };
}): ScenarioSet | null {
  const { price, fairValue } = input;
  if (!price || price <= 0 || !fairValue || fairValue > 0 === false) return null;

  const horizon = input.horizonYears ?? 8;
  const wacc = (input.discountRate ?? 9) / 100;
  const base = input.justifiedGrowth ?? 0.03;
  const delivered = input.deliveredGrowth;

  const scenarios: Scenario[] = [];

  // The same plausibility floor the valuation applies. Without it the scenarios
  // discounted a cash-flow figure the valuation had already rejected: Fabrinet
  // parses at 0.09% of revenue, which produced a $25 bear and a $28 bull against
  // a $412 base - the bull below the bear, every number built on an input the
  // rest of the model refuses to use.
  const fcfCredible =
    !!input.fcfTtm &&
    input.fcfTtm > 0 &&
    (!input.revenueTtm || input.revenueTtm <= 0 || input.fcfTtm / input.revenueTtm >= 0.01);
  const canModel = fcfCredible && !!input.shares && input.shares > 0;

  if (canModel) {
    const perShare = (g: number, w: number) =>
      (pvFading(input.fcfTtm!, g, horizon, w) + (input.netCash ?? 0)) / input.shares!;

    // Bull: the growth the business has actually delivered, uncapped, on the
    // grounds that the cap exists to stop optimism rather than to deny history.
    const bullGrowth = clamp(Math.max(delivered ?? base * 1.6, base * 1.6), base, 0.45);
    // Bear: growth fades immediately and the multiple contracts with it.
    const bearGrowth = clamp(Math.min(base * 0.3, 0.03), -0.05, 0.05);

    scenarios.push(
      {
        key: "bear",
        label: "Bear",
        fairValue: r1(perShare(bearGrowth, wacc + 0.02)),
        upside: 0,
        growth: r1(bearGrowth * 100),
        condition: `Growth fades to ${r1(bearGrowth * 100)}% and the market demands ${r1((wacc + 0.02) * 100)}% for the risk.`,
      },
      {
        key: "base",
        label: "Base",
        fairValue: r1(fairValue),
        upside: 0,
        growth: r1(base * 100),
        condition: `The growth the filings support, ${r1(base * 100)}%, fading over ${horizon} years.`,
      },
      {
        key: "bull",
        label: "Bull",
        fairValue: r1(perShare(bullGrowth, Math.max(0.07, wacc - 0.01))),
        upside: 0,
        growth: r1(bullGrowth * 100),
        condition:
          delivered !== undefined && delivered > bullGrowth + 0.001
            ? `It sustains ${r1(bullGrowth * 100)}% for ${horizon} years - below the ${r1(delivered * 100)}% just delivered, because nothing has held that rate for a decade.`
            : delivered !== undefined && bullGrowth <= delivered + 0.001
              ? `It keeps compounding at the ${r1(delivered * 100)}% it has been delivering, for ${horizon} years.`
              : `Growth reaccelerates to ${r1(bullGrowth * 100)}% and holds for ${horizon} years.`,
      }
    );
  } else if (input.link && input.link.beta > 0) {
    // No cash flows to discount. The scenarios then belong to the driver, which
    // is the honest framing for a levered claim: what happens here is mostly a
    // function of what happens there.
    const b = input.link.beta;
    const moves: { key: Scenario["key"]; label: string; drv: number }[] = [
      { key: "bear", label: "Bear", drv: -0.4 },
      { key: "base", label: "Base", drv: 0 },
      { key: "bull", label: "Bull", drv: 0.6 },
    ];
    for (const m of moves) {
      scenarios.push({
        key: m.key,
        label: m.label,
        fairValue: r1(price * (1 + m.drv * b)),
        upside: 0,
        growth: 0,
        condition:
          m.drv === 0
            ? `${input.link.driver} is unchanged.`
            : `${input.link.driver} ${m.drv > 0 ? "rises" : "falls"} ${Math.abs(m.drv * 100)}%, which at ${b.toFixed(2)}x moves this ${r1(m.drv * b * 100)}%.`,
      });
    }
  } else {
    // No credible cash flow and no dominant driver. The base case is still the
    // blended fair value, so the cases are expressed as re-ratings of it rather
    // than fabricated from a number that did not parse.
    const spread: { key: Scenario["key"]; label: string; mult: number; why: string }[] = [
      { key: "bear", label: "Bear", mult: 0.6, why: "The multiple compresses 40% as growth disappoints." },
      { key: "base", label: "Base", mult: 1, why: "The blended valuation as it stands." },
      { key: "bull", label: "Bull", mult: 1.5, why: "The multiple expands 50% as growth persists." },
    ];
    for (const sc of spread) {
      scenarios.push({
        key: sc.key,
        label: sc.label,
        fairValue: r1(fairValue * sc.mult),
        upside: 0,
        growth: 0,
        condition:
          sc.why +
          (sc.key === "base"
            ? " Free cash flow did not parse credibly, so these are multiple-based rather than discounted."
            : ""),
      });
    }
  }

  for (const s of scenarios) s.upside = r1((s.fairValue / price - 1) * 100);

  const bull = scenarios.find((s) => s.key === "bull")!;
  const bear = scenarios.find((s) => s.key === "bear")!;
  const payoffRatio =
    bear.upside < 0 ? Math.round((bull.upside / Math.abs(bear.upside)) * 100) / 100 : undefined;

  // Wide enough that quoting the middle alone would misrepresent the position.
  const convex = bull.upside - bear.upside > 120;

  const summary = convex
    ? `The range is wide enough that a single fair value misleads: ${bear.upside}% to ${bull.upside}% ` +
      `depending on which case lands` +
      (payoffRatio ? `, a ${payoffRatio}:1 payoff against the downside. ` : ". ") +
      `Size this on the bear case and hold it for the bull one; the middle is not where the decision is.`
    : `The cases span ${bear.upside}% to ${bull.upside}%, tight enough that the base case is a fair summary.`;

  return { scenarios, price, payoffRatio, convex, summary };
}
