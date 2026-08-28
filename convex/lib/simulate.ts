/**
 * Rule simulation: £100 per week, sized by depth of pullback or rise.
 *
 * The reference price is a **trailing 200-day average**, not the current fair
 * value. That distinction is the whole point: an earlier version anchored on
 * today's fair value and returned +516% over two years, because today's
 * valuation "knew" that prices would rise. Any number produced that way is
 * fiction. Every input here is causal — computed only from bars up to the
 * decision date — so the result is a real test of the sizing rule.
 *
 * Sizing scales with depth, and buys are modulated by the volume-based dip
 * read: a pullback where selling is still heavy gets a smaller cheque than one
 * that is visibly exhausting.
 */

import { detectDip, type DipBar } from "./dip";

export type SimBar = { date: string; o: number; h: number; l: number; c: number; v: number };

export type SimAsset = { ticker: string; bars: SimBar[] };

export type SimPoint = {
  date: string;
  deposited: number;
  value: number;
  cash: number;
  benchmark: number;
};

export type SimTrade = {
  date: string;
  ticker: string;
  side: "buy" | "sell";
  amount: number;
  price: number;
  depth: number;
  dip?: string;
};

export type SimResult = {
  series: SimPoint[];
  trades: SimTrade[];
  deposited: number;
  finalValue: number;
  returnPct: number;
  benchmarkReturnPct: number;
  cashPct: number;
  tradeCount: number;
  perTicker: { ticker: string; invested: number; value: number; shares: number }[];
};

const DEPOSIT = 100;
const MAX_PER_NAME = 0.4;
const MAX_TRIM = 0.4;
/**
 * Portfolio-level cap. Without it the rule concentrates into whatever has
 * fallen furthest — one run put 92% of the book into a single name, because a
 * per-cheque cap says nothing about the position that accumulates from
 * repeatedly buying the same decline.
 */
const MAX_POSITION = 0.25;
/** How far below the trailing average counts as a full-size opportunity. */
const DEPTH_FULL = 0.25;
/** How far above before trimming starts. */
const RICH_THRESHOLD = 0.15;

function sma(bars: SimBar[], endIdx: number, period: number): number | undefined {
  if (endIdx + 1 < period) return undefined;
  let sum = 0;
  for (let i = endIdx - period + 1; i <= endIdx; i++) sum += bars[i].c;
  return sum / period;
}

export function simulate(
  assets: SimAsset[],
  benchmarkBars: { date: string; c: number }[],
  weeks = 104
): SimResult | null {
  const usable = assets.filter((a) => a.bars.length > 220);
  if (usable.length === 0) return null;

  const longest = usable.reduce((a, b) => (a.bars.length >= b.bars.length ? a : b)).bars;
  const startIdx = Math.max(200, longest.length - weeks * 5);
  const grid: string[] = [];
  for (let i = startIdx; i < longest.length; i += 5) grid.push(longest[i].date);
  if (grid.length < 4) return null;

  // Index each asset by date once, so each step is a lookup not a scan.
  const idxOf = new Map<string, Map<string, number>>();
  for (const a of usable) {
    const m = new Map<string, number>();
    a.bars.forEach((b, i) => m.set(b.date, i));
    idxOf.set(a.ticker, m);
  }
  const lastIdxAtOrBefore = (a: SimAsset, date: string): number => {
    const exact = idxOf.get(a.ticker)?.get(date);
    if (exact !== undefined) return exact;
    let lo = 0;
    let hi = a.bars.length - 1;
    let ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (a.bars[mid].date <= date) {
        ans = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    return ans;
  };

  let cash = 0;
  let deposited = 0;
  const shares = new Map<string, number>();
  const invested = new Map<string, number>();
  const trades: SimTrade[] = [];
  const series: SimPoint[] = [];

  let benchShares = 0;
  let benchDeposited = 0;
  const benchAt = (date: string): number | undefined => {
    let px: number | undefined;
    for (const b of benchmarkBars) {
      if (b.date > date) break;
      px = b.c;
    }
    return px;
  };

  for (const date of grid) {
    cash += DEPOSIT;
    deposited += DEPOSIT;

    const benchPx = benchAt(date);
    if (benchPx && benchPx > 0) {
      benchShares += DEPOSIT / benchPx;
      benchDeposited += DEPOSIT;
    }

    // ---- trims: price stretched above its own trailing average ----
    for (const a of usable) {
      const i = lastIdxAtOrBefore(a, date);
      if (i < 200) continue;
      const px = a.bars[i].c;
      const ref = sma(a.bars, i, 200);
      if (!ref) continue;
      const held = shares.get(a.ticker) ?? 0;
      if (held <= 0) continue;

      const stretch = px / ref - 1;
      if (stretch <= RICH_THRESHOLD) continue;

      const depth = Math.min(1, (stretch - RICH_THRESHOLD) / 0.35);
      const sellShares = held * depth * MAX_TRIM;
      if (sellShares <= 0) continue;

      const proceeds = sellShares * px;
      shares.set(a.ticker, held - sellShares);
      invested.set(a.ticker, (invested.get(a.ticker) ?? 0) - proceeds);
      cash += proceeds;
      trades.push({ date, ticker: a.ticker, side: "sell", amount: proceeds, price: px, depth });
    }

    // ---- buys: below the trailing average, weighted by depth and dip read ----
    const opportunities: { a: SimAsset; px: number; weight: number; depth: number; dip: string }[] = [];
    for (const a of usable) {
      const i = lastIdxAtOrBefore(a, date);
      if (i < 200) continue;
      const px = a.bars[i].c;
      const ref = sma(a.bars, i, 200);
      if (!ref) continue;

      const below = 1 - px / ref;
      if (below <= 0) continue;

      const depth = Math.min(1, below / DEPTH_FULL);

      // Causal dip read: only bars up to this date.
      const window: DipBar[] = a.bars.slice(Math.max(0, i - 64), i + 1);
      const dip = detectDip(window);
      const dipFactor =
        dip.state === "reversing"
          ? 1.3
          : dip.state === "stabilising"
            ? 1.05
            : dip.state === "falling"
              ? 0.6
              : 1;

      opportunities.push({ a, px, weight: depth * dipFactor, depth, dip: dip.state });
    }

    // Portfolio value now, so position caps are measured against the book
    // rather than against a single contribution.
    let bookValue = cash;
    for (const a of usable) {
      const i = lastIdxAtOrBefore(a, date);
      const held = shares.get(a.ticker) ?? 0;
      if (i >= 0 && held > 0) bookValue += held * a.bars[i].c;
    }

    if (opportunities.length > 0 && cash > 0) {
      const totalWeight = opportunities.reduce((s, o) => s + o.weight, 0);
      if (totalWeight > 0) {
        // Deploy proportionally to conviction, but only the fraction of cash
        // the opportunity set justifies — a shallow dip does not deserve the
        // whole cheque.
        const conviction = Math.min(1, totalWeight / opportunities.length);
        const deployable = cash * conviction;
        for (const o of opportunities) {
          const i = lastIdxAtOrBefore(o.a, date);
          const heldValue = (shares.get(o.a.ticker) ?? 0) * (i >= 0 ? o.a.bars[i].c : 0);
          const room = Math.max(0, bookValue * MAX_POSITION - heldValue);

          const amount = Math.min(
            deployable * (o.weight / totalWeight),
            cash * MAX_PER_NAME,
            room
          );
          if (amount < 5) continue;
          shares.set(o.a.ticker, (shares.get(o.a.ticker) ?? 0) + amount / o.px);
          invested.set(o.a.ticker, (invested.get(o.a.ticker) ?? 0) + amount);
          cash -= amount;
          trades.push({
            date,
            ticker: o.a.ticker,
            side: "buy",
            amount,
            price: o.px,
            depth: o.depth,
            dip: o.dip,
          });
        }
      }
    }

    let holdingsValue = 0;
    for (const a of usable) {
      const i = lastIdxAtOrBefore(a, date);
      const held = shares.get(a.ticker) ?? 0;
      if (i >= 0 && held > 0) holdingsValue += held * a.bars[i].c;
    }

    series.push({
      date,
      deposited,
      value: Math.round((holdingsValue + cash) * 100) / 100,
      cash: Math.round(cash * 100) / 100,
      benchmark: benchPx ? Math.round(benchShares * benchPx * 100) / 100 : 0,
    });
  }

  const last = series[series.length - 1];
  const perTicker = usable.map((a) => {
    const i = lastIdxAtOrBefore(a, last.date);
    const px = i >= 0 ? a.bars[i].c : 0;
    const held = shares.get(a.ticker) ?? 0;
    return {
      ticker: a.ticker,
      invested: Math.round((invested.get(a.ticker) ?? 0) * 100) / 100,
      value: Math.round(held * px * 100) / 100,
      shares: Math.round(held * 1000) / 1000,
    };
  });

  return {
    series,
    trades: trades.slice(-80),
    deposited: last.deposited,
    finalValue: last.value,
    returnPct: Math.round((last.value / last.deposited - 1) * 1000) / 10,
    benchmarkReturnPct:
      benchDeposited > 0 ? Math.round((last.benchmark / benchDeposited - 1) * 1000) / 10 : 0,
    cashPct: Math.round((last.cash / last.value) * 1000) / 10,
    tradeCount: trades.length,
    perTicker: perTicker.sort((a, b) => b.value - a.value),
  };
}
