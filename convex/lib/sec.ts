/**
 * SEC EDGAR client. Free, keyless, authoritative — this is the backbone.
 *
 * Fair-access policy requires a descriptive User-Agent with a contact address.
 * Set SEC_USER_AGENT in the Convex environment; the fallback is deliberately
 * generic so no personal address ships in source.
 */

const UA =
  (typeof process !== "undefined" && process.env.SEC_USER_AGENT) ||
  "EquityRadar/0.1 (contact: set SEC_USER_AGENT)";

const SEC_HEADERS = { "User-Agent": UA, Accept: "application/json" };

export const padCik = (cik: string | number) => String(cik).replace(/\D/g, "").padStart(10, "0");

async function secJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: SEC_HEADERS });
  if (!res.ok) throw new Error(`SEC ${res.status} ${res.statusText} for ${url}`);
  return (await res.json()) as T;
}

/* ------------------------------------------------------------------ */
/* Universe                                                            */
/* ------------------------------------------------------------------ */

export type UniverseRow = { ticker: string; cik: string; name: string; exchange?: string };

/**
 * company_tickers_exchange.json carries the exchange, which lets us drop
 * OTC names — the ADV floor matters more than breadth for this use case.
 */
export async function fetchUniverse(): Promise<UniverseRow[]> {
  const data = await secJson<{ fields: string[]; data: (string | number)[][] }>(
    "https://www.sec.gov/files/company_tickers_exchange.json"
  );
  const idx = Object.fromEntries(data.fields.map((f, i) => [f, i]));
  const out: UniverseRow[] = [];
  for (const row of data.data) {
    const ticker = String(row[idx.ticker] ?? "").toUpperCase();
    const exchange = row[idx.exchange] ? String(row[idx.exchange]) : undefined;
    if (!ticker || ticker.length > 6) continue;
    if (exchange && !["Nasdaq", "NYSE", "NYSE American", "CBOE"].includes(exchange)) continue;
    out.push({
      ticker,
      cik: padCik(row[idx.cik]),
      name: String(row[idx.name] ?? ""),
      exchange,
    });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* XBRL company facts                                                  */
/* ------------------------------------------------------------------ */

type Fact = {
  start?: string;
  end: string;
  val: number;
  fy?: number;
  fp?: string;
  form?: string;
  filed?: string;
  frame?: string;
};

type CompanyFacts = {
  cik: number;
  entityName: string;
  facts: Record<string, Record<string, { units: Record<string, Fact[]> }>>;
};

/**
 * Concept synonyms. Companies tag the same economic line differently, and the
 * first match that yields data wins. Order matters — most specific first.
 */
const CONCEPTS = {
  revenue: {
    "us-gaap": [
      "RevenueFromContractWithCustomerExcludingAssessedTax",
      "RevenueFromContractWithCustomerIncludingAssessedTax",
      "Revenues",
      "SalesRevenueNet",
      "SalesRevenueGoodsNet",
      "RevenuesNetOfInterestExpense",
    ],
    "ifrs-full": ["RevenueFromContractsWithCustomers", "Revenue"],
  },
  costOfRevenue: {
    "us-gaap": ["CostOfRevenue", "CostOfGoodsAndServicesSold", "CostOfGoodsSold", "CostOfSales"],
    "ifrs-full": ["CostOfSales"],
  },
  grossProfit: { "us-gaap": ["GrossProfit"], "ifrs-full": ["GrossProfit"] },
  opIncome: {
    "us-gaap": ["OperatingIncomeLoss"],
    "ifrs-full": ["ProfitLossFromOperatingActivities"],
  },
  netIncome: {
    "us-gaap": ["NetIncomeLoss", "ProfitLoss"],
    "ifrs-full": ["ProfitLoss", "ProfitLossAttributableToOwnersOfParent"],
  },
  epsDiluted: {
    "us-gaap": ["EarningsPerShareDiluted", "EarningsPerShareBasicAndDiluted"],
    "ifrs-full": ["DilutedEarningsLossPerShare", "BasicAndDilutedEarningsLossPerShare"],
  },
  sharesDiluted: {
    "us-gaap": [
      "WeightedAverageNumberOfDilutedSharesOutstanding",
      "WeightedAverageNumberOfSharesOutstandingBasicAndDiluted",
      "WeightedAverageNumberOfSharesOutstandingBasic",
    ],
    "ifrs-full": [
      "AdjustedWeightedAverageShares",
      "WeightedAverageShares",
      "WeightedAverageNumberOfOrdinarySharesOutstanding",
    ],
  },
  rnd: {
    "us-gaap": ["ResearchAndDevelopmentExpense"],
    "ifrs-full": ["ResearchAndDevelopmentExpense"],
  },
  ocf: {
    "us-gaap": [
      "NetCashProvidedByUsedInOperatingActivities",
      "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations",
    ],
    "ifrs-full": ["CashFlowsFromUsedInOperatingActivities"],
  },
  capex: {
    "us-gaap": ["PaymentsToAcquirePropertyPlantAndEquipment", "PaymentsToAcquireProductiveAssets"],
    "ifrs-full": ["PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities"],
  },
  cash: {
    "us-gaap": [
      "CashAndCashEquivalentsAtCarryingValue",
      "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents",
    ],
    "ifrs-full": ["CashAndCashEquivalents"],
  },
  shortTermInvestments: {
    "us-gaap": [
      "ShortTermInvestments",
      "MarketableSecuritiesCurrent",
      "AvailableForSaleSecuritiesDebtSecuritiesCurrent",
    ],
    "ifrs-full": ["ShorttermInvestmentsClassifiedAsCashEquivalents", "OtherShorttermInvestments"],
  },
  longTermDebt: {
    "us-gaap": ["LongTermDebtNoncurrent", "LongTermDebt"],
    // Most specific first so a total "Borrowings" tag is only used as a last
    // resort — pairing it with the current portion would double-count.
    "ifrs-full": ["NoncurrentPortionOfNoncurrentBorrowings", "LongtermBorrowings", "Borrowings"],
  },
  currentDebt: {
    "us-gaap": ["LongTermDebtCurrent", "DebtCurrent", "ShortTermBorrowings"],
    "ifrs-full": ["CurrentPortionOfLongtermBorrowings", "ShorttermBorrowings"],
  },
} as const;

type ConceptKey = keyof typeof CONCEPTS;

/** A US listing does not imply US GAAP — GlobalFoundries files IFRS, for one. */
const TAXONOMIES = ["us-gaap", "ifrs-full"] as const;

const days = (a: string, b: string) =>
  Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);

function pickUnit(units: Record<string, Fact[]>): Fact[] {
  return units.USD ?? units["USD/shares"] ?? units.shares ?? Object.values(units)[0] ?? [];
}

/**
 * Latest-filed wins, so restatements supersede the original figure.
 */
function dedupe(facts: Fact[], key: (f: Fact) => string): Map<string, Fact> {
  const map = new Map<string, Fact>();
  const sorted = [...facts].sort((a, b) => (a.filed ?? "").localeCompare(b.filed ?? ""));
  for (const f of sorted) map.set(key(f), f);
  return map;
}

/**
 * Duration concepts -> a discrete quarterly series.
 *
 * Two filing styles have to be reconciled:
 *  - Income-statement lines are usually filed per quarter (~90 day spans).
 *  - Cash-flow and weighted-average-share lines are usually filed
 *    year-to-date, so a 10-Q carries Q1, then H1, then 9M, and the 10-K
 *    carries the full year. Only Q1 is ever a standalone quarter.
 *
 * Unwinding YTD facts (consecutive differences within a fiscal year, keyed by
 * the shared start date) recovers the discrete quarters for both styles, and
 * incidentally fills the Q4 that filers only ever report inside the annual
 * total. Without this, TTM sums silently return undefined for every cash-flow
 * metric — which looks like missing data but is really a parsing bug.
 */
function quarterlySeries(all: Fact[], unwind: boolean): Map<string, number> {
  const durations = all.filter((f): f is Fact & { start: string } => !!f.start);
  const byEnd = new Map<string, number>();

  // 1. Facts already filed as a single quarter.
  const discrete = durations.filter((f) => {
    const span = days(f.start, f.end);
    return span >= 80 && span <= 100;
  });
  for (const [, f] of dedupe(discrete, (f) => `${f.start}|${f.end}`)) byEnd.set(f.end, f.val);

  // Weighted averages (share counts) and per-share figures are not additive:
  // H1 minus Q1 is meaningless for them, so they only ever use direct facts.
  if (!unwind) return byEnd;

  // 2. Unwind cumulative facts sharing a fiscal-year start date.
  const groups = new Map<string, Fact[]>();
  for (const [, f] of dedupe(durations, (f) => `${f.start}|${f.end}`)) {
    const key = (f as Fact & { start: string }).start;
    const list = groups.get(key) ?? [];
    list.push(f);
    groups.set(key, list);
  }

  for (const facts of groups.values()) {
    const sorted = [...facts].sort((a, b) => a.end.localeCompare(b.end));
    let prev: number | null = null;
    for (const f of sorted) {
      const span = days(f.start as string, f.end);
      if (span < 80) continue; // sub-quarter stub, not a reporting period
      if (prev === null) {
        // First period in the year — it is itself a quarter if ~90 days.
        if (span <= 100 && !byEnd.has(f.end)) byEnd.set(f.end, f.val);
        prev = f.val;
        continue;
      }
      if (!byEnd.has(f.end)) byEnd.set(f.end, f.val - prev);
      prev = f.val;
    }
  }

  return byEnd;
}

/** Instant concepts (balance sheet): keyed by the as-of date. */
function instantSeries(all: Fact[]): Map<string, number> {
  const instants = all.filter((f) => !f.start);
  const byEnd = new Map<string, number>();
  for (const [, f] of dedupe(instants, (f) => f.end)) byEnd.set(f.end, f.val);
  return byEnd;
}

/** Flows can be unwound from YTD totals; averages and per-share figures cannot. */
const NON_ADDITIVE: ReadonlySet<ConceptKey> = new Set(["epsDiluted", "sharesDiluted"]);

/**
 * Picks the best concept for a line item — by *recency*, not by list order.
 *
 * Companies migrate tags and leave the old series behind. NVIDIA, for example,
 * still carries a `RevenueFromContractWithCustomerExcludingAssessedTax` series
 * that stops in 2020 while current filings tag `Revenues`. Taking the first
 * concept that has any data at all silently scores the company on six-year-old
 * financials — which looks entirely plausible and is completely wrong. So every
 * candidate is built and the one reaching furthest forward wins, with series
 * size as the tie-break.
 */
function seriesFor(cf: CompanyFacts, key: ConceptKey, kind: "duration" | "instant"): Map<string, number> {
  let best: Map<string, number> = new Map();
  let bestEnd = "";

  for (const taxonomy of TAXONOMIES) {
    const node = cf.facts[taxonomy];
    if (!node) continue;
    for (const concept of CONCEPTS[key][taxonomy] as readonly string[]) {
      const entry = node[concept];
      if (!entry) continue;
      const facts = pickUnit(entry.units);
      if (facts.length === 0) continue;
      const series =
        kind === "duration" ? quarterlySeries(facts, !NON_ADDITIVE.has(key)) : instantSeries(facts);
      if (series.size === 0) continue;

      const latest = [...series.keys()].reduce((a, b) => (a > b ? a : b), "");
      if (latest > bestEnd || (latest === bestEnd && series.size > best.size)) {
        best = series;
        bestEnd = latest;
      }
    }
  }
  return best;
}

/**
 * Cover-page share count. Not a weighted average, so it is only a fallback for
 * market cap when the filer never tags one — which IFRS filers routinely don't.
 */
function deiSharesOutstanding(cf: CompanyFacts): Map<string, number> {
  const entry = cf.facts["dei"]?.["EntityCommonStockSharesOutstanding"];
  if (!entry) return new Map();
  return instantSeries(pickUnit(entry.units));
}

export type SecQuarter = {
  fiscalPeriod: string;
  periodEnd: string;
  revenue?: number;
  grossProfit?: number;
  opIncome?: number;
  netIncome?: number;
  epsDiluted?: number;
  operatingCashFlow?: number;
  capex?: number;
  cash?: number;
  totalDebt?: number;
  sharesDiluted?: number;
  rnd?: number;
};

/** Fetch and normalize the last N quarters of GAAP fundamentals. */
export async function fetchQuarters(cik: string, limit = 12): Promise<{ name: string; quarters: SecQuarter[] }> {
  const cf = await secJson<CompanyFacts>(
    `https://data.sec.gov/api/xbrl/companyfacts/CIK${padCik(cik)}.json`
  );

  const dur = {
    revenue: seriesFor(cf, "revenue", "duration"),
    costOfRevenue: seriesFor(cf, "costOfRevenue", "duration"),
    grossProfit: seriesFor(cf, "grossProfit", "duration"),
    opIncome: seriesFor(cf, "opIncome", "duration"),
    netIncome: seriesFor(cf, "netIncome", "duration"),
    epsDiluted: seriesFor(cf, "epsDiluted", "duration"),
    sharesDiluted: seriesFor(cf, "sharesDiluted", "duration"),
    rnd: seriesFor(cf, "rnd", "duration"),
    ocf: seriesFor(cf, "ocf", "duration"),
    capex: seriesFor(cf, "capex", "duration"),
  };
  const inst = {
    cash: seriesFor(cf, "cash", "instant"),
    sti: seriesFor(cf, "shortTermInvestments", "instant"),
    ltd: seriesFor(cf, "longTermDebt", "instant"),
    cd: seriesFor(cf, "currentDebt", "instant"),
    deiShares: deiSharesOutstanding(cf),
  };

  const periodEnds = [...dur.revenue.keys()].sort((a, b) => b.localeCompare(a)).slice(0, limit);

  /**
   * Balance-sheet values persist until restated, and filers routinely stop
   * tagging a line once it goes to zero (Fabrinet's debt, for example). Taking
   * the last value on or before the period end is both more correct and more
   * complete than requiring an exact date match.
   */
  const asOf = (series: Map<string, number>, end: string): number | undefined => {
    if (series.has(end)) return series.get(end);
    let best: string | undefined;
    for (const d of series.keys()) {
      if (d <= end && (best === undefined || d > best)) best = d;
    }
    return best ? series.get(best) : undefined;
  };

  const quarters: SecQuarter[] = periodEnds.map((end) => {
    const revenue = dur.revenue.get(end);
    const cogs = dur.costOfRevenue.get(end);
    const grossProfit =
      dur.grossProfit.get(end) ??
      (revenue !== undefined && cogs !== undefined ? revenue - cogs : undefined);
    const cash = add(asOf(inst.cash, end), asOf(inst.sti, end));
    const totalDebt = add(asOf(inst.ltd, end), asOf(inst.cd, end));
    const netIncome = dur.netIncome.get(end);

    // Fiscal-Q4 is only ever reported inside the annual total. Flows are
    // recovered by unwinding, but weighted-average share count cannot be —
    // so carry the last reported count forward. It moves by fractions of a
    // percent quarter to quarter, which is well inside the tolerance of every
    // ratio built on it.
    const sharesDiluted =
      dur.sharesDiluted.get(end) ?? asOf(dur.sharesDiluted, end) ?? asOf(inst.deiShares, end);

    // Same reason: derive the quarter's EPS from figures we do have rather
    // than subtracting per-share amounts, which is not a valid operation.
    const epsDiluted =
      dur.epsDiluted.get(end) ??
      (netIncome !== undefined && sharesDiluted !== undefined && sharesDiluted > 0
        ? netIncome / sharesDiluted
        : undefined);

    return {
      fiscalPeriod: fiscalLabel(end),
      periodEnd: end,
      revenue,
      grossProfit,
      opIncome: dur.opIncome.get(end),
      netIncome,
      epsDiluted,
      operatingCashFlow: dur.ocf.get(end),
      capex: dur.capex.get(end),
      cash,
      totalDebt,
      sharesDiluted,
      rnd: dur.rnd.get(end),
    };
  });

  return { name: cf.entityName, quarters };
}

const add = (a?: number, b?: number) =>
  a === undefined && b === undefined ? undefined : (a ?? 0) + (b ?? 0);

function fiscalLabel(end: string): string {
  const d = new Date(end + "T00:00:00Z");
  return `${d.getUTCFullYear()}-Q${Math.floor(d.getUTCMonth() / 3) + 1}`;
}

/* ------------------------------------------------------------------ */
/* Recent filings                                                      */
/* ------------------------------------------------------------------ */

export type FilingRow = { form: string; filedAt: string; accession: string; url: string };

/** Company profile — SIC is what the default peer grouping keys off. */
export async function fetchProfile(cik: string): Promise<{
  name: string;
  sic?: string;
  sicDescription?: string;
  exchange?: string;
}> {
  const data = await secJson<{
    name: string;
    sic?: string;
    sicDescription?: string;
    exchanges?: string[];
  }>(`https://data.sec.gov/submissions/CIK${padCik(cik)}.json`);
  return {
    name: data.name,
    sic: data.sic,
    sicDescription: data.sicDescription,
    exchange: data.exchanges?.[0],
  };
}

export async function fetchRecentFilings(cik: string, forms = ["10-K", "10-Q", "8-K"]): Promise<FilingRow[]> {
  const padded = padCik(cik);
  const data = await secJson<{
    filings: { recent: { form: string[]; filingDate: string[]; accessionNumber: string[]; primaryDocument: string[] } };
  }>(`https://data.sec.gov/submissions/CIK${padded}.json`);

  const r = data.filings.recent;
  const out: FilingRow[] = [];
  for (let i = 0; i < r.form.length && out.length < 40; i++) {
    if (!forms.includes(r.form[i])) continue;
    const accNoDashes = r.accessionNumber[i].replace(/-/g, "");
    out.push({
      form: r.form[i],
      filedAt: r.filingDate[i],
      accession: r.accessionNumber[i],
      url: `https://www.sec.gov/Archives/edgar/data/${Number(padded)}/${accNoDashes}/${r.primaryDocument[i]}`,
    });
  }
  return out;
}
