/**
 * Where price sits in its own traded range, and how much of that range the
 * valuation actually speaks to.
 *
 * This exists because of Strategy. Its fair value is $102 and its zone table
 * tops out near $180, but it has traded between $13.66 and $473.83 — the model
 * describes 39% of the range the asset has actually occupied, and price spent
 * roughly a quarter of all sessions entirely outside it. Reading only the
 * valuation, the answer is "well above value". Reading only the chart, price is
 * near the bottom of its own history. Both are true, and showing one without
 * the other is what made the page feel wrong.
 *
 * WHAT THIS IS NOT. The obvious move here is Fibonacci retracement levels, and
 * the evidence does not support them. Tsinaslanidis, Guo and Zapranis (Expert
 * Systems with Applications, 2022) tested them across the Dow, NASDAQ and DAX
 * and found the probability of price bouncing on a Fibonacci zone statistically
 * indistinguishable from bouncing on a randomly chosen non-Fibonacci zone; a
 * trading rule built on them failed to beat one built on random levels, and
 * underperformed buy-and-hold. At wider zone widths prices were significantly
 * *more* likely to bounce on the non-Fibonacci levels. This project's own
 * tournament agreed independently — the 38-62% retracement condition scored
 * -5.4pp against buy-and-hold across thirteen names and four periods.
 *
 * So the retracement levels are computed and drawn as reference marks on the
 * range, because they are a conventional way to read a chart and their
 * arithmetic is not in dispute, but they are labelled as landmarks rather than
 * levels where anything is expected to happen. The range position is the part
 * carrying real information.
 */

export type RangeContext = {
  low: number;
  high: number;
  /** 0-100: where the current price sits between the range low and high. */
  position: number;
  /** Drawdown from the highest close, in %. */
  fromHigh: number;
  /** Gain from the lowest close, in %. */
  fromLow: number;
  sessions: number;
  /** Share of the traded range the valuation zones actually cover, 0-100. */
  bandCoverage?: number;
  /** Share of sessions price spent inside the zone table, 0-100. */
  sessionsInBand?: number;
  /** Retracement landmarks from the swing high back toward the swing low. */
  retracements: { label: string; price: number }[];
  /** Plain statement of what the two views disagree about, when they do. */
  note?: string;
};

const r1 = (n: number) => Math.round(n * 10) / 10;

export function rangeContext(
  closes: number[],
  bands?: { priceLo: number; priceHi: number }[]
): RangeContext | null {
  const xs = closes.filter((c) => Number.isFinite(c) && c > 0);
  if (xs.length < 60) return null;

  const low = Math.min(...xs);
  const high = Math.max(...xs);
  if (!(high > low)) return null;
  const now = xs[xs.length - 1];

  const span = high - low;
  const position = ((now - low) / span) * 100;

  let bandCoverage: number | undefined;
  let sessionsInBand: number | undefined;
  let note: string | undefined;

  if (bands?.length) {
    const bLo = Math.min(...bands.map((b) => b.priceLo));
    const bHi = Math.max(...bands.map((b) => b.priceHi));
    bandCoverage = Math.min(100, ((bHi - bLo) / span) * 100);
    sessionsInBand = (xs.filter((c) => c >= bLo && c <= bHi).length / xs.length) * 100;

    // The case worth flagging: the model calls it expensive while the chart has
    // it near its own floor. That is not a contradiction to resolve, it is two
    // measurements of different things, and the user should see both.
    const expensive = now > bHi * 0.9;
    if (bandCoverage < 60 && position < 40 && !expensive) {
      note =
        `The valuation zones cover ${Math.round(bandCoverage)}% of the range this has actually ` +
        `traded in, and price sits at ${Math.round(position)}% of that range — low by its own ` +
        `history while the fundamentals still read as rich. Both readings are measuring something ` +
        `real; they disagree because one is anchored to earnings and the other to what the market ` +
        `has been willing to pay.`;
    } else if (bandCoverage < 60) {
      note =
        `Price has ranged from ${money(low)} to ${money(high)}, and the valuation zones describe ` +
        `only ${Math.round(bandCoverage)}% of that. Treat the zones as where the fundamentals put ` +
        `it, not as the bounds of where it can trade.`;
    }
  }

  // Landmarks on the realised range, not predicted levels. See the file note.
  const retracements = [0.236, 0.382, 0.5, 0.618, 0.786].map((f) => ({
    label: `${(f * 100).toFixed(1)}%`,
    price: Math.round((high - span * f) * 100) / 100,
  }));

  return {
    low: Math.round(low * 100) / 100,
    high: Math.round(high * 100) / 100,
    position: r1(position),
    fromHigh: r1(((now - high) / high) * 100),
    fromLow: r1(((now - low) / low) * 100),
    sessions: xs.length,
    bandCoverage: bandCoverage === undefined ? undefined : r1(bandCoverage),
    sessionsInBand: sessionsInBand === undefined ? undefined : r1(sessionsInBand),
    retracements,
    note,
  };
}

const money = (n: number) =>
  n >= 1000
    ? `$${Math.round(n).toLocaleString()}`
    : `$${n.toFixed(2)}`;
