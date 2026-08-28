/**
 * The rating, plus what you would be buying into.
 *
 * "Strong buy" answers whether the price is attractive. It says nothing about
 * whether the selling has stopped, so a name can be genuinely cheap and still
 * be a falling knife — and those are different decisions even when the rating
 * is the same. The qualifier here carries that second fact into the label
 * instead of leaving it in a separate panel to be noticed or not.
 *
 * One thing this deliberately does NOT claim: that waiting for the pullback to
 * stabilise produces better returns. This project measured exactly that across
 * 2,936 observations and found no predictive power in any dip state — max |t|
 * of 1.02 against a 2.58 bar. So the qualifier is framed as a description of
 * conditions, never as a timing instruction. It tells you the knife is still
 * falling; it does not tell you the fall will continue.
 */

export type DipState = "none" | "falling" | "stabilising" | "reversing" | "noVolume";

export type SignalLabel = {
  /** The rating and the condition, as one phrase. */
  headline: string;
  /** What that combination actually means for a decision. */
  hint: string;
  /** True when the price is attractive but the selling has not stopped. */
  fallingKnife: boolean;
  tone: "good" | "warn" | "bad" | "neutral";
};

const BUYISH = new Set(["STRONG_BUY", "BUY", "ACCUMULATE"]);

const QUALIFIER: Record<string, string> = {
  falling: "still falling",
  stabilising: "selling easing",
  reversing: "turning up",
};

const PRETTY: Record<string, string> = {
  STRONG_BUY: "Strong buy",
  BUY: "Buy",
  ACCUMULATE: "Accumulate",
  HOLD: "Hold",
  TRIM: "Trim",
  SELL: "Sell",
  AVOID: "Avoid",
  INSUFFICIENT_DATA: "Not enough data",
};

export function signalLabel(verdict?: string, dipState?: string, dipScore?: number): SignalLabel {
  const v = verdict ?? "INSUFFICIENT_DATA";
  const pretty = PRETTY[v] ?? v.replace(/_/g, " ");
  const buyish = BUYISH.has(v);
  const state = (dipState ?? "none") as DipState;
  const qual = QUALIFIER[state];

  const fallingKnife = buyish && state === "falling";

  if (!qual || state === "none" || state === "noVolume") {
    return {
      headline: pretty,
      hint: buyish
        ? "Priced attractively, and not in a pullback right now."
        : "No active pullback to weigh against the rating.",
      fallingKnife: false,
      tone: buyish ? "good" : "neutral",
    };
  }

  const headline = `${pretty} — ${qual}`;

  if (fallingKnife) {
    return {
      headline,
      hint:
        "Cheap on the numbers, but the selling has not stopped — this is a falling knife today. " +
        "Nothing here says it will keep falling; it says you would be buying into a decline, " +
        "so size it as one entry rather than the whole position.",
      fallingKnife: true,
      tone: "warn",
    };
  }

  if (buyish && state === "stabilising") {
    return {
      headline,
      hint:
        "Priced attractively and the selling pressure is fading" +
        (dipScore ? ` (${dipScore}/100 on the dip read)` : "") +
        ". The decline is losing force, which is a description of conditions rather than a signal that the low is in.",
      tone: "good",
      fallingKnife: false,
    };
  }

  if (buyish && state === "reversing") {
    return {
      headline,
      hint:
        "Priced attractively and price is turning up off the low" +
        (dipScore ? ` (${dipScore}/100)` : "") +
        ". Worth knowing, though measured against forward returns this state has shown no edge over any other.",
      tone: "good",
      fallingKnife: false,
    };
  }

  // Not a buy rating — the pullback is context on a name you would not be adding to.
  return {
    headline,
    hint:
      state === "falling"
        ? "Falling, and the valuation does not make it attractive on the way down."
        : "In a pullback, but the rating is not asking you to buy it.",
    fallingKnife: false,
    tone: v === "HOLD" ? "neutral" : "bad",
  };
}
