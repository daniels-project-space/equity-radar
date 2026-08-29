/**
 * Entry/exit rules, and an honest way to compare them.
 *
 * The prompt for this was concrete: on Netflix, two entries fire before the
 * 50-day crosses the 200-day, and conditioning the signals on each other ought
 * to remove that. It should — a trend filter is exactly the fix for early
 * entries in a downtrend. The danger is what comes next: try enough
 * combinations on one stock and something will look excellent, because a
 * search over rules on a single price series is a machine for manufacturing
 * hindsight.
 *
 * So the rules are built as composable conditions and evaluated the same way
 * the indicator calibration is: every combination scored, the number of
 * combinations tried held against the result, and — the part that actually
 * matters — the winner re-tested on a period it was not chosen on. A rule that
 * only works in-sample is reported as failing, not as a discovery.
 *
 * Every condition reads bars up to and including the decision bar. Nothing here
 * may look forward.
 */

import { priceProfile } from "./profile";

export type Bar = { date: string; o: number; h: number; l: number; c: number; v: number };

/* ------------------------------------------------------------------ */
/* Indicators                                                          */
/* ------------------------------------------------------------------ */

/** Exponential moving average series, aligned to `bars` (null until seeded). */
export function ema(bars: Bar[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(bars.length).fill(null);
  if (bars.length < period) return out;
  const k = 2 / (period + 1);
  let acc = 0;
  for (let i = 0; i < period; i++) acc += bars[i].c;
  let prev = acc / period;
  out[period - 1] = prev;
  for (let i = period; i < bars.length; i++) {
    prev = bars[i].c * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

/** Wilder RSI series. */
export function rsiSeries(bars: Bar[], period = 14): (number | null)[] {
  const out: (number | null)[] = new Array(bars.length).fill(null);
  if (bars.length <= period) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = bars[i].c - bars[i - 1].c;
    if (d >= 0) gain += d;
    else loss -= d;
  }
  gain /= period;
  loss /= period;
  out[period] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  for (let i = period + 1; i < bars.length; i++) {
    const d = bars[i].c - bars[i - 1].c;
    gain = (gain * (period - 1) + Math.max(0, d)) / period;
    loss = (loss * (period - 1) + Math.max(0, -d)) / period;
    out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  }
  return out;
}

/**
 * Fibonacci retracement level of the current pullback, as a fraction.
 *
 * 0 means price is back at the swing high, 1 means it has given back the whole
 * advance. The classic 0.382-0.618 zone is where a retracement is supposed to
 * find support, which is testable rather than decorative.
 */
export function fibRetrace(bars: Bar[], i: number, lookback = 120): number | null {
  const start = Math.max(0, i - lookback);
  const window = bars.slice(start, i + 1);
  if (window.length < 30) return null;
  const hi = Math.max(...window.map((b) => b.h));
  const lo = Math.min(...window.map((b) => b.l));
  if (hi <= lo) return null;
  return (hi - bars[i].c) / (hi - lo);
}

/** Highest close over the trailing `n` bars, excluding today. */
function priorHigh(bars: Bar[], i: number, n: number): number | null {
  if (i < n) return null;
  let hi = -Infinity;
  for (let j = i - n; j < i; j++) hi = Math.max(hi, bars[j].c);
  return Number.isFinite(hi) ? hi : null;
}

/* ------------------------------------------------------------------ */
/* Conditions                                                          */
/* ------------------------------------------------------------------ */

export type Ctx = {
  bars: Bar[];
  i: number;
  ema50: (number | null)[];
  ema200: (number | null)[];
  rsi: (number | null)[];
  vol20: (number | null)[];
  vol60: (number | null)[];
};

export type Condition = { key: string; label: string; test: (c: Ctx) => boolean };

export const CONDITIONS: Condition[] = [
  {
    key: "trendUp",
    label: "50 EMA above 200 EMA",
    test: ({ ema50, ema200, i }) =>
      ema50[i] !== null && ema200[i] !== null && (ema50[i] as number) > (ema200[i] as number),
  },
  {
    key: "aboveTrend",
    label: "price above the 200 EMA",
    test: ({ bars, ema200, i }) => ema200[i] !== null && bars[i].c > (ema200[i] as number),
  },
  {
    key: "goldenCross",
    label: "50 EMA crossed above 200 EMA in the last 10 days",
    test: ({ ema50, ema200, i }) => {
      for (let j = Math.max(1, i - 10); j <= i; j++) {
        const a = ema50[j];
        const b = ema200[j];
        const pa = ema50[j - 1];
        const pb = ema200[j - 1];
        if (a !== null && b !== null && pa !== null && pb !== null && pa <= pb && a > b) return true;
      }
      return false;
    },
  },
  {
    key: "fibZone",
    label: "pullback into the 38-62% retracement zone",
    test: ({ bars, i }) => {
      const f = fibRetrace(bars, i);
      return f !== null && f >= 0.382 && f <= 0.618;
    },
  },
  {
    key: "shallowDip",
    label: "pullback shallower than 38%",
    test: ({ bars, i }) => {
      const f = fibRetrace(bars, i);
      return f !== null && f > 0.05 && f < 0.382;
    },
  },
  {
    key: "breakout",
    label: "close above the 60-day high",
    test: ({ bars, i }) => {
      const h = priorHigh(bars, i, 60);
      return h !== null && bars[i].c > h;
    },
  },
  {
    key: "rsiRecovering",
    label: "RSI back above 50 from below",
    test: ({ rsi, i }) => {
      const r = rsi[i];
      if (r === null || r < 50) return false;
      for (let j = Math.max(1, i - 10); j < i; j++) if ((rsi[j] ?? 100) < 45) return true;
      return false;
    },
  },
  {
    key: "rsiNotHot",
    label: "RSI below 70",
    test: ({ rsi, i }) => rsi[i] !== null && (rsi[i] as number) < 70,
  },
  {
    key: "volumeConfirms",
    label: "20-day volume above the 60-day average",
    test: ({ vol20, vol60, i }) =>
      vol20[i] !== null && vol60[i] !== null && (vol20[i] as number) > (vol60[i] as number),
  },
  {
    key: "rsi2Oversold",
    label: "RSI(2) below 10 — Connors mean reversion",
    test: ({ bars, i }) => {
      const w = bars.slice(Math.max(0, i - 30), i + 1);
      const r = rsiAt(w, 2);
      return r !== null && r < 10;
    },
  },
  {
    key: "fastCross",
    label: "20-day above 50-day",
    test: ({ bars, i }) => {
      const a = smaAt(bars, i, 20);
      const b = smaAt(bars, i, 50);
      return a !== null && b !== null && a > b;
    },
  },
  {
    key: "belowFast",
    label: "price below its 5-day average (short-term stretch)",
    test: ({ bars, i }) => {
      const a = smaAt(bars, i, 5);
      return a !== null && bars[i].c < a;
    },
  },
  {
    key: "calmRegime",
    label: "volatility below its own median",
    test: ({ bars, i }) => {
      const v = realisedVol(bars, i, 20);
      const long = realisedVol(bars, i, 120);
      return v !== null && long !== null && v < long;
    },
  },
  {
    key: "volumeDryUp",
    label: "selling volume drying up",
    test: ({ vol20, vol60, i }) =>
      vol20[i] !== null && vol60[i] !== null && (vol20[i] as number) < (vol60[i] as number) * 0.9,
  },
  {
    key: "donchian20",
    label: "close above the 20-day high",
    test: ({ bars, i }) => {
      if (i < 20) return false;
      let hi = -Infinity;
      for (let j = i - 20; j < i; j++) hi = Math.max(hi, bars[j].c);
      return Number.isFinite(hi) && bars[i].c > hi;
    },
  },
  {
    key: "belowValueArea",
    label: "price below the value area low",
    test: ({ bars, i }) => {
      const pr = profileAt(bars, i);
      return pr !== null && bars[i].c < pr.val;
    },
  },
  {
    key: "atPoc",
    label: "price within 2% of the point of control",
    test: ({ bars, i }) => {
      const pr = profileAt(bars, i);
      return pr !== null && Math.abs(bars[i].c / pr.poc - 1) < 0.02;
    },
  },
  {
    key: "reenterValue",
    label: "back inside the value area from below",
    test: ({ bars, i }) => {
      const pr = profileAt(bars, i);
      if (pr === null || i < 1) return false;
      return bars[i - 1].c < pr.val && bars[i].c >= pr.val && bars[i].c <= pr.vah;
    },
  },
];

/**
 * Rolling profile over the trailing year, recomputed every 21 bars and cached.
 *
 * Recomputing a 48-row profile on every bar of every rule of every fold is the
 * difference between a tournament that finishes and one that does not. The
 * profile is a slow-moving object, so a monthly refresh loses nothing that
 * matters and keeps the whole thing causal — the window only ever looks back.
 */
const profileCache = new WeakMap<Bar[], Map<number, ReturnType<typeof priceProfile>>>();

function profileAt(bars: Bar[], i: number) {
  if (i < 120) return null;
  const key = Math.floor(i / 21);
  let perSeries = profileCache.get(bars);
  if (!perSeries) {
    perSeries = new Map();
    profileCache.set(bars, perSeries);
  }
  if (perSeries.has(key)) return perSeries.get(key)!;
  const window = bars.slice(Math.max(0, i - 252), i + 1);
  const pr = priceProfile(window, 36);
  perSeries.set(key, pr);
  return pr;
}


/** Simple moving average at index `i`. */
function smaAt(bars: Bar[], i: number, n: number): number | null {
  if (i + 1 < n) return null;
  let acc = 0;
  for (let j = i - n + 1; j <= i; j++) acc += bars[j].c;
  return acc / n;
}

/** Wilder RSI over the final `n` closes of a window. */
function rsiAt(win: Bar[], n: number): number | null {
  if (win.length < n + 1) return null;
  const slice = win.slice(-(n + 1));
  let g = 0;
  let l = 0;
  for (let k = 1; k < slice.length; k++) {
    const d = slice[k].c - slice[k - 1].c;
    if (d >= 0) g += d;
    else l -= d;
  }
  if (g + l === 0) return 50;
  return l === 0 ? 100 : 100 - 100 / (1 + g / l);
}

/** Annualised realised volatility over the trailing `n` bars ending at `i`. */
function realisedVol(bars: Bar[], i: number, n: number): number | null {
  if (i < n) return null;
  const rets: number[] = [];
  for (let j = i - n + 1; j <= i; j++) {
    const a = bars[j - 1]?.c;
    const b = bars[j]?.c;
    if (a > 0 && b > 0) rets.push(Math.log(b / a));
  }
  if (rets.length < 5) return null;
  const m = rets.reduce((x, y) => x + y, 0) / rets.length;
  const v = rets.reduce((x, y) => x + (y - m) ** 2, 0) / (rets.length - 1);
  return Math.sqrt(v) * Math.sqrt(252);
}


export function buildCtx(bars: Bar[]): Omit<Ctx, "i"> {
  const rollingMean = (n: number) => {
    const out: (number | null)[] = new Array(bars.length).fill(null);
    let sum = 0;
    for (let i = 0; i < bars.length; i++) {
      sum += bars[i].v ?? 0;
      if (i >= n) sum -= bars[i - n].v ?? 0;
      if (i >= n - 1) out[i] = sum / n;
    }
    return out;
  };
  return {
    bars,
    ema50: ema(bars, 50),
    ema200: ema(bars, 200),
    rsi: rsiSeries(bars, 14),
    vol20: rollingMean(20),
    vol60: rollingMean(60),
  };
}

/* ------------------------------------------------------------------ */
/* Backtest                                                            */
/* ------------------------------------------------------------------ */

export type RuleResult = {
  keys: string[];
  label: string;
  trades: number;
  /** Total return of the rule over the window, in %. */
  returnPct: number;
  /** Buy-and-hold over the same window, in %. */
  holdPct: number;
  /** Rule minus buy-and-hold, in pp. */
  edgePct: number;
  /** Share of trades that made money. */
  winRate: number;
  /** Fraction of the window spent invested. */
  exposure: number;
  maxDrawdownPct: number;
  avgHoldDays: number;
};

/**
 * Long/flat backtest. Enter when every condition in the set is true, exit when
 * the trend condition fails or a stop is hit.
 *
 * Exits are deliberately simple and fixed across every combination — the
 * question asked is whether the *entry* conditions add anything, and varying
 * exits at the same time would make it impossible to tell which change did the
 * work.
 */
export function backtest(
  bars: Bar[],
  ctxBase: Omit<Ctx, "i">,
  keys: string[],
  opts: { stopPct?: number; start?: number } = {}
): RuleResult | null {
  const conds = CONDITIONS.filter((c) => keys.includes(c.key));
  if (conds.length !== keys.length) return null;
  const stop = opts.stopPct ?? 0.15;
  const first = Math.max(opts.start ?? 0, 210);
  if (bars.length - first < 120) return null;

  let cash = 1;
  let shares = 0;
  let entryPrice = 0;
  let entryIdx = 0;
  let invested = 0;
  let peak = 1;
  let maxDd = 0;
  const holdDays: number[] = [];
  const wins: number[] = [];

  const exitTest = (c: Ctx) => {
    const e50 = c.ema50[c.i];
    const e200 = c.ema200[c.i];
    return e50 !== null && e200 !== null && e50 < e200;
  };

  for (let i = first; i < bars.length; i++) {
    const c: Ctx = { ...ctxBase, i };
    const px = bars[i].c;

    if (shares > 0) {
      invested++;
      const stopped = px <= entryPrice * (1 - stop);
      if (stopped || exitTest(c)) {
        cash = shares * px;
        wins.push(px / entryPrice - 1);
        holdDays.push(i - entryIdx);
        shares = 0;
      }
    } else if (conds.every((cond) => cond.test(c))) {
      shares = cash / px;
      entryPrice = px;
      entryIdx = i;
      cash = 0;
    }

    const equity = shares > 0 ? shares * px : cash;
    peak = Math.max(peak, equity);
    maxDd = Math.max(maxDd, (peak - equity) / peak);
  }

  const last = bars[bars.length - 1].c;
  const finalEquity = shares > 0 ? shares * last : cash;
  if (shares > 0) {
    wins.push(last / entryPrice - 1);
    holdDays.push(bars.length - 1 - entryIdx);
  }

  const holdRet = (last / bars[first].c - 1) * 100;
  const ruleRet = (finalEquity - 1) * 100;
  const n = bars.length - first;

  return {
    keys,
    label: conds.map((c) => c.label).join(" AND "),
    trades: wins.length,
    returnPct: Math.round(ruleRet * 10) / 10,
    holdPct: Math.round(holdRet * 10) / 10,
    edgePct: Math.round((ruleRet - holdRet) * 10) / 10,
    winRate: wins.length ? Math.round((wins.filter((w) => w > 0).length / wins.length) * 100) : 0,
    exposure: Math.round((invested / n) * 100) / 100,
    maxDrawdownPct: Math.round(maxDd * 1000) / 10,
    avgHoldDays: holdDays.length
      ? Math.round(holdDays.reduce((a, b) => a + b, 0) / holdDays.length)
      : 0,
  };
}

/** Every combination of up to `maxSize` conditions. */
export function combinations(maxSize = 3): string[][] {
  const keys = CONDITIONS.map((c) => c.key);
  const out: string[][] = [];
  const walk = (start: number, acc: string[]) => {
    if (acc.length > 0) out.push([...acc]);
    if (acc.length === maxSize) return;
    for (let i = start; i < keys.length; i++) {
      acc.push(keys[i]);
      walk(i + 1, acc);
      acc.pop();
    }
  };
  walk(0, []);
  return out;
}
