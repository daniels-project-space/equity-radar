/**
 * A knockout tournament for entry signals.
 *
 * The brief was fewer signals but stronger ones, tested properly. The hard part
 * is not generating candidates — it is that searching hundreds of rules on a
 * dozen price series will always produce a winner, and that winner is usually
 * the accident that fitted the sample best. Two earlier passes in this project
 * demonstrated exactly that: a hand-set dip indicator that measured at |t| 0.45,
 * and a Netflix result that reversed when tested on the other thirteen names.
 *
 * So the structure here is designed to make surviving hard rather than to find
 * a champion:
 *
 *   WALK-FORWARD, NOT ONE SPLIT. History is cut into K sequential folds. A rule
 *   is fitted on nothing — it is simply evaluated on every fold independently —
 *   and judged on how many folds it beats buy-and-hold in. A rule that wins on
 *   one regime and loses on three has not found anything.
 *
 *   CROSS-SECTIONAL, NOT ONE CHART. The same rule runs on every name. Winning on
 *   two names out of thirteen is what luck looks like.
 *
 *   ROUNDS, NOT A FLAT SEARCH. Round one tests single conditions. Only conditions
 *   that survive are allowed into round two's pairs, and only surviving pairs
 *   reach round three. This keeps the number of tests small enough that the
 *   significance bar stays meaningful, instead of testing every triple of
 *   everything and then pretending 500 tests was 1.
 *
 *   AN EXPLICIT NULL. Buy-and-hold is in the tournament as a competitor. If it
 *   wins, that is the finding, and it is reported as one.
 */

import { CONDITIONS, backtest, buildCtx, type Bar, type RuleResult } from "./rules";

export type FoldResult = {
  fold: number;
  ticker: string;
  edgePct: number;
  returnPct: number;
  holdPct: number;
  exposure: number;
  trades: number;
};

export type Entrant = {
  keys: string[];
  label: string;
  /** (name, fold) pairs evaluated. */
  samples: number;
  /** Share of those the rule beat buy-and-hold in, 0-100. */
  winRate: number;
  medianEdge: number;
  meanEdge: number;
  /** Share of names where the rule's median edge across folds was positive. */
  nameWinRate: number;
  /** Share of folds where the rule's median edge across names was positive. */
  foldWinRate: number;
  medianExposure: number;
  medianTrades: number;
  /** Edge in standard errors across the (name, fold) sample. */
  tStat: number;
  survives: boolean;
};

export type Tournament = {
  rounds: { round: number; tested: number; survived: number; entrants: Entrant[] }[];
  champion: Entrant | null;
  /** Buy-and-hold, evaluated the same way, as the thing to beat. */
  benchmarkNote: string;
  names: number;
  folds: number;
  totalTests: number;
  criticalT: number;
  verdict: string;
  computedAt: number;
};

/** Folds must be long enough for a 200-day average plus some trading. */
const MIN_FOLD_BARS = 420;
const WARMUP = 210;

const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const r1 = (n: number) => Math.round(n * 10) / 10;
const r2 = (n: number) => Math.round(n * 100) / 100;

function stdev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
}

/**
 * Splits a series into overlapping evaluation folds.
 *
 * Each fold carries its own warm-up so the 200-day average is seeded from data
 * inside the fold's own past rather than from the fold before it.
 */
function makeFolds(bars: Bar[], folds: number): Bar[][] {
  const usable = bars.length - WARMUP;
  if (usable < MIN_FOLD_BARS) return [];
  const per = Math.floor(usable / folds);
  if (per < 120) return [];

  const out: Bar[][] = [];
  for (let f = 0; f < folds; f++) {
    const start = f * per;
    const end = f === folds - 1 ? bars.length : WARMUP + (f + 1) * per;
    out.push(bars.slice(start, end));
  }
  return out;
}

function evaluate(
  keys: string[],
  assets: { ticker: string; folds: { bars: Bar[]; ctx: ReturnType<typeof buildCtx> }[] }[]
): Entrant | null {
  const results: FoldResult[] = [];

  for (const a of assets) {
    a.folds.forEach((f, i) => {
      const r: RuleResult | null = backtest(f.bars, f.ctx, keys, { start: WARMUP });
      if (!r || r.trades < 1) return;
      results.push({
        fold: i,
        ticker: a.ticker,
        edgePct: r.edgePct,
        returnPct: r.returnPct,
        holdPct: r.holdPct,
        exposure: r.exposure,
        trades: r.trades,
      });
    });
  }

  // A rule that barely ever fires has not been tested, whatever its average.
  if (results.length < 12) return null;

  const edges = results.map((r) => r.edgePct);
  const se = stdev(edges) / Math.sqrt(results.length);
  const tStat = se === 0 ? 0 : mean(edges) / se;

  // Per-name and per-fold consistency, which is what separates a real effect
  // from one name or one regime carrying the average.
  const byName = new Map<string, number[]>();
  const byFold = new Map<number, number[]>();
  for (const r of results) {
    if (!byName.has(r.ticker)) byName.set(r.ticker, []);
    byName.get(r.ticker)!.push(r.edgePct);
    if (!byFold.has(r.fold)) byFold.set(r.fold, []);
    byFold.get(r.fold)!.push(r.edgePct);
  }
  const nameWins = [...byName.values()].filter((xs) => median(xs) > 0).length;
  const foldWins = [...byFold.values()].filter((xs) => median(xs) > 0).length;

  const label =
    keys.length === 0
      ? "Buy and hold"
      : CONDITIONS.filter((c) => keys.includes(c.key))
          .map((c) => c.label)
          .join(" AND ");

  return {
    keys,
    label,
    samples: results.length,
    winRate: Math.round((edges.filter((e) => e > 0).length / edges.length) * 100),
    medianEdge: r1(median(edges)),
    meanEdge: r1(mean(edges)),
    nameWinRate: Math.round((nameWins / byName.size) * 100),
    foldWinRate: Math.round((foldWins / byFold.size) * 100),
    medianExposure: r2(median(results.map((r) => r.exposure))),
    medianTrades: Math.round(median(results.map((r) => r.trades))),
    tStat: r2(tStat),
    survives: false,
  };
}

/**
 * Survival test, applied identically in every round.
 *
 * Deliberately strict on consistency and lenient on magnitude: a small edge that
 * shows up on most names in most regimes is worth far more than a large one that
 * came from two lucky charts.
 */
function survives(e: Entrant, criticalT: number): boolean {
  return (
    e.medianEdge > 0 &&
    e.nameWinRate >= 60 &&
    e.foldWinRate >= 60 &&
    Math.abs(e.tStat) >= criticalT &&
    e.medianTrades >= 2
  );
}

export function runTournament(
  assets: { ticker: string; bars: Bar[] }[],
  opts: { folds?: number; maxRounds?: number } = {}
): Tournament | null {
  const foldCount = opts.folds ?? 4;
  const maxRounds = opts.maxRounds ?? 3;

  const prepared = assets
    .map((a) => {
      const folds = makeFolds(a.bars, foldCount);
      if (folds.length === 0) return null;
      return {
        ticker: a.ticker,
        folds: folds.map((bars) => ({ bars, ctx: buildCtx(bars) })),
      };
    })
    .filter((a): a is NonNullable<typeof a> => a !== null);

  if (prepared.length < 3) return null;

  const rounds: Tournament["rounds"] = [];
  let totalTests = 0;

  // Round one: every condition on its own.
  let pool = CONDITIONS.map((c) => [c.key]);
  let survivorKeys: string[][] = [];

  for (let round = 1; round <= maxRounds; round++) {
    if (pool.length === 0) break;
    totalTests += pool.length;

    // The bar rises with the number of tests run so far, so later rounds -
    // which have more combinations - are not easier to win by luck.
    const criticalT = Math.max(2, Math.sqrt(2 * Math.log(Math.max(2, totalTests))));

    const entrants = pool
      .map((keys) => evaluate(keys, prepared))
      .filter((e): e is Entrant => e !== null)
      .map((e) => ({ ...e, survives: survives(e, criticalT) }))
      .sort((a, b) => b.medianEdge - a.medianEdge);

    const surviving = entrants.filter((e) => e.survives);
    rounds.push({
      round,
      tested: pool.length,
      survived: surviving.length,
      // Every entrant is kept. Truncating the list hid whether a rule scored
      // badly or was never evaluated at all, which are very different findings.
      entrants,
    });

    survivorKeys = surviving.map((e) => e.keys);
    if (survivorKeys.length < 2) break;

    // Next round pairs survivors with single conditions that also survived,
    // so combinations are only built from parts that earned their place.
    const singles = rounds[0].entrants.filter((e) => e.survives).map((e) => e.keys[0]);
    const next: string[][] = [];
    for (const base of survivorKeys) {
      for (const s of singles) {
        if (base.includes(s)) continue;
        const combo = [...base, s].sort();
        if (!next.some((n) => n.join("+") === combo.join("+"))) next.push(combo);
      }
    }
    pool = next;
  }

  const criticalT = Math.max(2, Math.sqrt(2 * Math.log(Math.max(2, totalTests))));

  // Buy-and-hold as the explicit null. Its edge against itself is zero by
  // construction, so it is reported rather than scored.
  const benchmark = evaluate([], prepared);

  const allSurvivors = rounds.flatMap((r) => r.entrants.filter((e) => e.survives));
  const champion =
    allSurvivors.length > 0
      ? allSurvivors.sort((a, b) => b.nameWinRate + b.foldWinRate - (a.nameWinRate + a.foldWinRate))[0]
      : null;

  return {
    rounds,
    champion,
    benchmarkNote: benchmark
      ? `Buy and hold was invested ${Math.round(benchmark.medianExposure * 100)}% of the time by construction across ${benchmark.samples} name-fold pairs.`
      : "Buy and hold could not be evaluated.",
    names: prepared.length,
    folds: foldCount,
    totalTests,
    criticalT: r2(criticalT),
    verdict: champion
      ? `${champion.label} — beats buy and hold on ${champion.nameWinRate}% of names and ${champion.foldWinRate}% of periods, median edge ${champion.medianEdge}pp, |t| ${Math.abs(champion.tStat)}.`
      : `Nothing survived. ${totalTests} rules tested across ${prepared.length} names and ${foldCount} periods; none beat buy and hold consistently enough to clear |t| ${r2(criticalT)} with 60% of names and 60% of periods positive. On this evidence the entry timing should stay valuation-driven.`,
    computedAt: Date.now(),
  } as Tournament;
}
