/**
 * What this company was worth on each past date, using only what was known then.
 *
 * The zone crossings on a crypto chart are drawn against the network's cost
 * basis as it stood on the day, because drawing them against today's basis
 * marked tops and called them entries. Equities had no equivalent series, so
 * they got today's fair value held flat across ten years — which is the same
 * look-ahead wearing a different hat, and worse for a company whose earnings
 * have multiplied. A name that earned $0.30 a share in 2023 was not worth
 * today's estimate then, and marking a "buy zone" at that level says price was
 * cheap at a moment when it was nothing of the sort.
 *
 * This rebuilds the anchor quarter by quarter from filed earnings. At each
 * period end the trailing twelve months of earnings are known, the prior year's
 * are known, and the growth between them is known — so the same multiple the
 * live model would have assigned can be assigned then, with nothing borrowed
 * from the future. The result is a step series that moves when results land,
 * which is how a valuation actually behaves.
 *
 * It is an approximation of the full blended valuation, not a replay of it: one
 * multiple on trailing earnings rather than six methods, because the other five
 * need balance-sheet and peer data that is not stored per historical quarter.
 * For marking where price sat against its own contemporaneous worth, an
 * earnings anchor that moves is far closer to the truth than a fixed line.
 *
 * SPLITS. Filed earnings per share are not restated when a company splits,
 * while the price history is adjusted back. Mixing the two puts the anchor on a
 * different basis from the chart it is drawn on: NVIDIA's first point came out
 * at $280 for a quarter when the split-adjusted price was near $4, because the
 * 2019 figures are per pre-split share. So the series is built from total
 * earnings and divided by today's share count, which lands on the same basis as
 * an adjusted price without needing to detect the split at all.
 */

export type AnchorPoint = { date: string; value: number };

export type QuarterInput = {
  periodEnd: string;
  /** Total earnings, which unlike per-share figures survive a split unchanged. */
  netIncome?: number;
  epsDiluted?: number;
  adjEps?: number;
};

/**
 * Same shape as the live target: a no-growth business earns a low-teens
 * multiple, and growth lifts it within bounds that stop one hot quarter from
 * implying any price. Kept in step with lib/valuation.ts targets().
 */
function targetPe(growth: number): number {
  return Math.max(10, Math.min(45, 14 + growth * 75));
}

/**
 * @param quarters newest first, as stored.
 * @param sharesNow current diluted share count, which puts the whole series on
 *   the same split-adjusted basis as the price history.
 * @returns anchor points at each period end, oldest first.
 */
export function buildAnchorHistory(
  quarters: QuarterInput[],
  sharesNow?: number
): AnchorPoint[] {
  if (!sharesNow || sharesNow <= 0) return [];
  const qs = quarters
    .filter((q) => q.periodEnd)
    .slice()
    .sort((a, b) => a.periodEnd.localeCompare(b.periodEnd)); // oldest first

  // Total earnings, not per share. See the note on splits above.
  const earnings = qs.map((q) =>
    typeof q.netIncome === "number" && Number.isFinite(q.netIncome) ? q.netIncome : null
  );

  const out: AnchorPoint[] = [];

  // Needs four quarters for a trailing year and eight to compare against the
  // prior one, so the series starts two years into the filed history.
  for (let i = 7; i < qs.length; i++) {
    const ttm = earnings.slice(i - 3, i + 1);
    const prior = earnings.slice(i - 7, i - 3);
    if (ttm.some((v) => v === null) || prior.some((v) => v === null)) continue;

    const now = (ttm as number[]).reduce((a, b) => a + b, 0);
    const then = (prior as number[]).reduce((a, b) => a + b, 0);
    if (!(now > 0)) continue; // a loss-making year has no earnings anchor

    const growth = then > 0 ? now / then - 1 : 0;
    const value = (now / sharesNow) * targetPe(Math.max(-0.2, Math.min(0.6, growth)));
    if (Number.isFinite(value) && value > 0) {
      out.push({ date: qs[i].periodEnd, value: Math.round(value * 100) / 100 });
    }
  }

  return out;
}
