/**
 * Multi-pillar moat assessment.
 *
 * The previous version was four margin deltas, which conflates "is this a good
 * business" with "did margins move last quarter". A moat has a *level* (how
 * defensible is it now) and a *direction* (is it widening), and the evidence
 * for each differs by what kind of company this is — a bitcoin treasury has no
 * gross margin worth discussing, but it very much has a dilution-versus-
 * accretion question.
 *
 * Every pillar reports the numbers behind it so a claim can be checked in
 * seconds rather than taken on trust.
 */

import type { Archetype } from "./valuation";
import type { Quarter } from "./metrics";

export type Pillar = {
  key: string;
  label: string;
  /** 0..100 — how strong this dimension is right now. */
  level?: number;
  /** -100..100 — which way it is moving year over year. */
  trend?: number;
  evidence: string;
  weight: number;
};

export type Moat = {
  /** 0..100 overall defensibility. */
  score?: number;
  /** -100..100 overall direction. */
  direction?: number;
  pillars: Pillar[];
  summary: string;
  coverage: number;
};

const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));

/** Map a value onto 0..100 across [lo, hi]; lo > hi inverts. */
function lvl(v: number | undefined, lo: number, hi: number): number | undefined {
  if (v === undefined || !Number.isFinite(v)) return undefined;
  return clamp(((v - lo) / (hi - lo)) * 100);
}

/** Map a delta onto -100..100 across [lo, hi]. */
function dir(v: number | undefined, lo: number, hi: number): number | undefined {
  if (v === undefined || !Number.isFinite(v)) return undefined;
  return clamp(((v - lo) / (hi - lo)) * 200 - 100, -100, 100);
}

const sum = (xs: (number | undefined)[]): number | undefined => {
  const vals = xs.filter((x): x is number => typeof x === "number" && Number.isFinite(x));
  return vals.length === xs.length && vals.length > 0 ? vals.reduce((a, b) => a + b, 0) : undefined;
};

const ratio = (a?: number, b?: number) => (a !== undefined && b !== undefined && b !== 0 ? a / b : undefined);
const pct = (n?: number, dp = 1) => (n === undefined ? "n/a" : `${(n * 100).toFixed(dp)}%`);
const bn = (n?: number) => (n === undefined ? "n/a" : `$${(n / 1e9).toFixed(2)}B`);

export type MoatInput = {
  archetype: Archetype;
  quarters: Quarter[];
  grossMarginPct?: number;
  grossMarginDeltaYoY?: number;
  opMarginPct?: number;
  fcfMarginPct?: number;
  fcfTtm?: number;
  netIncomeTtm?: number;
  rndIntensityPct?: number;
  sharesYoY?: number;
  netDebtToEbitda?: number;
  netCash?: number;
  revYoY?: number;
};

export function assessMoat(i: MoatInput): Moat {
  const q = i.quarters.slice(0, 8);
  const cur = q.slice(0, 4);
  const prior = q.slice(4, 8);

  const revTtm = sum(cur.map((x) => x.revenue));
  const revPrior = sum(prior.map((x) => x.revenue));
  const opTtm = sum(cur.map((x) => x.opIncome));
  const opPrior = sum(prior.map((x) => x.opIncome));
  const equityNow = q[0]?.equity;
  const equityPrior = q[4]?.equity;
  const sharesNow = q[0]?.sharesDiluted;
  const sharesPrior = q[4]?.sharesDiluted;
  const assetsNow = q[0]?.totalAssets;
  const debtNow = q[0]?.totalDebt;

  const pillars: Pillar[] = [];

  if (i.archetype === "assetHolding") {
    // --- what actually decides a treasury company's fate -----------------
    const navPsNow = equityNow && sharesNow ? equityNow / sharesNow : undefined;
    const navPsPrior = equityPrior && sharesPrior ? equityPrior / sharesPrior : undefined;
    const navPsGrowth = navPsNow && navPsPrior && navPsPrior > 0 ? navPsNow / navPsPrior - 1 : undefined;

    pillars.push({
      key: "navAccretion",
      label: "NAV per share",
      level: lvl(navPsGrowth, -0.3, 0.6),
      trend: dir(navPsGrowth, -0.3, 0.6),
      evidence:
        navPsNow !== undefined
          ? `$${navPsNow.toFixed(2)}/share, ${navPsGrowth === undefined ? "no prior year" : `${navPsGrowth >= 0 ? "+" : ""}${pct(navPsGrowth)} YoY`}`
          : "book equity per share unavailable",
      weight: 0.35,
    });

    const shareGrowth = i.sharesYoY;
    const accretive =
      navPsGrowth !== undefined && shareGrowth !== undefined ? navPsGrowth : undefined;
    pillars.push({
      key: "dilution",
      label: "Issuance discipline",
      level: lvl(shareGrowth === undefined ? undefined : -shareGrowth, -0.6, 0.05),
      trend: dir(accretive, -0.2, 0.3),
      evidence:
        shareGrowth === undefined
          ? "share count unavailable"
          : `share count ${shareGrowth >= 0 ? "+" : ""}${pct(shareGrowth)} YoY` +
            (navPsGrowth !== undefined
              ? ` while NAV/share ${navPsGrowth >= 0 ? "grew" : "fell"} ${pct(Math.abs(navPsGrowth))} — issuance is ${navPsGrowth > 0 ? "accretive" : "dilutive"}`
              : ""),
      weight: 0.3,
    });

    const leverage = assetsNow && debtNow !== undefined ? debtNow / assetsNow : undefined;
    pillars.push({
      key: "leverage",
      label: "Balance sheet risk",
      level: lvl(leverage === undefined ? undefined : -leverage, -0.6, -0.02),
      evidence:
        leverage === undefined
          ? "debt or assets unavailable"
          : `debt ${bn(debtNow)} against ${bn(assetsNow)} assets (${pct(leverage, 0)} of assets)`,
      weight: 0.25,
    });

    // When revenue is a rounding error against the asset base, the operating
    // margin is a meaningless ratio (it can read -7000%) and quoting it makes
    // the panel look broken rather than informative.
    const immaterial = revTtm !== undefined && assetsNow ? revTtm / assetsNow < 0.05 : false;
    pillars.push({
      key: "operating",
      label: "Operating business",
      level: immaterial ? undefined : lvl(i.opMarginPct, -0.4, 0.3),
      evidence:
        revTtm === undefined
          ? "no operating revenue"
          : immaterial
            ? `${bn(revTtm)} revenue against ${bn(assetsNow)} of assets — immaterial to the valuation`
            : `${bn(revTtm)} revenue, operating margin ${pct(i.opMarginPct)}`,
      weight: 0.1,
    });
  } else {
    // --- operating businesses -------------------------------------------
    pillars.push({
      key: "pricingPower",
      label: "Pricing power",
      level: lvl(i.grossMarginPct, 0.1, 0.75),
      trend: dir(i.grossMarginDeltaYoY, -300, 300),
      evidence: `gross margin ${pct(i.grossMarginPct)}${
        i.grossMarginDeltaYoY !== undefined
          ? `, ${i.grossMarginDeltaYoY >= 0 ? "+" : ""}${Math.round(i.grossMarginDeltaYoY)}bps YoY`
          : ""
      }`,
      weight: 0.22,
    });

    // Operating leverage: costs should grow slower than revenue.
    const opMarginPrior = ratio(opPrior, revPrior);
    const opDelta =
      i.opMarginPct !== undefined && opMarginPrior !== undefined
        ? (i.opMarginPct - opMarginPrior) * 10000
        : undefined;
    pillars.push({
      key: "operatingLeverage",
      label: "Operating leverage",
      level: lvl(i.opMarginPct, -0.1, 0.45),
      trend: dir(opDelta, -400, 400),
      evidence: `operating margin ${pct(i.opMarginPct)}${
        opDelta !== undefined ? `, ${opDelta >= 0 ? "+" : ""}${Math.round(opDelta)}bps YoY` : ""
      }`,
      weight: 0.18,
    });

    // Return on capital — the clearest single read on whether a business has
    // something others cannot easily copy.
    const investedCapital =
      equityNow !== undefined && debtNow !== undefined ? equityNow + debtNow : undefined;
    const roic = investedCapital && investedCapital > 0 && opTtm !== undefined ? (opTtm * 0.79) / investedCapital : undefined;
    const investedPrior =
      equityPrior !== undefined && q[4]?.totalDebt !== undefined ? equityPrior + (q[4]?.totalDebt as number) : undefined;
    const roicPrior = investedPrior && investedPrior > 0 && opPrior !== undefined ? (opPrior * 0.79) / investedPrior : undefined;
    pillars.push({
      key: "returnOnCapital",
      label: "Return on capital",
      level: lvl(roic, 0, 0.35),
      trend: dir(roic !== undefined && roicPrior !== undefined ? (roic - roicPrior) * 10000 : undefined, -500, 500),
      evidence:
        roic === undefined
          ? "invested capital unavailable"
          : `ROIC ${pct(roic)} on ${bn(investedCapital)} invested capital` +
            (roicPrior !== undefined ? `, was ${pct(roicPrior)}` : ""),
      weight: 0.2,
    });

    const fcfConversion = ratio(i.fcfTtm, i.netIncomeTtm);
    pillars.push({
      key: "cashConversion",
      label: "Cash conversion",
      level: lvl(i.fcfMarginPct, -0.1, 0.35),
      evidence:
        `FCF margin ${pct(i.fcfMarginPct)}` +
        (fcfConversion !== undefined
          ? `, ${(fcfConversion * 100).toFixed(0)}% of net income turns into cash`
          : ""),
      weight: 0.15,
    });

    // Revenue stability — a moat shows up as customers who do not leave.
    const yoys: number[] = [];
    for (let k = 0; k < 4; k++) {
      const now = q[k]?.revenue;
      const then = q[k + 4]?.revenue;
      if (now !== undefined && then !== undefined && then > 0) yoys.push(now / then - 1);
    }
    const volatility =
      yoys.length >= 3
        ? Math.sqrt(yoys.reduce((s, v) => s + (v - yoys.reduce((a, b) => a + b, 0) / yoys.length) ** 2, 0) / (yoys.length - 1))
        : undefined;
    pillars.push({
      key: "durability",
      label: "Revenue durability",
      level: lvl(volatility === undefined ? undefined : -volatility, -0.35, -0.02),
      evidence:
        volatility === undefined
          ? "needs eight quarters"
          : `growth swings ±${pct(volatility)} across the last four quarters`,
      weight: 0.12,
    });

    pillars.push({
      key: "reinvestment",
      label: "Reinvestment",
      level: lvl(i.rndIntensityPct, 0, 0.2),
      evidence:
        i.rndIntensityPct === undefined
          ? "no R&D line reported"
          : `R&D ${pct(i.rndIntensityPct)} of revenue`,
      weight: 0.08,
    });

    pillars.push({
      key: "alignment",
      label: "Shareholder alignment",
      level: lvl(i.sharesYoY === undefined ? undefined : -i.sharesYoY, -0.12, 0.03),
      trend: dir(i.sharesYoY === undefined ? undefined : -i.sharesYoY, -0.12, 0.03),
      evidence:
        i.sharesYoY === undefined
          ? "share count unavailable"
          : `share count ${i.sharesYoY >= 0 ? "+" : ""}${pct(i.sharesYoY)} YoY${
              i.sharesYoY < -0.005 ? " — net buyback" : i.sharesYoY > 0.03 ? " — funded by issuance" : ""
            }`,
      weight: 0.05,
    });
  }

  const withLevel = pillars.filter((p) => p.level !== undefined);
  const withTrend = pillars.filter((p) => p.trend !== undefined);
  const lw = withLevel.reduce((s, p) => s + p.weight, 0);
  const tw = withTrend.reduce((s, p) => s + p.weight, 0);

  const score = lw > 0 ? Math.round(withLevel.reduce((s, p) => s + (p.level as number) * p.weight, 0) / lw) : undefined;
  const direction = tw > 0 ? Math.round(withTrend.reduce((s, p) => s + (p.trend as number) * p.weight, 0) / tw) : undefined;

  const strongest = [...withLevel].sort((a, b) => (b.level as number) - (a.level as number))[0];
  const weakest = [...withLevel].sort((a, b) => (a.level as number) - (b.level as number))[0];

  const summary =
    score === undefined
      ? "Not enough filed data to assess."
      : `${score >= 70 ? "Strong" : score >= 50 ? "Moderate" : score >= 30 ? "Thin" : "Weak"} moat` +
        (direction !== undefined
          ? `, ${direction >= 15 ? "widening" : direction <= -15 ? "narrowing" : "stable"}`
          : "") +
        (strongest && weakest && strongest.key !== weakest.key
          ? `. Strongest: ${strongest.label.toLowerCase()}. Weakest: ${weakest.label.toLowerCase()}.`
          : ".");

  return {
    score,
    direction,
    pillars,
    summary,
    coverage: Math.round((withLevel.length / pillars.length) * 100),
  };
}
