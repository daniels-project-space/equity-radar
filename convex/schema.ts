import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * Equity Radar — US-listed equities only.
 *
 * Source-of-truth hierarchy for every number we store:
 *   1. SEC XBRL companyfacts  (GAAP, authoritative)      -> source: "xbrl"
 *   2. 8-K EX-99.1 extraction (adjusted EPS, guidance)   -> source: "press"
 *   3. Third-party API        (prices, estimates)        -> source: "api"
 * `source` is never optional. The UI shows the tier so a model-extracted
 * adjusted number is never mistaken for a filed one.
 */
export default defineSchema({
  /** Every US filer with a ticker. Powers the search dropdown. ~12k rows. */
  universe: defineTable({
    ticker: v.string(),
    cik: v.string(),
    name: v.string(),
    exchange: v.optional(v.string()),
    sector: v.optional(v.string()),
    industry: v.optional(v.string()),
    sicCode: v.optional(v.string()),
    marketCap: v.optional(v.number()),
    searchKey: v.string(), // lowercased "ticker name" for prefix matching
    isActive: v.boolean(),
    updatedAt: v.number(),
  })
    .index("by_ticker", ["ticker"])
    .index("by_cik", ["cik"])
    .searchIndex("search_name", { searchField: "searchKey" }),

  watchlist: defineTable({
    ticker: v.string(),
    cik: v.string(),
    name: v.string(),
    addedAt: v.number(),
    addedReason: v.optional(v.string()),
    notes: v.optional(v.string()),
    muted: v.boolean(),
    /** Per-name override of the industry target-multiple band. */
    targetMultipleLo: v.optional(v.number()),
    targetMultipleHi: v.optional(v.number()),
    lastEvaluatedAt: v.optional(v.number()),
  }).index("by_ticker", ["ticker"]),

  prices_daily: defineTable({
    ticker: v.string(),
    date: v.string(), // YYYY-MM-DD
    o: v.number(),
    h: v.number(),
    l: v.number(),
    c: v.number(),
    v: v.number(),
  })
    .index("by_ticker_date", ["ticker", "date"])
    .index("by_ticker", ["ticker"]),

  price_stats: defineTable({
    ticker: v.string(),
    last: v.number(),
    prevClose: v.optional(v.number()),
    wk52High: v.number(),
    wk52Low: v.number(),
    drawdownFromHigh: v.number(), // 0..1
    ret1m: v.optional(v.number()),
    ret3m: v.optional(v.number()),
    ret12m: v.optional(v.number()),
    advUsd: v.optional(v.number()),
    /** Denormalized 30-day close series so the card grid needs one query, not
     *  a full price-table scan per ticker on every reactive re-render. */
    spark30: v.optional(v.array(v.number())),
    updatedAt: v.number(),
  }).index("by_ticker", ["ticker"]),

  /** One row per fiscal quarter per ticker. Merged from XBRL + press release. */
  fundamentals_q: defineTable({
    ticker: v.string(),
    cik: v.string(),
    fiscalPeriod: v.string(), // e.g. "2026-Q2"
    periodEnd: v.string(), // YYYY-MM-DD
    source: v.union(v.literal("xbrl"), v.literal("press"), v.literal("api")),
    revenue: v.optional(v.number()),
    grossProfit: v.optional(v.number()),
    opIncome: v.optional(v.number()),
    netIncome: v.optional(v.number()),
    epsDiluted: v.optional(v.number()),
    adjEps: v.optional(v.number()),
    operatingCashFlow: v.optional(v.number()),
    capex: v.optional(v.number()),
    cash: v.optional(v.number()),
    totalDebt: v.optional(v.number()),
    sharesDiluted: v.optional(v.number()),
    rnd: v.optional(v.number()),
    totalAssets: v.optional(v.number()),
    totalLiabilities: v.optional(v.number()),
    equity: v.optional(v.number()),
    cryptoFairValue: v.optional(v.number()),
    longTermInvestments: v.optional(v.number()),
    interestExpense: v.optional(v.number()),
    depreciationAmortization: v.optional(v.number()),
    sourceUrl: v.optional(v.string()),
    ingestedAt: v.number(),
  })
    .index("by_ticker_period", ["ticker", "fiscalPeriod"])
    .index("by_ticker", ["ticker"]),

  /** Guidance ranges — only ever from a press release / 8-K. */
  guidance: defineTable({
    ticker: v.string(),
    issuedAt: v.number(),
    periodLabel: v.string(),
    revLow: v.optional(v.number()),
    revHigh: v.optional(v.number()),
    epsLow: v.optional(v.number()),
    epsHigh: v.optional(v.number()),
    sourceUrl: v.string(),
    extractedBy: v.string(),
    confidence: v.optional(v.number()),
  }).index("by_ticker", ["ticker"]),

  filings: defineTable({
    ticker: v.string(),
    cik: v.string(),
    form: v.string(),
    filedAt: v.string(),
    accession: v.string(),
    url: v.string(),
    processed: v.boolean(),
  })
    .index("by_ticker", ["ticker"])
    .index("by_accession", ["accession"])
    .index("by_processed", ["processed"]),

  /** Derived metrics — the numbers the UI and scoring both read. */
  metrics: defineTable({
    ticker: v.string(),
    asOf: v.string(), // YYYY-MM-DD
    revenueTtm: v.optional(v.number()),
    revYoY: v.optional(v.number()),
    revYoYPrior: v.optional(v.number()),
    revAccel: v.optional(v.number()), // revYoY - revYoYPrior, in pp
    epsTtm: v.optional(v.number()),
    epsYoY: v.optional(v.number()),
    grossMarginPct: v.optional(v.number()),
    grossMarginDeltaYoY: v.optional(v.number()), // in bps
    opMarginPct: v.optional(v.number()),
    netMarginPct: v.optional(v.number()),
    fcfTtm: v.optional(v.number()),
    fcfMarginPct: v.optional(v.number()),
    rndIntensityPct: v.optional(v.number()),
    sharesYoY: v.optional(v.number()), // dilution
    netCash: v.optional(v.number()),
    netDebtToEbitda: v.optional(v.number()),
    marketCap: v.optional(v.number()),
    peTtm: v.optional(v.number()),
    evToSales: v.optional(v.number()),
    pToFcf: v.optional(v.number()),
    fwdEps: v.optional(v.number()),
    fwdPe: v.optional(v.number()),
    fwdEpsBasis: v.optional(v.union(v.literal("consensus"), v.literal("modelled"))),
    modelledNtmEps: v.optional(v.number()),
    isGaapLoss: v.optional(v.boolean()),
    /** Moat level 0..100 and direction -100..100, plus the full pillar
     *  breakdown with the evidence behind each one. */
    moatScore: v.optional(v.number()),
    moatTrend: v.optional(v.number()),
    moatSummary: v.optional(v.string()),
    moatPillars: v.optional(v.any()),
    archetype: v.optional(v.string()),
    /** legacy from the four-driver moat model, cleared on re-ingest */
    moatDrivers: v.optional(v.any()),
    /** Peer-relative context, filled in once a peer group has >= 3 scored names. */
    peerRet3m: v.optional(v.number()),
    peerRevYoY: v.optional(v.number()),
    peerCount: v.optional(v.number()),
    quartersAvailable: v.number(),
    /** Period end of the newest quarter we have. Foreign private issuers file
     *  20-F/6-K and can lag domestic filers by two or three quarters, so this
     *  has to be visible rather than implied. */
    latestPeriodEnd: v.optional(v.string()),
    updatedAt: v.number(),
  }).index("by_ticker", ["ticker"]),

  peer_groups: defineTable({
    ticker: v.string(),
    peers: v.array(v.string()),
    method: v.union(v.literal("sic"), v.literal("manual"), v.literal("theme")),
    updatedAt: v.number(),
  }).index("by_ticker", ["ticker"]),

  scores: defineTable({
    ticker: v.string(),
    date: v.string(),
    growth: v.number(),
    quality: v.number(),
    valuation: v.number(),
    risk: v.number(),
    momentum: v.number(),
    composite: v.number(),
    crowdedness: v.number(),
    asymmetry: v.number(),
    verdict: v.string(),
    /** Fully decomposed — every sub-input and its contribution. */
    components: v.any(),
    missingInputs: v.array(v.string()),
    updatedAt: v.number(),
  })
    .index("by_ticker", ["ticker"])
    .index("by_ticker_date", ["ticker", "date"])
    .index("by_date", ["date"]),

  /** Price bands: the "buy zone" overlay drawn on the chart. */
  buy_bands: defineTable({
    ticker: v.string(),
    date: v.string(),
    // The valuation, stored whole: which archetype this company is, every
    // fair-value method that applied, and how much they disagree — so the UI
    // can show the working rather than a bare verdict.
    // Optional so a row written under an earlier shape cannot wedge a deploy;
    // every field is populated on the next ingest.
    archetype: v.optional(v.string()),
    archetypeReason: v.optional(v.string()),
    anchor: v.optional(v.number()),
    anchorLabel: v.optional(v.string()),
    methods: v.optional(
      v.array(
        v.object({
          key: v.string(),
          label: v.string(),
          perShare: v.number(),
          weight: v.number(),
          basis: v.string(),
        })
      )
    ),
    fairValue: v.optional(v.number()),
    dispersion: v.optional(v.number()),
    marginOfSafety: v.optional(v.number()),
    confidence: v.optional(v.string()),
    upside: v.optional(v.number()),
    // legacy fields from the single-multiple model, cleared on re-ingest
    basis: v.optional(v.string()),
    basisValue: v.optional(v.number()),
    targetMultiple: v.optional(v.number()),
    bands: v.array(
      v.object({
        label: v.string(),
        action: v.string(),
        priceLo: v.number(),
        priceHi: v.number(),
        multipleLo: v.number(),
        multipleHi: v.number(),
      })
    ),
    currentBand: v.optional(v.string()),
    updatedAt: v.number(),
  }).index("by_ticker", ["ticker"]),

  theses: defineTable({
    ticker: v.string(),
    version: v.number(),
    verdict: v.string(),
    conviction: v.number(),
    oneLine: v.string(),
    bull: v.array(v.string()),
    bear: v.array(v.string()),
    moat: v.optional(v.any()),
    /** Machine-readable — these become alert conditions. */
    invalidationTriggers: v.array(
      v.object({ metric: v.string(), condition: v.string(), threshold: v.number(), note: v.string() })
    ),
    factPackHash: v.string(),
    model: v.string(),
    validationPassed: v.boolean(),
    createdAt: v.number(),
  }).index("by_ticker", ["ticker"]),

  evaluations: defineTable({
    ticker: v.string(),
    date: v.string(),
    composite: v.number(),
    asymmetry: v.number(),
    verdict: v.string(),
    changesSincePrior: v.array(v.string()),
    narrative: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_ticker", ["ticker"])
    .index("by_date", ["date"]),

  alerts: defineTable({
    ticker: v.string(),
    type: v.string(),
    severity: v.union(v.literal("critical"), v.literal("high"), v.literal("medium")),
    title: v.string(),
    detail: v.string(),
    payload: v.optional(v.any()),
    firedAt: v.number(),
    deliveredAt: v.optional(v.number()),
    acknowledgedAt: v.optional(v.number()),
    /** Level-trigger re-arm: no repeat of this (ticker,type) until this ms. */
    reArmAt: v.number(),
  })
    .index("by_ticker", ["ticker"])
    .index("by_ticker_type", ["ticker", "type"])
    .index("by_firedAt", ["firedAt"]),

  candidates: defineTable({
    ticker: v.string(),
    name: v.string(),
    discoveredAt: v.number(),
    stage: v.number(),
    themeSlugs: v.array(v.string()),
    asymmetry: v.number(),
    composite: v.number(),
    moatKeywordHits: v.array(v.string()),
    verdict: v.optional(v.string()),
    rationale: v.optional(v.string()),
    promotedAt: v.optional(v.number()),
    dismissedAt: v.optional(v.number()),
  })
    .index("by_ticker", ["ticker"])
    .index("by_asymmetry", ["asymmetry"]),

  themes: defineTable({
    slug: v.string(),
    label: v.string(),
    keywords: v.array(v.string()),
    enabled: v.boolean(),
  }).index("by_slug", ["slug"]),

  /** Did the signal work? Populated at 30/90/180d by a cron. */
  signal_journal: defineTable({
    alertId: v.id("alerts"),
    ticker: v.string(),
    type: v.string(),
    firedAt: v.number(),
    priceAtSignal: v.number(),
    px30d: v.optional(v.number()),
    px90d: v.optional(v.number()),
    px180d: v.optional(v.number()),
    alphaVsSpy30d: v.optional(v.number()),
    alphaVsSpy90d: v.optional(v.number()),
    alphaVsSpy180d: v.optional(v.number()),
  }).index("by_ticker", ["ticker"]),

  /**
   * Buy-zone and notification preferences. `scope` is either "global" or
   * "ticker:XYZ"; a ticker row overrides the global one field by field.
   */
  settings: defineTable({
    scope: v.string(),
    bands: v.optional(
      v.object({
        mode: v.union(v.literal("peerMedian"), v.literal("fixed")),
        fixedMultiple: v.optional(v.number()),
      })
    ),
    notify: v.optional(
      v.object({
        enabled: v.boolean(),
        minSeverity: v.union(v.literal("critical"), v.literal("high"), v.literal("medium")),
        mutedTypes: v.array(v.string()),
      })
    ),
    updatedAt: v.number(),
  }).index("by_scope", ["scope"]),

  config: defineTable({
    key: v.string(),
    value: v.any(),
    updatedAt: v.number(),
  }).index("by_key", ["key"]),

  runs: defineTable({
    task: v.string(),
    startedAt: v.number(),
    finishedAt: v.optional(v.number()),
    ok: v.optional(v.boolean()),
    processed: v.optional(v.number()),
    error: v.optional(v.string()),
  }).index("by_task", ["task"]),
});
