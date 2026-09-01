/**
 * Where to actually buy — as a mix, not as one school of thought.
 *
 * Two honest answers to "what price would make this attractive" exist and they
 * routinely disagree by a factor of three.
 *
 * The intrinsic answer discounts cash flows and applies a margin of safety. It
 * is the one that cannot be argued into justifying a bubble, and for a
 * structural grower in an expensive market it produces a level the stock has
 * not touched in a decade and plausibly never will. A buy level nobody can act
 * on is not advice, it is abstention wearing a number.
 *
 * The relative answer asks what the market has actually paid for this company's
 * revenue over its own history, and takes the cheap end of that record. It is
 * always reachable, because it is made of prices that happened. On its own it is
 * circular - it ratifies whatever the market has been doing, and would have
 * called every bubble a fair price at the 25th percentile of itself.
 *
 * Neither is right alone, so both are reported and a blend is reported beside
 * them. The blend is geometric, because these are ratios that can differ by
 * multiples and an arithmetic mean would let the larger number swamp the
 * smaller. The weight is not a preference: it rises with how much evidence the
 * relative record actually carries - how many quarters, and how stable the
 * multiple has been - and falls away to nothing when that record is thin or
 * erratic, leaving the intrinsic level standing alone.
 *
 * Showing all three is the point. Where they converge the level is worth
 * trusting; where they diverge by three times, that divergence is the single
 * most useful thing on the page, and collapsing it into one number would be
 * hiding the only real finding.
 */

export type BuyLevels = {
  /** Fair value less the margin of safety. Absolute, often unreachable. */
  intrinsic?: number;
  /** The cheap end of what the market has paid for its sales. Always reachable.
   *  Omitted when the record earned no weight, so the display cannot show a
   *  number the blend already rejected. */
  relative?: number;
  /** True when a relative level existed but was too erratic to use. */
  relativeDiscarded?: boolean;
  /** Geometric blend, weighted by how much the relative record is worth. */
  blended?: number;
  /** Weight given to the relative level, 0-1. */
  relativeWeight: number;
  /** How far below today's price the blended level sits, in %. */
  discountToPrice?: number;
  summary: string;
};

const r2 = (n: number) => Math.round(n * 100) / 100 + 0;

export function buyLevels(input: {
  price?: number;
  fairValue?: number;
  marginOfSafety?: number;
  revenueTtm?: number;
  netCash?: number;
  shares?: number;
  /** 25th percentile of this company's own EV/Sales history. */
  ownP25EvSales?: number;
  ownEvSalesSamples?: number;
  /** Dispersion of that history; an erratic multiple is weak evidence. */
  ownEvSalesCv?: number;
  /** Delivered revenue growth, as a fraction. The relative level is priced on
   *  the revenue this will have, not the revenue it had. */
  revenueGrowth?: number;
}): BuyLevels | null {
  const { price, fairValue, revenueTtm, shares } = input;
  if (!price || price <= 0) return null;

  const intrinsic =
    fairValue && fairValue > 0
      ? r2(fairValue * (1 - (input.marginOfSafety ?? 0.12)))
      : undefined;

  let relative: number | undefined;
  if (
    input.ownP25EvSales &&
    input.ownP25EvSales > 0 &&
    revenueTtm &&
    revenueTtm > 0 &&
    shares &&
    shares > 0
  ) {
    // Forward revenue, not trailing. A multiple from this company's own past
    // applied to the revenue it had a year ago is stale twice over, and for a
    // fast grower the staleness is the whole error: Cloudflare's sales rise
    // about 30% a year, so pricing a historical multiple against trailing
    // revenue marks the buy level 30% too low every single year and calls it
    // conservatism. Relative valuation is done on forward numbers precisely
    // because of this. Growth is capped at 40% and floored at zero so a hot
    // year cannot inflate the level and a bad one cannot be extrapolated down.
    const g = Math.max(0, Math.min(0.4, input.revenueGrowth ?? 0));
    const fwdRevenue = revenueTtm * (1 + g);
    const v = (input.ownP25EvSales * fwdRevenue + (input.netCash ?? 0)) / shares;
    if (v > 0) relative = r2(v);
  }

  // Evidence, not preference. A long record of a steady multiple earns weight;
  // eight quarters of a multiple that swung by half of itself earns very little.
  let w = 0;
  if (relative !== undefined) {
    const n = input.ownEvSalesSamples ?? 0;
    const depth = Math.min(1, Math.max(0, (n - 6) / 24)); // 6 quarters -> 0, 30 -> 1
    const cv = input.ownEvSalesCv ?? 0.5;
    const steadiness = Math.min(1, Math.max(0, 1 - cv)); // cv 0 -> 1, cv >=1 -> 0
    w = Math.min(0.7, depth * steadiness);
  }

  let blended: number | undefined;
  if (intrinsic !== undefined && relative !== undefined && w > 0) {
    blended = r2(Math.exp((1 - w) * Math.log(intrinsic) + w * Math.log(relative)));
  } else {
    blended = intrinsic ?? relative;
  }

  const discountToPrice = blended ? r2((blended / price - 1) * 100) : undefined;

  // When the record earned no weight the blend ignored it, and presenting the
  // number anyway as a co-equal basis is worse than not showing it. Strategy is
  // the case: its EV/Sales record reaches back to when it was a small software
  // company at 1.5x sales, before the balance sheet became the business, so the
  // cheap end of that record prices it at $1.48. The weighting already threw
  // that away for being erratic; the display has to agree with the weighting.
  const relativeUsable = w > 0.05 ? relative : undefined;
  const relativeDiscarded = relative !== undefined && relativeUsable === undefined;

  let summary: string;
  if (intrinsic === undefined && relativeUsable === undefined) {
    summary = blended === undefined ? "Not enough to place a buy level on." : `Only one basis is available, so the level is $${blended}.`;
  } else if (relativeDiscarded) {
    summary =
      `Its own trading record was too erratic to lean on - the multiple has swung far enough that the cheap end of it ` +
      `is not a level so much as an artefact of a different era of the business - so this is the cash-flow level alone, ` +
      `$${blended}, ${Math.abs(discountToPrice ?? 0)}% below today.`;
  } else if (intrinsic === undefined || relativeUsable === undefined) {
    summary = `Only one basis is available, so the level is $${blended}, ${Math.abs(discountToPrice ?? 0)}% below today.`;
  } else {
    // Symmetric: the two can disagree in either direction, and dividing one way
    // called a 48x gap "agreement" because the quotient came out at 0.02.
    const ratio = Math.max(relativeUsable / intrinsic, intrinsic / relativeUsable);
    summary =
      ratio > 2
        ? `The two bases disagree by ${ratio.toFixed(1)}x: cash flows say $${intrinsic}, its own trading record says $${relativeUsable}. ` +
          `That gap is the finding rather than a problem to average away - the market has persistently paid a different price ` +
          `for this than the cash justifies, and whether that persists is what the model cannot settle. The blend sits at ` +
          `$${blended}, ${Math.abs(discountToPrice ?? 0)}% below today.`
        : `Both bases agree within ${ratio.toFixed(1)}x - cash flows say $${intrinsic}, its own record says $${relativeUsable} - ` +
          `so $${blended} is a level worth trusting, ${Math.abs(discountToPrice ?? 0)}% below today.`;
  }

  return {
    intrinsic,
    relative: relativeUsable,
    relativeDiscarded,
    blended,
    relativeWeight: r2(w),
    discountToPrice,
    summary,
  };
}
