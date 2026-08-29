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
 * multiple rather than six methods. For marking where price sat against its own
 * contemporaneous worth, an anchor that moves is far closer to the truth than a
 * fixed line.
 *
 * THE ANCHOR FOLLOWS THE ARCHETYPE, for the same reason the live valuation does.
 * Built on earnings alone it produced nothing at all for the companies that do
 * not earn — Applied Optoelectronics and Cloudflare got zero points, and
 * Strategy got two, because a loss-making quarter has no earnings anchor and
 * Strategy has many. That is not a company with no worth; it is the wrong
 * measure of worth. A holding company is anchored on what it owns, a pre-profit
 * business on what it sells, and only an earnings compounder on what it earns.
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
  /** Totals rather than per-share figures, which survive a split unchanged. */
  netIncome?: number;
  revenue?: number;
  equity?: number;
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

/** Sales multiple for a business with no earnings to capitalise. */
function targetEvSales(growth: number): number {
  return Math.max(0.5, Math.min(8, 1.5 + growth * 6));
}

/** Premium to book for a company whose worth is the assets it holds. */
const NAV_PREMIUM = 1.2;

/**
 * @param quarters newest first, as stored.
 * @param sharesNow current diluted share count, which puts the whole series on
 *   the same split-adjusted basis as the price history.
 * @returns anchor points at each period end, oldest first.
 */
export function buildAnchorHistory(
  quarters: QuarterInput[],
  sharesNow?: number,
  archetype?: string
): AnchorPoint[] {
  if (!sharesNow || sharesNow <= 0) return [];
  const qs = quarters
    .filter((q) => q.periodEnd)
    .slice()
    .sort((a, b) => a.periodEnd.localeCompare(b.periodEnd)); // oldest first

  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const earnings = qs.map((q) => num(q.netIncome));
  const sales = qs.map((q) => num(q.revenue));
  const book = qs.map((q) => num(q.equity));

  const out: AnchorPoint[] = [];
  const ttmAt = (xs: (number | null)[], i: number): number | null => {
    const w = xs.slice(i - 3, i + 1);
    return w.length === 4 && w.every((v) => v !== null)
      ? (w as number[]).reduce((a, b) => a + b, 0)
      : null;
  };

  // One trailing year is enough to place a point. Where the prior year also
  // exists the growth between them sets the multiple; where it does not, growth
  // is taken as zero rather than dropping the point, which is what previously
  // cost the first year of every series.
  for (let i = 3; i < qs.length; i++) {
    const priorEarn = i >= 7 ? ttmAt(earnings, i - 4) : null;
    const nowEarn = ttmAt(earnings, i);
    const nowSales = ttmAt(sales, i);
    const priorSales = i >= 7 ? ttmAt(sales, i - 4) : null;

    let value: number | null = null;

    if (archetype === "assetHolding") {
      // Worth is what it holds, marked at a modest premium — the same basis the
      // live valuation uses for a treasury company.
      const eq = book[i];
      if (eq !== null && eq > 0) value = (eq / sharesNow) * NAV_PREMIUM;
    } else if (nowEarn !== null && nowEarn > 0 && archetype !== "preProfit") {
      const g = priorEarn !== null && priorEarn > 0 ? nowEarn / priorEarn - 1 : 0;
      value = (nowEarn / sharesNow) * targetPe(Math.max(-0.2, Math.min(0.6, g)));
    } else if (nowSales !== null && nowSales > 0) {
      // No earnings to capitalise, so the anchor is what it sells.
      const g = priorSales !== null && priorSales > 0 ? nowSales / priorSales - 1 : 0;
      value = (nowSales / sharesNow) * targetEvSales(Math.max(-0.2, Math.min(0.6, g)));
    }

    if (value !== null && Number.isFinite(value) && value > 0) {
      out.push({ date: qs[i].periodEnd, value: Math.round(value * 100) / 100 });
    }
  }

  return out;
}


export type RelativeBand = {
  label: string;
  action: string;
  multipleLo: number;
  multipleHi: number;
};

export type RelativeBands = {
  bands: RelativeBand[];
  /** Current price as a multiple of the anchor. */
  now?: number;
  /** Percentile of that multiple within the asset's own history, 0-100. */
  percentile?: number;
  observations: number;
  median: number;
  summary: string;
};

/**
 * Zones drawn from how this asset has actually been priced, not from what the
 * fundamentals say it is worth.
 *
 * The fundamental band answers "is this cheap?" and for a structural grower in
 * an expensive market the answer is no, permanently — AMD has barely traded
 * below its own long trend in a decade, so an absolute zone never triggers and
 * a chart with no marks on it is not a判断, it is a non-answer.
 *
 * This measures the distribution of price divided by the contemporaneous
 * anchor across the asset's own history and cuts it at quantiles. If a name has
 * spent ten years between two and six times its earnings anchor, then two is
 * where it has been cheap *for that name*, and saying so is a statement about
 * observed history rather than a loosened standard.
 *
 * It is deliberately additional rather than a replacement. Presented alone it
 * would be circular: an asset that has always been expensive would have its
 * normal price relabelled as cheap, which endorses the market instead of
 * judging it. Both are shown, and where they disagree that disagreement is the
 * information.
 */
export function buildRelativeBands(
  anchors: AnchorPoint[],
  bars: { date: string; c: number }[]
): RelativeBands | null {
  if (anchors.length < 3 || bars.length < 200) return null;

  const sorted = [...anchors].sort((a, b) => a.date.localeCompare(b.date));
  let carried: number | undefined;
  let idx = 0;
  const ratios: number[] = [];

  for (const bar of bars) {
    while (idx < sorted.length && sorted[idx].date <= bar.date) {
      carried = sorted[idx].value;
      idx++;
    }
    if (carried && carried > 0 && bar.c > 0) ratios.push(bar.c / carried);
  }
  if (ratios.length < 150) return null;

  const asc = [...ratios].sort((a, b) => a - b);
  const q = (p: number) => asc[Math.min(asc.length - 1, Math.floor(asc.length * p))];
  const r2 = (n: number) => Math.round(n * 100) / 100;

  const edges: RelativeBand[] = [
    { label: "Cheapest it gets", action: "BUY_AGGRESSIVE", multipleLo: 0, multipleHi: r2(q(0.1)) },
    { label: "Cheap for this name", action: "BUY", multipleLo: r2(q(0.1)), multipleHi: r2(q(0.3)) },
    { label: "Normal range", action: "ACCUMULATE", multipleLo: r2(q(0.3)), multipleHi: r2(q(0.7)) },
    { label: "Rich for this name", action: "HOLD", multipleLo: r2(q(0.7)), multipleHi: r2(q(0.9)) },
    { label: "Dearest it gets", action: "TRIM", multipleLo: r2(q(0.9)), multipleHi: r2(q(0.99) * 1.15) },
  ].filter((b) => b.multipleHi > b.multipleLo);

  const now = ratios[ratios.length - 1];
  const percentile = Math.round((asc.filter((x) => x < now).length / asc.length) * 100);
  const median = r2(q(0.5));

  return {
    bands: edges,
    now: r2(now),
    percentile,
    observations: ratios.length,
    median,
    summary:
      `Over ${Math.round(ratios.length / 252)} years this has traded between ${r2(q(0.1))}x and ` +
      `${r2(q(0.9))}x its own anchor, and sits at ${r2(now)}x today — cheaper than ` +
      `${100 - percentile}% of its own history. That is where it is cheap for this name, which is ` +
      `a different question from whether it is cheap.`,
  };
}
