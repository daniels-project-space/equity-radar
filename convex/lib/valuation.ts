/**
 * Archetype-aware valuation.
 *
 * A single earnings multiple cannot value every company. A bitcoin treasury,
 * a bank, a REIT and a pre-profit hardware company each have a different thing
 * that generates value, and applying P/E to all of them produces confident
 * nonsense — Strategy (MSTR) scored 15/100 AVOID on margins while sitting on
 * $50B of marked-to-market bitcoin.
 *
 * So: classify the company, value it with several independent methods, weight
 * those methods by archetype, and let the *disagreement between them* set how
 * much margin of safety to demand. Wide dispersion means we know less, which
 * should widen the buy zone rather than be hidden behind a single number.
 */

import { justifiedValue } from "./expectations";

export type Archetype = "assetHolding" | "financial" | "reit" | "preProfit" | "earnings";

export const ARCHETYPE_LABEL: Record<Archetype, string> = {
  assetHolding: "Asset holding",
  financial: "Financial",
  reit: "REIT",
  preProfit: "Pre-profit growth",
  earnings: "Earnings compounder",
};

export type ValuationInput = {
  price?: number;
  sicCode?: string;
  sharesDiluted?: number;
  epsTtm?: number;
  fwdEps?: number;
  revenueTtm?: number;
  opIncomeTtm?: number;
  fcfTtm?: number;
  netCash?: number;
  totalAssets?: number;
  totalLiabilities?: number;
  equity?: number;
  cryptoFairValue?: number;
  longTermInvestments?: number;
  peerMedianFwdPe?: number;
  peerMedianEvToSales?: number;
  /** Growth and margin drive what multiple is *deserved*, not just observed. */
  revGrowth?: number;
  revGrowthPrior?: number;
  guidedGrowth?: number;
  grossMarginPct?: number;
  /** Feeds the cash-flow method: caps justified growth and sets the horizon. */
  moatScore?: number;
  netDebtToEbitda?: number;
  /** Multi-year per-share growth and its confidence, from filed quarters. */
  trajectoryGrowth?: number;
  trajectoryConfidence?: number;
  /** Annualised realised volatility of the stock, as a fraction. */
  realisedVol?: number;
  /** Median P/E this company has actually traded at over its own history. */
  ownMedianPe?: number;
  ownPeSamples?: number;
  /** User anchor. Its meaning depends on archetype — P/E, EV/S or NAV premium. */
  anchorOverride?: number;
  /** How demanding the price already is; widens the margin of safety. */
  expectationsVerdict?: string;
};

export type Method = {
  key: string;
  label: string;
  perShare: number;
  weight: number;
  basis: string;
};

export type Band = {
  label: string;
  action: string;
  priceLo: number;
  priceHi: number;
  multipleLo: number;
  multipleHi: number;
};

export type Valuation = {
  archetype: Archetype;
  archetypeReason: string;
  anchor: number;
  anchorLabel: string;
  methods: Method[];
  fairValue: number;
  dispersion: number;
  marginOfSafety: number;
  confidence: "high" | "medium" | "low";
  bands: Band[];
  currentBand?: string;
  upside?: number;
};

export const ABOVE_RANGE = "Above range";
export const BELOW_RANGE = "Below range";

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const r2 = (n: number) => Math.round(n * 100) / 100;

export function median(values: number[]): number | undefined {
  const xs = values.filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (xs.length === 0) return undefined;
  const mid = Math.floor(xs.length / 2);
  return xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
}

/* ------------------------------------------------------------------ */
/* Classification                                                      */
/* ------------------------------------------------------------------ */

const sicIn = (sic: string | undefined, lo: number, hi: number) => {
  const n = Number(sic);
  return Number.isFinite(n) && n >= lo && n <= hi;
};

export function classify(i: ValuationInput): { archetype: Archetype; reason: string } {
  const assetish = (i.cryptoFairValue ?? 0) + (i.longTermInvestments ?? 0);
  const assetShare = i.totalAssets && i.totalAssets > 0 ? assetish / i.totalAssets : 0;

  if (assetShare >= 0.4) {
    return {
      archetype: "assetHolding",
      reason: `${Math.round(assetShare * 100)}% of assets are marketable holdings, not operating assets`,
    };
  }
  if (sicIn(i.sicCode, 6798, 6798)) {
    return { archetype: "reit", reason: "REIT (SIC 6798)" };
  }
  if (sicIn(i.sicCode, 6000, 6499)) {
    return { archetype: "financial", reason: `financial institution (SIC ${i.sicCode})` };
  }
  if ((i.epsTtm ?? 0) <= 0) {
    return { archetype: "preProfit", reason: "no positive trailing earnings to capitalise" };
  }
  return { archetype: "earnings", reason: "operating business with positive earnings" };
}

/** Method weights by archetype. Only methods that compute get a share. */
const WEIGHTS: Record<Archetype, Record<string, number>> = {
  assetHolding: { nav: 0.75, bookValue: 0.15, evSales: 0.1 },
  financial: { bookValue: 0.5, epsMultiple: 0.5 },
  reit: { fcfYield: 0.6, bookValue: 0.4 },
  preProfit: { evSales: 0.7, bookValue: 0.3 },
  // expectationsDcf carries real weight because it is the only method here that
  // is not a multiple. Every other one anchors on a trailing ratio, so in a
  // market where multiples have re-rated upward they all say "expensive"
  // together and the blend has no way to tell a compounder from a melting ice
  // cube. The cash-flow model disagrees with them when growth justifies it.
  earnings: {
    epsMultiple: 0.24,
    expectationsDcf: 0.25,
    ownHistory: 0.2,
    evEbit: 0.16,
    fcfYield: 0.1,
    evSales: 0.05,
  },
};

/**
 * Target multiples, adjusted for what the business actually is.
 *
 * A flat "15x EBIT, 5% FCF yield, 3x sales" prior marks every growing company
 * as massively overvalued, which gives no discrimination at all — the first
 * version of this scored eleven of thirteen names at 60-90% overvalued.
 * Growth and gross margin are what justify a higher multiple, so they set it,
 * within bounds that stop a single hot quarter from implying any price.
 */
function targets(i: ValuationInput) {
  const g = clamp(i.revGrowth ?? 0.05, -0.2, 0.6); // growth, capped both ways
  const gm = clamp(i.grossMarginPct ?? 0.4, 0.05, 0.9);

  return {
    // Roughly PEG-anchored: ~15x for a no-growth business, ~45x at 40% growth.
    pe: clamp(14 + g * 75, 10, 45),
    evEbit: clamp(10 + g * 50, 8, 35),
    // Faster growth justifies accepting a lower current cash yield.
    fcfYield: clamp(0.075 - g * 0.08, 0.025, 0.085),
    // Sales multiples scale with both growth and how much of a sale is profit.
    evSales: clamp((gm / 0.5) * (1 + g * 6), 0.5, 15),
    pb: 2.5,
    pbFinancial: 1.2,
    navPremium: 1.2,
  };
}

export { classify as classifyArchetype };

export function valuate(i: ValuationInput): Valuation | null {
  const shares = i.sharesDiluted;
  if (!shares || shares <= 0) return null;

  const { archetype, reason } = classify(i);
  const netCash = i.netCash ?? 0;
  const DEFAULTS = targets(i);

  // The anchor is the one number the user can override, and what it *means*
  // changes with archetype — a P/E for an operating business, a premium to
  // net asset value for a holding company.
  let anchor: number;
  let anchorLabel: string;
  if (archetype === "assetHolding") {
    anchor = clamp(i.anchorOverride ?? DEFAULTS.navPremium, 0.5, 4);
    anchorLabel = `${r2(anchor)}x NAV`;
  } else if (archetype === "preProfit") {
    anchor = clamp(
      i.anchorOverride ?? (i.peerMedianEvToSales && i.peerMedianEvToSales > 0.3 ? i.peerMedianEvToSales : DEFAULTS.evSales),
      1,
      8
    );
    anchorLabel = `${r2(anchor)}x sales`;
  } else if (archetype === "financial" || archetype === "reit") {
    anchor = clamp(i.anchorOverride ?? DEFAULTS.pbFinancial, 0.4, 4);
    anchorLabel = `${r2(anchor)}x book`;
  } else {
    // Blend the peer median with what this company's own growth and margin
    // deserve. Peers alone import their distortions; the model alone ignores
    // what the market pays for this industry. Averaging is more robust than
    // either, and stops peer pessimism compounding with GAAP-understated EPS.
    const peer =
      i.peerMedianFwdPe && i.peerMedianFwdPe > 5 && i.peerMedianFwdPe < 60 ? i.peerMedianFwdPe : undefined;
    const blended = peer !== undefined ? (peer + DEFAULTS.pe) / 2 : DEFAULTS.pe;
    anchor = clamp(i.anchorOverride ?? blended, 8, 45);
    anchorLabel = `${r2(anchor)}x earnings`;
  }

  // Round once, here, so every derived label reads cleanly instead of leaking
  // a full float into the UI.
  anchor = r2(anchor);

  const methods: Method[] = [];
  const add = (key: string, label: string, perShare: number | undefined, basis: string) => {
    const w = WEIGHTS[archetype][key];
    if (!w || perShare === undefined || !Number.isFinite(perShare) || perShare <= 0) return;
    methods.push({ key, label, perShare: r2(perShare), weight: w, basis });
  };

  // --- earnings multiple ---
  const eps = i.fwdEps && i.fwdEps > 0 ? i.fwdEps : i.epsTtm;
  const peTarget = r2(archetype === "earnings" ? anchor : DEFAULTS.pe);
  if (eps && eps > 0) {
    add("epsMultiple", "Earnings multiple", eps * peTarget, `${peTarget}x on $${eps.toFixed(2)} EPS`);
  }

  // --- own trading history ---
  // A company that has traded at 40x for five years is not "90% overvalued"
  // because a growth model prefers 22x — that gap is the model disagreeing
  // with a persistent market judgement, not evidence. Mean reversion to the
  // company's own median multiple is a separate, weaker claim than an absolute
  // one, so it is one weighted method among several rather than the anchor.
  if (eps && eps > 0 && i.ownMedianPe && i.ownMedianPe > 3 && (i.ownPeSamples ?? 0) >= 5) {
    add(
      "ownHistory",
      "Own trading history",
      eps * clamp(i.ownMedianPe, 5, 70),
      `${r2(clamp(i.ownMedianPe, 5, 70))}x — its own median over ${i.ownPeSamples} quarters`
    );
  }

  // --- EV/EBIT ---
  if (i.opIncomeTtm && i.opIncomeTtm > 0) {
    add(
      "evEbit",
      "EV / operating income",
      (DEFAULTS.evEbit * i.opIncomeTtm + netCash) / shares,
      `${r2(DEFAULTS.evEbit)}x EBIT plus net cash`
    );
  }

  // Cash-flow methods are only as good as the cash-flow figure, and a TTM FCF
  // that rounds to nothing against revenue is far more often a bad parse than a
  // real result - Fabrinet came through at 0.09% of revenue, which produced a
  // confident $27 fair-value component against a $422 price and dragged the
  // blend down by a third. Below a floor the methods are skipped entirely, so
  // the weight renormalises onto methods that did compute and the reduced
  // coverage widens the margin of safety. Refusing to answer beats answering
  // precisely and wrongly.
  const fcfUsable =
    i.fcfTtm !== undefined &&
    i.fcfTtm > 0 &&
    (!i.revenueTtm || i.revenueTtm <= 0 || i.fcfTtm / i.revenueTtm >= 0.01);
  const usableFcf = fcfUsable ? i.fcfTtm : undefined;

  // --- discounted cash flow at justified growth ---
  // Growth the business has demonstrated, capped by moat, faded to terminal.
  // See lib/expectations.ts for why this is not the same question as a multiple.
  {
    const jv = justifiedValue({
      fcfTtm: usableFcf,
      netCash,
      shares,
      revYoY: i.revGrowth,
      revYoYPrior: i.revGrowthPrior,
      guidedGrowth: i.guidedGrowth,
      moatScore: i.moatScore,
      netDebtToEbitda: i.netDebtToEbitda,
      trajectoryGrowth: i.trajectoryGrowth,
      trajectoryConfidence: i.trajectoryConfidence,
    });
    if (jv) {
      add(
        "expectationsDcf",
        "Cash flows at earned growth",
        jv.perShare,
        `${(jv.growth * 100).toFixed(1)}% growth fading over ${jv.horizon}y at ${(jv.wacc * 100).toFixed(1)}%`
      );
    }
  }

  // --- FCF yield ---
  if (usableFcf) {
    add(
      "fcfYield",
      "Free cash flow yield",
      usableFcf / DEFAULTS.fcfYield / shares,
      `${(DEFAULTS.fcfYield * 100).toFixed(0)}% yield on TTM FCF`
    );
  }

  // --- EV/Sales ---
  if (i.revenueTtm && i.revenueTtm > 0) {
    const evsTarget = r2(archetype === "preProfit" ? anchor : DEFAULTS.evSales);
    add(
      "evSales",
      "EV / sales",
      (evsTarget * i.revenueTtm + netCash) / shares,
      `${evsTarget}x on $${(i.revenueTtm / 1e9).toFixed(2)}B revenue`
    );
  }

  // --- book value ---
  const equity = i.equity ?? (i.totalAssets !== undefined && i.totalLiabilities !== undefined ? i.totalAssets - i.totalLiabilities : undefined);
  if (equity && equity > 0) {
    const pbTarget =
      archetype === "financial" || archetype === "reit"
        ? anchor
        : archetype === "assetHolding"
          ? 1
          : DEFAULTS.pb;
    add("bookValue", "Book value", (equity * pbTarget) / shares, `${pbTarget}x book equity`);
  }

  // --- net asset value (the one that makes a treasury company legible) ---
  if (equity && equity > 0 && archetype === "assetHolding") {
    const navPerShare = equity / shares;
    const holdings = i.cryptoFairValue ?? i.longTermInvestments;
    add(
      "nav",
      "Net asset value",
      navPerShare * anchor,
      holdings
        ? `${anchor}x NAV — $${(holdings / 1e9).toFixed(1)}B holdings at fair value, net of debt`
        : `${anchor}x net asset value`
    );
  }

  if (methods.length === 0) return null;

  // Renormalize whatever survived, so a missing method dilutes confidence
  // rather than silently dropping value.
  const totalWeight = methods.reduce((s, m) => s + m.weight, 0);
  const fairValue = methods.reduce((s, m) => s + m.perShare * (m.weight / totalWeight), 0);

  // Dispersion = how much the methods disagree, as a coefficient of variation.
  // This is the honest measure of how much we actually know.
  const mean = methods.reduce((s, m) => s + m.perShare, 0) / methods.length;
  const variance =
    methods.length > 1
      ? methods.reduce((s, m) => s + (m.perShare - mean) ** 2, 0) / (methods.length - 1)
      : 0;
  const dispersion = mean > 0 ? clamp(Math.sqrt(variance) / mean, 0, 1.5) : 0;

  // Margin of safety widens with disagreement and with how few methods applied.
  const coverage = totalWeight; // 1.0 when every method for this archetype computed
  // Margin of safety widens with disagreement, with how few methods applied,
  // and with how much the price is already asking of the business. A price
  // underwriting growth well beyond anything delivered needs more room to be
  // wrong, independently of whether the methods happen to agree.
  const expectationsPad =
    i.expectationsVerdict === "heroic"
      ? 0.08
      : i.expectationsVerdict === "demanding"
        ? 0.04
        : i.expectationsVerdict === "undemanding"
          ? -0.02
          : 0;
  // Volatility widens the zones too. A band that is reachable on a 20%-vol
  // utility is decorative on a 70%-vol semiconductor: the price passes through
  // it in a week and the "zone" never functions as a zone. Scaling by the
  // stock's own realised volatility is what makes the boundaries mean the same
  // thing across names.
  const volPad = i.realisedVol === undefined ? 0 : clamp((i.realisedVol - 0.3) * 0.25, -0.03, 0.12);
  const marginOfSafety = clamp(
    0.12 + dispersion * 0.35 + (1 - coverage) * 0.25 + expectationsPad + volPad,
    0.1,
    0.5
  );

  const confidence: Valuation["confidence"] =
    methods.length >= 3 && dispersion < 0.35 ? "high" : dispersion < 0.7 ? "medium" : "low";

  const bands = buildBands(fairValue, marginOfSafety, anchor);

  return {
    archetype,
    archetypeReason: reason,
    anchor: r2(anchor),
    anchorLabel,
    methods,
    fairValue: r2(fairValue),
    dispersion: Math.round(dispersion * 100) / 100,
    marginOfSafety: Math.round(marginOfSafety * 100) / 100,
    confidence,
    bands,
    currentBand: bandFor(i.price, bands),
    upside: i.price && i.price > 0 ? Math.round((fairValue / i.price - 1) * 1000) / 10 : undefined,
  };
}

/**
 * Bands are expressed as distance from fair value, scaled by the margin of
 * safety — so an uncertain valuation demands a deeper discount before it
 * reads as a buy, and the whole table is narrower when we know more.
 */
/**
 * Price zones, named for where the price is rather than for what to do.
 *
 * These used to be labelled "Strong buy", "Attractive", "Accumulate" — the same
 * vocabulary the verdict uses — and the two answer different questions. A zone
 * is purely price against fair value. A verdict blends growth, quality, moat and
 * momentum, of which valuation is one part. So NVDA could sit in the
 * "Attractive" zone on a 21% discount while the verdict read "Strong buy" on the
 * strength of everything else, and the screen looked broken even though both
 * numbers were right.
 *
 * Naming the zones after the discount removes the collision: the chart now says
 * how cheap something is, the verdict says what the model thinks of it, and when
 * they diverge that is information rather than a contradiction.
 */
function buildBands(fv: number, mos: number, anchor: number): Band[] {
  const edges: { label: string; action: string; lo: number; hi: number }[] = [
    { label: "Deep discount", action: "BUY_AGGRESSIVE", lo: 0, hi: 1 - 2 * mos },
    { label: "Well below value", action: "BUY", lo: 1 - 2 * mos, hi: 1 - mos },
    { label: "Below value", action: "BUY", lo: 1 - mos, hi: 1 - mos / 2 },
    { label: "Around fair value", action: "ACCUMULATE", lo: 1 - mos / 2, hi: 1 + mos / 2 },
    { label: "Above value", action: "HOLD", lo: 1 + mos / 2, hi: 1 + mos },
    { label: "Well above value", action: "TRIM", lo: 1 + mos, hi: 1 + 2.5 * mos },
  ];
  return edges.map((e) => ({
    label: e.label,
    action: e.action,
    priceLo: r2(Math.max(0, fv * e.lo)),
    priceHi: r2(fv * e.hi),
    // Multiples shown are the anchor scaled the same way, so the table still
    // reads as "x times the thing this company is valued on".
    multipleLo: r2(Math.max(0, anchor * e.lo)),
    multipleHi: r2(anchor * e.hi),
  }));
}

function bandFor(price: number | undefined, bands: Band[]): string | undefined {
  if (price === undefined || bands.length === 0) return undefined;
  const hit = bands.find((b) => price >= b.priceLo && price < b.priceHi);
  if (hit) return hit.label;
  return price >= bands[bands.length - 1].priceHi ? ABOVE_RANGE : BELOW_RANGE;
}
