/**
 * Volume profile, and its time-based cousin.
 *
 * Most of the levels this app draws come from a formula with numbers chosen by
 * judgement. A profile does not: it bins every bar into price rows and reports
 * where business actually concentrated. The point of control is the mode of the
 * distribution and the value area is the band holding a set share of it — both
 * measured, with only the row count and the 70% convention chosen, and both
 * stated rather than buried.
 *
 * The lineage is Steidlmayer's Market Profile at the CBOT, with volume standing
 * in for time. The honest framing comes from the same sources that teach it: a
 * profile ranks locations by how much trade happened there, and says nothing
 * about what price will do on the next visit. Vendor pages quote win rates for
 * value-area fades and naked-POC revisits in the 68-85% range; none of those are
 * peer-reviewed, none report a benchmark, and this project has already watched
 * three separate indicator families evaporate under a proper test. So the levels
 * are computed here and then run through the same tournament as everything
 * else, and what that test says is what governs.
 *
 * Two variants, because the inputs differ by asset:
 *
 *   VOLUME PROFILE for equities, where share volume is reported.
 *   TIME PROFILE for crypto, where the free feed publishes closes with no
 *   volume at all. Counting bars at a price is the original Market Profile
 *   construction and needs no volume, so the asset gets a real profile rather
 *   than a volume profile computed from zeros — which would return a single
 *   meaningless row.
 */

export type ProfileBar = { date: string; h: number; l: number; c: number; v: number };

export type PriceProfile = {
  /** Price with the most activity — the mode. */
  poc: number;
  /** Top and bottom of the band holding `coverage` of activity. */
  vah: number;
  val: number;
  coverage: number;
  /** Rows, low to high, for drawing. */
  rows: { price: number; weight: number }[];
  /** Prices where activity concentrated, densest first. */
  highVolumeNodes: number[];
  /** Thin shelves — prices the market moved through quickly. */
  lowVolumeNodes: number[];
  basis: "volume" | "time";
  /** Where the current price sits relative to the value area. */
  location: "below value" | "in value" | "above value";
  summary: string;
};

const VALUE_AREA = 0.7;
const ROWS = 48;

/**
 * @param bars chronological
 * @param rows number of price buckets; more rows means finer levels and noisier
 *   nodes, so this is deliberately coarse rather than tuned.
 */
export function priceProfile(bars: ProfileBar[], rows = ROWS): PriceProfile | null {
  const usable = bars.filter((b) => Number.isFinite(b.c) && b.c > 0);
  if (usable.length < 60) return null;

  const lo = Math.min(...usable.map((b) => Math.min(b.l || b.c, b.c)));
  const hi = Math.max(...usable.map((b) => Math.max(b.h || b.c, b.c)));
  if (!(hi > lo)) return null;

  // Volume is only meaningful if it is actually reported. The crypto feed
  // returns zeros, and a volume profile over zeros is a single empty row.
  const totalVolume = usable.reduce((s, b) => s + (b.v || 0), 0);
  const basis: "volume" | "time" = totalVolume > 0 ? "volume" : "time";

  const step = (hi - lo) / rows;
  const weights = new Array(rows).fill(0);

  for (const b of usable) {
    // Spread each bar's weight across the rows it spanned, so a wide day is not
    // counted as though all its business happened at the close.
    const bl = Math.min(b.l || b.c, b.c);
    const bh = Math.max(b.h || b.c, b.c);
    const from = Math.max(0, Math.floor((bl - lo) / step));
    const to = Math.min(rows - 1, Math.floor((bh - lo) / step));
    const span = to - from + 1;
    const w = (basis === "volume" ? b.v : 1) / span;
    for (let r = from; r <= to; r++) weights[r] += w;
  }

  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) return null;

  const priceAt = (r: number) => lo + step * (r + 0.5);
  let pocRow = 0;
  for (let r = 1; r < rows; r++) if (weights[r] > weights[pocRow]) pocRow = r;

  // Grow outward from the point of control, always taking the richer side, until
  // the included rows hold the coverage share. This is the standard
  // construction rather than a symmetric band around the mode.
  let lower = pocRow;
  let upper = pocRow;
  let acc = weights[pocRow];
  while (acc < total * VALUE_AREA && (lower > 0 || upper < rows - 1)) {
    const below = lower > 0 ? weights[lower - 1] : -1;
    const above = upper < rows - 1 ? weights[upper + 1] : -1;
    if (above >= below) {
      upper++;
      acc += Math.max(0, above);
    } else {
      lower--;
      acc += Math.max(0, below);
    }
  }

  const sorted = [...weights.keys()].sort((a, b) => weights[b] - weights[a]);
  const highVolumeNodes = sorted.slice(0, 3).map(priceAt);
  const lowVolumeNodes = [...weights.keys()]
    .filter((r) => r > lower && r < upper && weights[r] > 0)
    .sort((a, b) => weights[a] - weights[b])
    .slice(0, 2)
    .map(priceAt);

  const poc = priceAt(pocRow);
  const val = priceAt(lower);
  const vah = priceAt(upper);
  const now = usable[usable.length - 1].c;
  const location = now < val ? "below value" : now > vah ? "above value" : "in value";

  const money = (n: number) =>
    n >= 1000 ? `$${Math.round(n).toLocaleString()}` : `$${n.toFixed(2)}`;

  return {
    poc: Math.round(poc * 100) / 100,
    vah: Math.round(vah * 100) / 100,
    val: Math.round(val * 100) / 100,
    coverage: VALUE_AREA,
    rows: weights.map((w, r) => ({ price: Math.round(priceAt(r) * 100) / 100, weight: w / total })),
    highVolumeNodes: highVolumeNodes.map((p) => Math.round(p * 100) / 100),
    lowVolumeNodes: lowVolumeNodes.map((p) => Math.round(p * 100) / 100),
    basis,
    location,
    summary:
      `Most ${basis === "volume" ? "volume changed hands" : "time was spent"} at ${money(poc)}, ` +
      `with 70% of activity between ${money(val)} and ${money(vah)}. ` +
      `Price is ${location}.`,
  };
}
