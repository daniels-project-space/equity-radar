/**
 * Causal features, computed from bars up to and including the decision bar.
 *
 * Nothing here may read a future bar. Every function takes a window ending at
 * the decision point, which is what makes the calibration in `calibrate.ts` a
 * fair test rather than a restatement of what already happened.
 *
 * These are candidate signals, not endorsed ones. The point of measuring them
 * side by side is that most will turn out to be worthless, and the system
 * should be able to say which.
 */

import { detectDip, type DipBar } from "./dip";

export type Bucketed = { signal: string; bucket: string };

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/** Simple moving average of the last `n` closes in the window. */
function sma(bars: DipBar[], n: number): number | null {
  if (bars.length < n) return null;
  return mean(bars.slice(-n).map((b) => b.c));
}

/** Wilder RSI over the last `n` closes. */
function rsi(bars: DipBar[], n = 14): number | null {
  if (bars.length < n + 1) return null;
  const slice = bars.slice(-(n + 1));
  let gain = 0;
  let loss = 0;
  for (let i = 1; i < slice.length; i++) {
    const d = slice[i].c - slice[i - 1].c;
    if (d >= 0) gain += d;
    else loss -= d;
  }
  if (gain + loss === 0) return 50;
  const rs = loss === 0 ? 100 : gain / loss;
  return 100 - 100 / (1 + rs);
}

/**
 * Every candidate signal at one decision point, each already reduced to a
 * bucket label. Returns only the signals the window is long enough to support.
 */
export function featuresAt(window: DipBar[]): Bucketed[] {
  const out: Bucketed[] = [];
  const last = window[window.length - 1];
  if (!last || last.c <= 0) return out;
  const px = last.c;

  // Position relative to the long trend. The classic "is it above its 200-day"
  // question, expressed as distance so it can be bucketed.
  const ma = sma(window, 200) ?? sma(window, Math.min(150, window.length));
  if (ma && ma > 0) {
    const d = (px / ma - 1) * 100;
    out.push({
      signal: "trend",
      bucket:
        d >= 20 ? "well above" : d >= 5 ? "above" : d >= -5 ? "at trend" : d >= -20 ? "below" : "well below",
    });
  }

  // Drawdown from the recent high, independent of the dip state machine.
  const hi = Math.max(...window.slice(-65).map((b) => b.c));
  if (hi > 0) {
    const dd = (1 - px / hi) * 100;
    out.push({
      signal: "drawdown",
      bucket: dd < 5 ? "<5%" : dd < 12 ? "5-12%" : dd < 20 ? "12-20%" : dd < 30 ? "20-30%" : ">30%",
    });
  }

  // Volume regime: is participation expanding or drying up?
  const v20 = mean(window.slice(-20).map((b) => b.v ?? 0));
  const v60 = mean(window.slice(-60).map((b) => b.v ?? 0));
  if (v20 > 0 && v60 > 0) {
    const ratio = v20 / v60;
    out.push({
      signal: "volume",
      bucket: ratio >= 1.3 ? "surging" : ratio >= 1.05 ? "rising" : ratio >= 0.85 ? "steady" : "drying up",
    });
  }

  // Medium-term momentum.
  if (window.length >= 61) {
    const past = window[window.length - 61].c;
    if (past > 0) {
      const m = (px / past - 1) * 100;
      out.push({
        signal: "momentum",
        bucket: m >= 20 ? "strong" : m >= 5 ? "positive" : m >= -5 ? "flat" : m >= -20 ? "negative" : "sharp decline",
      });
    }
  }

  // Short-term stretch.
  const r = rsi(window, 14);
  if (r !== null) {
    out.push({
      signal: "rsi",
      bucket: r >= 70 ? "overbought" : r >= 55 ? "firm" : r >= 45 ? "neutral" : r >= 30 ? "soft" : "oversold",
    });
  }

  // Nearness to the 52-week high (George & Hwang, "The 52-Week High and
  // Momentum Investing"). Their finding is that stocks trading close to their
  // own 52-week high subsequently outperform those far from it, and that this
  // beats conventional return momentum — the opposite of buy-the-dip. It is
  // included because it is the strongest published contradiction of the
  // premise this project started from, and it deserves the same test as
  // everything else rather than an argument.
  const win52 = window.slice(-252);
  if (win52.length >= 120) {
    const hi52 = Math.max(...win52.map((b) => b.h || b.c));
    if (hi52 > 0) {
      const near = px / hi52;
      out.push({
        signal: "near52wHigh",
        bucket:
          near >= 0.98 ? "at high" : near >= 0.9 ? "within 10%" : near >= 0.75 ? "10-25% below" : near >= 0.5 ? "25-50% below" : "far below",
      });
    }
  }

  // Connors RSI(2): above the 200-day trend, below the 5-day, RSI(2) under 10.
  // A short sharp pullback inside an intact uptrend. Independent testing in
  // 2026 found it alive but modest out-of-sample (Sharpe ~0.56 on daily bars),
  // with the trend filter contributing drawdown control rather than return.
  {
    const sma200 = sma(window, 200);
    const sma5 = sma(window, 5);
    const r2 = rsi(window, 2);
    if (sma200 && sma5 && r2 !== null) {
      const aboveTrend = px > sma200;
      const stretched = px < sma5;
      out.push({
        signal: "connors",
        bucket: !aboveTrend
          ? "below trend"
          : r2 < 10 && stretched
            ? "oversold setup"
            : r2 < 30
              ? "mild pullback"
              : "no setup",
      });
    }
  }

  // The dip state machine, tested on the same footing as the rest.
  const dip = detectDip(window);
  if (dip.state !== "noVolume") out.push({ signal: "dipState", bucket: dip.state });

  return out;
}
