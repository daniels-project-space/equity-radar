/**
 * Derive the metric set from raw quarterly fundamentals + price stats.
 * Pure functions — same code runs in Convex and in the browser.
 */

export type Quarter = {
  fiscalPeriod: string;
  periodEnd: string;
  revenue?: number;
  grossProfit?: number;
  opIncome?: number;
  netIncome?: number;
  epsDiluted?: number;
  adjEps?: number;
  operatingCashFlow?: number;
  capex?: number;
  cash?: number;
  totalDebt?: number;
  sharesDiluted?: number;
  rnd?: number;
  totalAssets?: number;
  totalLiabilities?: number;
  equity?: number;
  cryptoFairValue?: number;
  longTermInvestments?: number;
  interestExpense?: number;
  depreciationAmortization?: number;
};

export type DerivedMetrics = {
  revenueTtm?: number;
  revYoY?: number;
  revYoYPrior?: number;
  revAccel?: number;
  epsTtm?: number;
  epsYoY?: number;
  grossMarginPct?: number;
  grossMarginDeltaYoY?: number;
  opMarginPct?: number;
  netMarginPct?: number;
  fcfTtm?: number;
  fcfMarginPct?: number;
  rndIntensityPct?: number;
  sharesYoY?: number;
  netCash?: number;
  netDebtToEbitda?: number;
  marketCap?: number;
  peTtm?: number;
  evToSales?: number;
  pToFcf?: number;
  fwdEps?: number;
  fwdPe?: number;
  /** Where fwdEps came from — these are not interchangeable and the UI says which. */
  fwdEpsBasis?: "consensus" | "modelled";
  modelledNtmEps?: number;
  isGaapLoss?: boolean;
  moatTrend?: number;
  moatDrivers?: { label: string; delta: number; unit: string }[];
  quartersAvailable: number;
  latestPeriodEnd?: string;
};

const sum = (xs: (number | undefined)[]): number | undefined => {
  const vals = xs.filter((x): x is number => typeof x === "number" && Number.isFinite(x));
  return vals.length === xs.length && vals.length > 0 ? vals.reduce((a, b) => a + b, 0) : undefined;
};

const ratio = (a?: number, b?: number): number | undefined =>
  a !== undefined && b !== undefined && b !== 0 ? a / b : undefined;

const growth = (now?: number, prior?: number): number | undefined => {
  if (now === undefined || prior === undefined) return undefined;
  // A sign flip makes percentage growth meaningless (e.g. -0.16 -> +0.17 EPS).
  if (prior === 0 || prior < 0) return undefined;
  return now / prior - 1;
};

const median = (values: number[]): number | undefined => {
  const xs = values.filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (xs.length === 0) return undefined;
  const mid = Math.floor(xs.length / 2);
  return xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
};

/**
 * Next-twelve-month EPS modelled from filed results.
 *
 * Consensus estimates are proprietary — there is no free keyless source — but
 * anchoring buy zones on trailing EPS alone badly misprices anything growing
 * fast (AMD reads 121x trailing against roughly 30x on 2027 numbers). So we
 * project instead, from data we already have and can show our working for.
 *
 * The median of the last four quarterly YoY EPS growth rates resists one-off
 * quarters; it is then capped and damped toward the mean, because trailing
 * growth persisting in full is the exception, not the rule. This is explicitly
 * NOT a consensus figure and the UI labels it as modelled.
 */
function modelNtmEps(quarters: Quarter[], epsTtm?: number): number | undefined {
  if (epsTtm === undefined || epsTtm <= 0) return undefined;
  const yoys: number[] = [];
  for (let i = 0; i < 4; i++) {
    const now = quarters[i]?.epsDiluted;
    const prior = quarters[i + 4]?.epsDiluted;
    if (now === undefined || prior === undefined || prior <= 0) continue;
    yoys.push(now / prior - 1);
  }
  const blended = median(yoys);
  if (blended === undefined) return undefined;
  const capped = Math.max(-0.3, Math.min(0.6, blended));
  return epsTtm * (1 + capped * 0.6);
}

/**
 * @param quarters most-recent-first, at least 4 for TTM, 8 for YoY.
 * @param price latest close
 * @param consensusEps consensus FY+1 EPS, only present if a provider key is set
 */
export function deriveMetrics(
  quarters: Quarter[],
  price?: number,
  consensusEps?: number
): DerivedMetrics {
  const q = quarters.slice(0, 8);
  const cur = q.slice(0, 4);
  const prior = q.slice(4, 8);
  const latest = q[0];

  const revenueTtm = sum(cur.map((x) => x.revenue));
  const revenuePriorTtm = prior.length === 4 ? sum(prior.map((x) => x.revenue)) : undefined;
  const grossTtm = sum(cur.map((x) => x.grossProfit));
  const grossPriorTtm = prior.length === 4 ? sum(prior.map((x) => x.grossProfit)) : undefined;
  const opTtm = sum(cur.map((x) => x.opIncome));
  const netTtm = sum(cur.map((x) => x.netIncome));
  const rndTtm = sum(cur.map((x) => x.rnd));

  // Prefer adjusted EPS when we have it for all four quarters, else GAAP.
  const adjTtm = sum(cur.map((x) => x.adjEps));
  const gaapEpsTtm = sum(cur.map((x) => x.epsDiluted));
  const epsTtm = adjTtm ?? gaapEpsTtm;
  const adjPriorTtm = prior.length === 4 ? sum(prior.map((x) => x.adjEps)) : undefined;
  const gaapEpsPriorTtm = prior.length === 4 ? sum(prior.map((x) => x.epsDiluted)) : undefined;
  const epsPriorTtm = adjTtm !== undefined ? adjPriorTtm : gaapEpsPriorTtm;

  const ocfTtm = sum(cur.map((x) => x.operatingCashFlow));
  const capexTtm = sum(cur.map((x) => x.capex));
  const fcfTtm =
    ocfTtm !== undefined && capexTtm !== undefined ? ocfTtm - Math.abs(capexTtm) : undefined;

  // Quarterly YoY (q0 vs q4, q1 vs q5) gives a truer acceleration read than
  // TTM-over-TTM, which smooths away exactly the inflection we care about.
  const revYoY = growth(q[0]?.revenue, q[4]?.revenue);
  const revYoYPrior = growth(q[1]?.revenue, q[5]?.revenue);
  const revAccel =
    revYoY !== undefined && revYoYPrior !== undefined ? (revYoY - revYoYPrior) * 100 : undefined;

  const grossMarginPct = ratio(grossTtm, revenueTtm);
  const grossMarginPriorPct = ratio(grossPriorTtm, revenuePriorTtm);
  const grossMarginDeltaYoY =
    grossMarginPct !== undefined && grossMarginPriorPct !== undefined
      ? (grossMarginPct - grossMarginPriorPct) * 10000
      : undefined;

  const cash = latest?.cash;
  const debt = latest?.totalDebt;
  const shares = latest?.sharesDiluted;
  const netCash = cash !== undefined && debt !== undefined ? cash - debt : undefined;
  const netDebt = netCash !== undefined ? -netCash : undefined;
  const ebitdaProxy = opTtm; // no reliable D&A in companyfacts; op income is the honest proxy
  const netDebtToEbitda =
    netDebt !== undefined && ebitdaProxy !== undefined && ebitdaProxy > 0
      ? netDebt / ebitdaProxy
      : undefined;

  const marketCap = price !== undefined && shares !== undefined ? price * shares : undefined;
  const ev =
    marketCap !== undefined && debt !== undefined && cash !== undefined
      ? marketCap + debt - cash
      : undefined;

  const modelledNtmEps = modelNtmEps(q, epsTtm);
  const fwdEps = consensusEps ?? modelledNtmEps;

  // ---- moat direction -------------------------------------------------
  // Is the competitive position getting better or worse? Pricing power shows
  // up in gross margin, operating leverage in operating margin, and cash
  // conversion in FCF — while dilution quietly transfers the business away
  // from existing holders. All four are YoY so they are seasonally clean.
  const opPriorTtm = prior.length === 4 ? sum(prior.map((x) => x.opIncome)) : undefined;
  const ocfPriorTtm = prior.length === 4 ? sum(prior.map((x) => x.operatingCashFlow)) : undefined;
  const capexPriorTtm = prior.length === 4 ? sum(prior.map((x) => x.capex)) : undefined;
  const fcfPriorTtm =
    ocfPriorTtm !== undefined && capexPriorTtm !== undefined
      ? ocfPriorTtm - Math.abs(capexPriorTtm)
      : undefined;

  const deltaBps = (nowVal?: number, priorVal?: number, nowBase?: number, priorBase?: number) => {
    const a = ratio(nowVal, nowBase);
    const b = ratio(priorVal, priorBase);
    return a !== undefined && b !== undefined ? (a - b) * 10000 : undefined;
  };

  const gmBps = grossMarginDeltaYoY;
  const opBps = deltaBps(opTtm, opPriorTtm, revenueTtm, revenuePriorTtm);
  const fcfBps = deltaBps(fcfTtm, fcfPriorTtm, revenueTtm, revenuePriorTtm);
  const dilution = growth(q[0]?.sharesDiluted, q[4]?.sharesDiluted);

  const scale = (value: number | undefined, lo: number, hi: number) =>
    value === undefined ? undefined : Math.max(-100, Math.min(100, ((value - lo) / (hi - lo)) * 200 - 100));

  const parts: { w: number; v: number | undefined }[] = [
    { w: 0.35, v: scale(gmBps, -300, 300) },
    { w: 0.2, v: scale(opBps, -400, 400) },
    { w: 0.25, v: scale(fcfBps, -500, 500) },
    { w: 0.2, v: scale(dilution === undefined ? undefined : -dilution, -0.08, 0.02) },
  ];
  const present = parts.filter((p) => p.v !== undefined);
  const moatTrend =
    present.length === 0
      ? undefined
      : Math.round(
          present.reduce((s, p) => s + (p.v as number) * p.w, 0) /
            present.reduce((s, p) => s + p.w, 0)
        );

  const moatDrivers = [
    gmBps !== undefined ? { label: "Gross margin", delta: Math.round(gmBps), unit: "bps" } : null,
    opBps !== undefined ? { label: "Operating margin", delta: Math.round(opBps), unit: "bps" } : null,
    fcfBps !== undefined ? { label: "FCF margin", delta: Math.round(fcfBps), unit: "bps" } : null,
    dilution !== undefined
      ? { label: "Share count", delta: Math.round(dilution * 1000) / 10, unit: "%" }
      : null,
  ].filter((x): x is { label: string; delta: number; unit: string } => x !== null);

  return {
    revenueTtm,
    revYoY,
    revYoYPrior,
    revAccel,
    epsTtm,
    epsYoY: growth(epsTtm, epsPriorTtm),
    grossMarginPct,
    grossMarginDeltaYoY,
    opMarginPct: ratio(opTtm, revenueTtm),
    netMarginPct: ratio(netTtm, revenueTtm),
    fcfTtm,
    fcfMarginPct: ratio(fcfTtm, revenueTtm),
    rndIntensityPct: ratio(rndTtm, revenueTtm),
    sharesYoY: growth(q[0]?.sharesDiluted, q[4]?.sharesDiluted),
    netCash,
    netDebtToEbitda,
    marketCap,
    peTtm: price !== undefined && epsTtm !== undefined && epsTtm > 0 ? price / epsTtm : undefined,
    evToSales: ratio(ev, revenueTtm),
    pToFcf: marketCap !== undefined && fcfTtm !== undefined && fcfTtm > 0 ? marketCap / fcfTtm : undefined,
    fwdEps,
    fwdPe: price !== undefined && fwdEps !== undefined && fwdEps > 0 ? price / fwdEps : undefined,
    fwdEpsBasis: fwdEps === undefined ? undefined : consensusEps !== undefined ? "consensus" : "modelled",
    modelledNtmEps,
    isGaapLoss: netTtm !== undefined ? netTtm < 0 : undefined,
    moatTrend,
    moatDrivers,
    quartersAvailable: q.length,
    latestPeriodEnd: latest?.periodEnd,
  };
}

/** 52w stats + trailing returns from a daily close series (oldest first). */
export function derivePriceStats(bars: { date: string; c: number; v: number }[]) {
  if (bars.length === 0) return null;
  const last = bars[bars.length - 1];
  const window = bars.slice(-252);
  const closes = window.map((b) => b.c);
  const wk52High = Math.max(...closes);
  const wk52Low = Math.min(...closes);
  const at = (n: number) => bars[Math.max(0, bars.length - 1 - n)]?.c;
  const ret = (n: number) => {
    const base = at(n);
    return base && base > 0 ? last.c / base - 1 : undefined;
  };
  const advUsd =
    window.slice(-30).reduce((s, b) => s + b.c * b.v, 0) / Math.min(30, window.length) || undefined;

  return {
    last: last.c,
    prevClose: bars[bars.length - 2]?.c,
    spark30: bars.slice(-30).map((b) => Math.round(b.c * 100) / 100),
    wk52High,
    wk52Low,
    drawdownFromHigh: wk52High > 0 ? 1 - last.c / wk52High : 0,
    ret1m: ret(21),
    ret3m: ret(63),
    ret12m: ret(252),
    advUsd,
  };
}
