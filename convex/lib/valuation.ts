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
  grossMarginPct?: number;
  /** User anchor. Its meaning depends on archetype — P/E, EV/S or NAV premium. */
  anchorOverride?: number;
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
  earnings: { epsMultiple: 0.4, evEbit: 0.25, fcfYield: 0.25, evSales: 0.1 },
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

  const methods: Method[] = [];
  const add = (key: string, label: string, perShare: number | undefined, basis: string) => {
    const w = WEIGHTS[archetype][key];
    if (!w || perShare === undefined || !Number.isFinite(perShare) || perShare <= 0) return;
    methods.push({ key, label, perShare: r2(perShare), weight: w, basis });
  };

  // --- earnings multiple ---
  const eps = i.fwdEps && i.fwdEps > 0 ? i.fwdEps : i.epsTtm;
  const peTarget = archetype === "earnings" ? anchor : DEFAULTS.pe;
  if (eps && eps > 0) {
    add("epsMultiple", "Earnings multiple", eps * peTarget, `${peTarget}x on $${eps.toFixed(2)} EPS`);
  }

  // --- EV/EBIT ---
  if (i.opIncomeTtm && i.opIncomeTtm > 0) {
    add(
      "evEbit",
      "EV / operating income",
      (DEFAULTS.evEbit * i.opIncomeTtm + netCash) / shares,
      `${DEFAULTS.evEbit}x EBIT plus net cash`
    );
  }

  // --- FCF yield ---
  if (i.fcfTtm && i.fcfTtm > 0) {
    add(
      "fcfYield",
      "Free cash flow yield",
      i.fcfTtm / DEFAULTS.fcfYield / shares,
      `${(DEFAULTS.fcfYield * 100).toFixed(0)}% yield on TTM FCF`
    );
  }

  // --- EV/Sales ---
  if (i.revenueTtm && i.revenueTtm > 0) {
    const evsTarget = archetype === "preProfit" ? anchor : DEFAULTS.evSales;
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
  const marginOfSafety = clamp(0.12 + dispersion * 0.35 + (1 - coverage) * 0.25, 0.1, 0.45);

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
function buildBands(fv: number, mos: number, anchor: number): Band[] {
  const edges: { label: string; action: string; lo: number; hi: number }[] = [
    { label: "Deep value", action: "BUY_AGGRESSIVE", lo: 0, hi: 1 - 2 * mos },
    { label: "Strong buy", action: "BUY", lo: 1 - 2 * mos, hi: 1 - mos },
    { label: "Attractive", action: "BUY", lo: 1 - mos, hi: 1 - mos / 2 },
    { label: "Accumulate", action: "ACCUMULATE", lo: 1 - mos / 2, hi: 1 + mos / 2 },
    { label: "Expensive", action: "HOLD", lo: 1 + mos / 2, hi: 1 + mos },
    { label: "Rich", action: "TRIM", lo: 1 + mos, hi: 1 + 2.5 * mos },
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
