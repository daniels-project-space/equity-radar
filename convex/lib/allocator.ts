/**
 * DCA allocator.
 *
 * Given today's scores, how should the next contribution be split? The design
 * requirement that matters most is the ability to answer "none of them" — a
 * allocator that always finds something to buy is just a spending schedule
 * with extra steps. Anything that fails the gate gets nothing, and whatever is
 * left over after per-name caps stays in cash.
 */

export type Candidate = {
  ticker: string;
  name?: string;
  asymmetry?: number;
  composite?: number;
  moatScore?: number;
  upside?: number; // % below fair value; negative means above it
  confidence?: string;
  verdict?: string;
  currentBand?: string;
  latestPeriodEnd?: string;
};

export type Slice = {
  ticker: string;
  name?: string;
  weight: number; // 0..1
  conviction: number;
  reason: string;
};

export type Allocation = {
  slices: Slice[];
  cash: number; // 0..1
  rejected: { ticker: string; reason: string }[];
  headline: string;
};

const BUY_VERDICTS = new Set(["STRONG_BUY", "BUY", "ACCUMULATE"]);

/** No single name may take more than this of one contribution. */
export const MAX_WEIGHT = 0.4;
/** Below this a slice is noise — fold it into cash rather than buy £3 of it. */
export const MIN_WEIGHT = 0.05;

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/** Filings more than ~150 days old are a different vintage; do not act on them. */
function isStale(periodEnd?: string): boolean {
  return !!periodEnd && Date.now() - Date.parse(periodEnd) > 150 * 86_400_000;
}

function gate(c: Candidate): string | null {
  if (!c.verdict || !BUY_VERDICTS.has(c.verdict)) return `verdict is ${c.verdict ?? "unknown"}`;
  if (c.upside === undefined || c.upside <= 0) return "trading above fair value";
  if ((c.asymmetry ?? 0) < 50) return `asymmetry ${Math.round(c.asymmetry ?? 0)} below 50`;
  if ((c.moatScore ?? 0) < 30) return `moat ${Math.round(c.moatScore ?? 0)} below 30`;
  if (isStale(c.latestPeriodEnd)) return "filings are stale";
  return null;
}

/**
 * Conviction blends entry quality, how far below fair value it trades, and
 * business quality — then discounts for how much the valuation methods
 * disagreed. A wide-dispersion "bargain" is not the same bet as a tight one.
 */
function conviction(c: Candidate): number {
  const asym = (c.asymmetry ?? 0) / 100;
  const discount = clamp((c.upside ?? 0) / 100, 0, 1);
  const moat = 0.6 + clamp((c.moatScore ?? 0) / 100, 0, 1) * 0.4;
  const conf = c.confidence === "high" ? 1 : c.confidence === "medium" ? 0.85 : 0.65;
  return asym * (1 + discount) * moat * conf;
}

export function allocate(candidates: Candidate[]): Allocation {
  const rejected: { ticker: string; reason: string }[] = [];
  const passed: { c: Candidate; conviction: number }[] = [];

  for (const c of candidates) {
    const fail = gate(c);
    if (fail) {
      rejected.push({ ticker: c.ticker, reason: fail });
      continue;
    }
    passed.push({ c, conviction: conviction(c) });
  }

  if (passed.length === 0) {
    return {
      slices: [],
      cash: 1,
      rejected,
      headline: "Nothing qualifies today — hold the contribution in cash.",
    };
  }

  const total = passed.reduce((s, p) => s + p.conviction, 0);
  let slices: Slice[] = passed.map((p) => ({
    ticker: p.c.ticker,
    name: p.c.name,
    weight: p.conviction / total,
    conviction: Math.round(p.conviction * 100) / 100,
    reason:
      `${Math.round(p.c.upside ?? 0)}% below fair value, asymmetry ${Math.round(p.c.asymmetry ?? 0)}` +
      `, moat ${Math.round(p.c.moatScore ?? 0)}`,
  }));

  // Cap concentration. Whatever a cap sheds becomes cash rather than being
  // pushed into the next-best name — if one idea is worth 70% of conviction,
  // forcing the rest into weaker ideas is worse than holding.
  slices = slices.map((s) => ({ ...s, weight: Math.min(s.weight, MAX_WEIGHT) }));

  // Drop dust.
  slices = slices.filter((s) => {
    if (s.weight < MIN_WEIGHT) {
      rejected.push({ ticker: s.ticker, reason: "slice too small to be worth a trade" });
      return false;
    }
    return true;
  });

  const invested = slices.reduce((s, x) => s + x.weight, 0);
  const cash = Math.max(0, 1 - invested);

  slices.sort((a, b) => b.weight - a.weight);

  const headline =
    slices.length === 0
      ? "Nothing qualifies today — hold the contribution in cash."
      : slices.length === 1
        ? `${slices[0].ticker} is the only name that qualifies — ${Math.round(slices[0].weight * 100)}%, rest in cash.`
        : `${slices.length} names qualify, led by ${slices[0].ticker} at ${Math.round(slices[0].weight * 100)}%.`;

  return { slices, cash: Math.round(cash * 1000) / 1000, rejected, headline };
}
