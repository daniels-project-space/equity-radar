/**
 * Fundamental quality, from the three measures with the strongest published
 * record in the cross section of returns.
 *
 * These are here because they are among the few things in this project that
 * arrived with real evidence attached rather than as a plausible idea:
 *
 *   - GROSS PROFITABILITY, (revenue − cost of goods sold) / total assets.
 *     Novy-Marx (JFE 2013) found it has roughly the same power as book-to-market
 *     for predicting returns, with a three-factor alpha of 52bp/month (t=4.49).
 *     Later work (NBER w33601, 2025) argues profitability subsumes the whole
 *     "quality" space — including quality-minus-junk and the F-score itself —
 *     which is why it is treated as the headline measure here.
 *
 *   - PIOTROSKI F-SCORE, nine binary fundamental checks. Its three-factor alpha
 *     of 60bp/month (t=7.48) is among the strongest of any documented anomaly.
 *     Its power comes largely from small, under-covered, distressed firms, so it
 *     is reported rather than weighted heavily for large caps.
 *
 *   - ACCRUALS, (net income − operating cash flow) / total assets. Sloan (1996):
 *     earnings driven by accrual adjustments rather than cash predict weaker
 *     subsequent returns. It is the one measure here that is best read as a red
 *     flag rather than a score.
 *
 * Only one of the nine F-score signals is unavailable — the current ratio needs
 * current assets and liabilities, which are not reliably tagged in the filings
 * this project reads — so the score is out of eight and labelled as such rather
 * than quietly rescaled to look like the published nine.
 */

export type QualityQuarter = {
  periodEnd: string;
  revenue?: number;
  grossProfit?: number;
  netIncome?: number;
  operatingCashFlow?: number;
  totalAssets?: number;
  totalDebt?: number;
  sharesDiluted?: number;
};

export type Quality = {
  /** Novy-Marx gross profits-to-assets, annualised. */
  grossProfitability?: number;
  /** Sloan accruals as a share of assets. Negative is good. */
  accruals?: number;
  /** Piotroski signals passed, out of those computable. */
  fScore?: number;
  fScoreMax: number;
  /** Which checks passed and failed, for display. */
  signals: { key: string; label: string; pass: boolean }[];
  summary: string;
};

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

/** TTM total of a field over four quarters starting at `i` (newest-first). */
function ttm(qs: QualityQuarter[], i: number, f: keyof QualityQuarter): number | undefined {
  const slice = qs.slice(i, i + 4);
  if (slice.length < 4) return undefined;
  const vals = slice.map((q) => q[f]).filter((v): v is number => typeof v === "number");
  if (vals.length < 4) return undefined;
  return sum(vals);
}

const pct = (n: number) => `${Math.round(n * 1000) / 10}%`;

/** @param quarters newest first. */
export function readQuality(quarters: QualityQuarter[]): Quality | null {
  const qs = quarters.filter((q) => q.periodEnd);
  if (qs.length < 8) return null;

  // Balance-sheet items are point-in-time; flows are trailing twelve months.
  const assetsNow = qs[0]?.totalAssets;
  const assetsPrior = qs[4]?.totalAssets;

  const gpNow = ttm(qs, 0, "grossProfit");
  const revNow = ttm(qs, 0, "revenue");
  const revPrior = ttm(qs, 4, "revenue");
  const niNow = ttm(qs, 0, "netIncome");
  const niPrior = ttm(qs, 4, "netIncome");
  const cfoNow = ttm(qs, 0, "operatingCashFlow");

  const gpNowPrior = ttm(qs, 4, "grossProfit");

  const grossProfitability =
    gpNow !== undefined && assetsNow && assetsNow > 0 ? gpNow / assetsNow : undefined;

  const roaNow = niNow !== undefined && assetsNow && assetsNow > 0 ? niNow / assetsNow : undefined;
  const roaPrior =
    niPrior !== undefined && assetsPrior && assetsPrior > 0 ? niPrior / assetsPrior : undefined;

  const accruals =
    niNow !== undefined && cfoNow !== undefined && assetsNow && assetsNow > 0
      ? (niNow - cfoNow) / assetsNow
      : undefined;

  const signals: { key: string; label: string; pass: boolean }[] = [];
  const add = (key: string, label: string, pass: boolean | undefined) => {
    if (pass !== undefined) signals.push({ key, label, pass });
  };

  add("roa", "Profitable on assets", roaNow === undefined ? undefined : roaNow > 0);
  add("cfo", "Generating operating cash", cfoNow === undefined ? undefined : cfoNow > 0);
  add(
    "roaUp",
    "Return on assets improving",
    roaNow === undefined || roaPrior === undefined ? undefined : roaNow > roaPrior
  );
  add(
    "quality",
    "Earnings backed by cash, not accruals",
    cfoNow === undefined || niNow === undefined ? undefined : cfoNow > niNow
  );

  // Leverage: falling debt-to-assets is the good signal.
  const levNow =
    qs[0]?.totalDebt !== undefined && assetsNow && assetsNow > 0
      ? qs[0].totalDebt / assetsNow
      : undefined;
  const levPrior =
    qs[4]?.totalDebt !== undefined && assetsPrior && assetsPrior > 0
      ? qs[4].totalDebt / assetsPrior
      : undefined;
  add(
    "leverage",
    "Leverage not rising",
    levNow === undefined || levPrior === undefined ? undefined : levNow <= levPrior
  );

  // Share count: issuing stock is the bad signal.
  const shNow = qs[0]?.sharesDiluted;
  const shPrior = qs[4]?.sharesDiluted;
  add(
    "issuance",
    "No meaningful share issuance",
    shNow === undefined || shPrior === undefined || shPrior <= 0
      ? undefined
      : shNow / shPrior <= 1.02
  );

  // Gross margin direction.
  const gmNow = gpNow !== undefined && revNow ? gpNow / revNow : undefined;
  const gmPrior = gpNowPrior !== undefined && revPrior ? gpNowPrior / revPrior : undefined;
  add(
    "margin",
    "Gross margin improving",
    gmNow === undefined || gmPrior === undefined ? undefined : gmNow > gmPrior
  );

  // Asset turnover direction.
  const atNow = revNow !== undefined && assetsNow && assetsNow > 0 ? revNow / assetsNow : undefined;
  const atPrior =
    revPrior !== undefined && assetsPrior && assetsPrior > 0 ? revPrior / assetsPrior : undefined;
  add(
    "turnover",
    "Getting more revenue per dollar of assets",
    atNow === undefined || atPrior === undefined ? undefined : atNow > atPrior
  );

  if (signals.length === 0) return null;
  const fScore = signals.filter((s) => s.pass).length;

  const bits: string[] = [`${fScore} of ${signals.length} fundamental checks pass`];
  if (grossProfitability !== undefined) {
    bits.push(
      `gross profit is ${pct(grossProfitability)} of assets` +
        (grossProfitability >= 0.33
          ? " — strong on the measure with the best record of predicting returns"
          : grossProfitability < 0.15
            ? " — weak by that same measure"
            : "")
    );
  }
  if (accruals !== undefined && accruals > 0.05) {
    bits.push(
      `earnings run ${pct(accruals)} of assets ahead of cash flow, which has historically been a warning sign`
    );
  }

  return {
    grossProfitability,
    accruals,
    fScore,
    fScoreMax: signals.length,
    signals,
    summary: bits.join("; ") + ".",
  };
}
