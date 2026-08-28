/**
 * Buy-the-dip detector.
 *
 * A pullback is only interesting once selling pressure is actually fading.
 * Price alone cannot tell you that — a stock 20% off its high is either a
 * bargain or the middle of a collapse, and the difference shows up in volume:
 * heavy, accelerating down-volume means sellers are still in control; volume
 * drying up on down days while up-days start carrying more of it is the
 * signature of exhaustion.
 *
 * States, in order of readiness:
 *   none        — not in a meaningful pullback
 *   falling     — in a pullback, selling still heavy
 *   stabilising — selling pressure easing, no reversal yet
 *   reversing   — pressure gone and structure turning up
 *
 * Volume is not always available: the Nasdaq fallback price feed omits it, so
 * the detector says so rather than inventing a signal from zeros.
 */

export type DipBar = { date: string; o: number; h: number; l: number; c: number; v: number };

export type DipState = "none" | "falling" | "stabilising" | "reversing" | "noVolume";

export type DipSignal = {
  state: DipState;
  /** 0..100 — how ready this pullback looks. Only meaningful when in one. */
  score: number;
  drawdown: number; // from the 60-day high
  upDownVolume?: number; // last 10 sessions, >1 means up-days carry more volume
  sellingPressure?: number; // recent down-volume vs its own baseline, <1 is easing
  volumeTrend?: number; // last 5 vs last 30 average
  higherLow: boolean;
  evidence: string;
};

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));

export function detectDip(bars: DipBar[]): DipSignal {
  const none: DipSignal = {
    state: "none",
    score: 0,
    drawdown: 0,
    higherLow: false,
    evidence: "not in a pullback",
  };
  if (bars.length < 65) return { ...none, evidence: "needs 65 sessions of history" };

  const recent = bars.slice(-60);
  const last = recent[recent.length - 1];
  const high60 = Math.max(...recent.map((b) => b.h || b.c));
  const drawdown = high60 > 0 ? 1 - last.c / high60 : 0;

  // The Nasdaq fallback omits volume; a detector built on zeros would be a
  // confident fabrication.
  const hasVolume = recent.slice(-30).some((b) => b.v > 0);
  if (!hasVolume) {
    return {
      state: "noVolume",
      score: 0,
      drawdown: Math.round(drawdown * 1000) / 10,
      higherLow: false,
      evidence: "price feed did not supply volume — dip quality cannot be judged",
    };
  }

  if (drawdown < 0.08) {
    return { ...none, drawdown: Math.round(drawdown * 1000) / 10 };
  }

  // --- volume structure -------------------------------------------------
  const dayDir = (b: DipBar, prev: DipBar) => (b.c >= prev.c ? 1 : -1);
  const last10: { dir: number; v: number }[] = [];
  const prior30: { dir: number; v: number }[] = [];
  for (let i = recent.length - 40; i < recent.length; i++) {
    if (i <= 0) continue;
    const entry = { dir: dayDir(recent[i], recent[i - 1]), v: recent[i].v };
    if (i >= recent.length - 10) last10.push(entry);
    else prior30.push(entry);
  }

  const upVol = last10.filter((d) => d.dir > 0).reduce((s, d) => s + d.v, 0);
  const downVol = last10.filter((d) => d.dir < 0).reduce((s, d) => s + d.v, 0);
  const upDownVolume = downVol > 0 ? upVol / downVol : upVol > 0 ? 2 : 1;

  const recentDownAvg = avg(last10.filter((d) => d.dir < 0).map((d) => d.v));
  const baseDownAvg = avg(prior30.filter((d) => d.dir < 0).map((d) => d.v));
  const sellingPressure = baseDownAvg > 0 ? recentDownAvg / baseDownAvg : 1;

  const vol5 = avg(recent.slice(-5).map((b) => b.v));
  const vol30 = avg(recent.slice(-30).map((b) => b.v));
  const volumeTrend = vol30 > 0 ? vol5 / vol30 : 1;

  // --- price structure --------------------------------------------------
  const low5 = Math.min(...recent.slice(-5).map((b) => b.l || b.c));
  const priorLow5 = Math.min(...recent.slice(-10, -5).map((b) => b.l || b.c));
  const higherLow = low5 > priorLow5;

  // --- score ------------------------------------------------------------
  // Each component is evidence that sellers are done, not that price is low.
  const easing = clamp((1.15 - sellingPressure) * 90);       // down-volume fading
  const accumulation = clamp((upDownVolume - 0.7) * 85);      // up-days carrying volume
  const quieting = clamp((1.25 - volumeTrend) * 80);          // overall volume drying up
  const structure = higherLow ? 100 : 25;

  const score = Math.round(
    easing * 0.35 + accumulation * 0.3 + quieting * 0.15 + structure * 0.2
  );

  let state: DipState = "falling";
  if (score >= 62 && (higherLow || upDownVolume > 1.2)) state = "reversing";
  else if (score >= 45) state = "stabilising";

  const parts = [
    `${Math.round(drawdown * 100)}% off the 60-day high`,
    sellingPressure < 0.95
      ? `down-day volume ${Math.round((1 - sellingPressure) * 100)}% below its own baseline`
      : `down-day volume still ${Math.round((sellingPressure - 1) * 100)}% above baseline`,
    `up/down volume ${upDownVolume.toFixed(2)}`,
    higherLow ? "higher low forming" : "no higher low yet",
  ];

  return {
    state,
    score,
    drawdown: Math.round(drawdown * 1000) / 10,
    upDownVolume: Math.round(upDownVolume * 100) / 100,
    sellingPressure: Math.round(sellingPressure * 100) / 100,
    volumeTrend: Math.round(volumeTrend * 100) / 100,
    higherLow,
    evidence: parts.join(" · "),
  };
}

export const DIP_LABEL: Record<DipState, string> = {
  none: "No pullback",
  falling: "Still falling",
  stabilising: "Selling easing",
  reversing: "Turning up",
  noVolume: "No volume data",
};

export const DIP_COLOR: Record<DipState, string> = {
  none: "var(--muted)",
  falling: "var(--bad)",
  stabilising: "var(--warn)",
  reversing: "var(--good)",
  noVolume: "var(--muted)",
};
