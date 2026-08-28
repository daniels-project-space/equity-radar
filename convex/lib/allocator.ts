/**
 * DCA allocator.
 *
 * This used to gate on absolute cheapness: a name had to trade below its own
 * fair value or it got nothing, and if nothing qualified the whole contribution
 * sat in cash. That is wrong in a way worth stating precisely, because the
 * failure only shows up over years.
 *
 * A gate like that conflates two different questions. "Is the market expensive?"
 * is a regime question, and the evidence says valuation answers it too weakly to
 * act on decisively (see lib/regime.ts). "Which of these is the better use of
 * the next contribution?" is a cross-sectional question, and valuation answers
 * that one much better — relative value is where the evidence actually lives.
 * Folding both into one absolute threshold means a broadly expensive market
 * silently becomes a decision to hold cash indefinitely, which over a long
 * horizon has been the more expensive error.
 *
 * So the split here is deliberate:
 *
 *   - Regime decides HOW MUCH to deploy — bounded, never zero.
 *   - This file decides WHAT to buy with it — always ranked, always an answer.
 *
 * The remaining gate is about safety, not price: stale filings, no data, a
 * business the model actively dislikes. "Expensive" is no longer disqualifying;
 * it just loses the ranking to something less expensive.
 */

import { readRegime, type Regime } from "./regime";

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
  /** 3-month price return, used as a small catalyst tilt. */
  ret3m?: number;
  /** How demanding the price is versus delivered growth. See lib/expectations.ts. */
  expectationsVerdict?: string;
  expectationsGap?: number;
};

export type Slice = {
  ticker: string;
  name?: string;
  weight: number; // 0..1 of the deployed amount
  conviction: number;
  reason: string;
  rank: number;
};

export type Allocation = {
  slices: Slice[];
  /** Share of the deployed amount left uninvested (dust only). */
  cash: number;
  rejected: { ticker: string; reason: string }[];
  headline: string;
  regime: Regime;
  /** Fraction of a normal contribution to actually invest this period. */
  deploymentRate: number;
};

/** Verdicts that mean "do not own", as opposed to "not cheap". */
const EXCLUDE_VERDICTS = new Set(["SELL", "AVOID", "INSUFFICIENT_DATA", "TRIM"]);

/** No single name may take more than this of one contribution. */
export const MAX_WEIGHT = 0.4;
/** Below this a slice is noise — fold it into the next name rather than buy £3 of it. */
export const MIN_WEIGHT = 0.05;
/** A business this weak is excluded regardless of price. */
export const MIN_MOAT = 25;

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/** Filings more than ~150 days old are a different vintage; do not act on them. */
function isStale(periodEnd?: string): boolean {
  return !!periodEnd && Date.now() - Date.parse(periodEnd) > 150 * 86_400_000;
}

/**
 * Safety gate only. Nothing here is about price — a name that is merely
 * expensive stays in the ranking and competes on relative merit.
 */
function gate(c: Candidate): string | null {
  if (!c.verdict || c.verdict === "INSUFFICIENT_DATA") return "not enough filed data to score";
  if (EXCLUDE_VERDICTS.has(c.verdict)) return `model rates this ${c.verdict.toLowerCase()}`;
  if ((c.moatScore ?? 0) < MIN_MOAT) return `moat ${Math.round(c.moatScore ?? 0)} below ${MIN_MOAT}`;
  if (isStale(c.latestPeriodEnd)) return "filings are stale";
  if (c.upside === undefined) return "no fair-value estimate";
  return null;
}

/** Percentile rank of x within xs, 0..1. */
function pct(x: number, xs: number[]): number {
  if (xs.length < 2) return 0.5;
  const below = xs.filter((v) => v < x).length;
  return below / (xs.length - 1);
}

/**
 * Relative conviction.
 *
 * Every term is a rank within today's candidate set rather than an absolute
 * level, so the allocation stays meaningful when the whole list is expensive —
 * the point is to identify the best available use of the money, not to certify
 * that it is cheap in the abstract.
 *
 * Momentum carries a deliberately small weight. AQR's work on combining value
 * with momentum ("value with a catalyst") is the reason it is here at all; this
 * project's own calibration could not confirm any momentum edge on its 13-name
 * sample, so it acts as a tie-breaker and nothing more.
 */
function convictionOf(c: Candidate, pool: { ups: number[]; moats: number[]; rets: number[] }): number {
  const valueRank = pct(c.upside ?? 0, pool.ups);
  const moatRank = pct(c.moatScore ?? 0, pool.moats);
  const momRank = c.ret3m === undefined ? 0.5 : pct(c.ret3m, pool.rets);

  // Expectations act as a haircut, not a gate: a price underwriting growth well
  // beyond anything delivered is a worse bet at the same rank.
  const expPenalty =
    c.expectationsVerdict === "heroic"
      ? 0.75
      : c.expectationsVerdict === "demanding"
        ? 0.9
        : c.expectationsVerdict === "undemanding"
          ? 1.08
          : 1;

  const conf = c.confidence === "high" ? 1 : c.confidence === "medium" ? 0.9 : 0.78;

  const base = valueRank * 0.45 + moatRank * 0.35 + momRank * 0.2;
  return clamp(base * expPenalty * conf, 0.01, 2);
}

export function allocate(candidates: Candidate[]): Allocation {
  const rejected: { ticker: string; reason: string }[] = [];
  const eligible: Candidate[] = [];

  for (const c of candidates) {
    const fail = gate(c);
    if (fail) rejected.push({ ticker: c.ticker, reason: fail });
    else eligible.push(c);
  }

  // Regime is read across everything scored, including names that fail the
  // safety gate — it is a statement about the market, not about the shortlist.
  const regime = readRegime(
    candidates.map((c) => c.upside).filter((x): x is number => typeof x === "number")
  );

  if (eligible.length === 0) {
    return {
      slices: [],
      cash: 1,
      rejected,
      regime,
      deploymentRate: 0,
      headline: "Nothing passes the safety checks today — no data good enough to act on.",
    };
  }

  const pool = {
    ups: eligible.map((c) => c.upside ?? 0),
    moats: eligible.map((c) => c.moatScore ?? 0),
    rets: eligible.map((c) => c.ret3m ?? 0),
  };

  const scored = eligible
    .map((c) => ({ c, conviction: convictionOf(c, pool) }))
    .sort((a, b) => b.conviction - a.conviction);

  const total = scored.reduce((s, p) => s + p.conviction, 0);
  let slices: Slice[] = scored.map((p, i) => ({
    ticker: p.c.ticker,
    name: p.c.name,
    weight: p.conviction / total,
    conviction: Math.round(p.conviction * 100) / 100,
    rank: i + 1,
    reason: describe(p.c),
  }));

  // Cap concentration, then redistribute the excess across the rest by
  // conviction. Unlike the previous version this does not become cash: the
  // regime already decided how much to invest, so shedding more here would
  // apply the same brake twice.
  slices = redistribute(slices, MAX_WEIGHT);

  // Drop dust and re-normalise so the deployed amount is fully allocated.
  const kept = slices.filter((s) => s.weight >= MIN_WEIGHT);
  if (kept.length && kept.length < slices.length) {
    for (const s of slices) {
      if (s.weight < MIN_WEIGHT) {
        rejected.push({ ticker: s.ticker, reason: "slice too small to be worth a trade" });
      }
    }
    const sum = kept.reduce((s, x) => s + x.weight, 0);
    slices = redistribute(
      kept.map((s) => ({ ...s, weight: s.weight / sum })),
      MAX_WEIGHT
    );
  }

  const invested = slices.reduce((s, x) => s + x.weight, 0);
  slices.sort((a, b) => b.weight - a.weight);
  slices = slices.map((s, i) => ({ ...s, rank: i + 1 }));

  const top = slices[0];
  const headline = top
    ? `${top.ticker} leads at ${Math.round(top.weight * 100)}% of a ${regime.deploymentRate}x contribution` +
      (slices.length > 1 ? `, ${slices.length - 1} more alongside.` : ", nothing else clears the bar.")
    : "Nothing passes the safety checks today.";

  return {
    slices,
    cash: Math.round(Math.max(0, 1 - invested) * 1000) / 1000,
    rejected,
    regime,
    deploymentRate: regime.deploymentRate,
    headline,
  };
}

/** Caps each weight and spreads the overflow across the uncapped remainder. */
function redistribute(slices: Slice[], cap: number): Slice[] {
  const out = slices.map((s) => ({ ...s }));
  for (let pass = 0; pass < 8; pass++) {
    const over = out.filter((s) => s.weight > cap);
    if (!over.length) break;
    let excess = 0;
    for (const s of over) {
      excess += s.weight - cap;
      s.weight = cap;
    }
    const under = out.filter((s) => s.weight < cap);
    if (!under.length) break;
    const room = under.reduce((sum, s) => sum + (cap - s.weight), 0);
    if (room <= 0) break;
    for (const s of under) s.weight += excess * ((cap - s.weight) / room);
  }
  return out;
}

/** One line saying why this name ranked where it did. */
function describe(c: Candidate): string {
  const bits: string[] = [];
  const up = Math.round(c.upside ?? 0);
  bits.push(up >= 0 ? `${up}% below fair value` : `${-up}% above fair value`);
  bits.push(`moat ${Math.round(c.moatScore ?? 0)}`);
  if (c.expectationsVerdict && c.expectationsVerdict !== "unpriceable") {
    bits.push(`expectations ${c.expectationsVerdict}`);
  }
  // ret3m is stored as a fraction, not a percentage.
  if (c.ret3m !== undefined) {
    bits.push(`${c.ret3m >= 0 ? "+" : ""}${Math.round(c.ret3m * 100)}% 3m`);
  }
  return bits.join(", ");
}
