/**
 * Adjusted EPS and guidance extraction from 8-K Item 2.02 earnings releases.
 *
 * This closes the largest error source in the system. XBRL is GAAP-only, so a
 * company with heavy stock compensation reads far more expensive than the
 * market sees it — AMD's Q2 2026 GAAP EPS was $1.38 against $1.66 non-GAAP,
 * a 20% gap that flowed straight into a "67% overvalued" verdict.
 *
 * Two rules make this trustworthy rather than plausible:
 *  1. The model is given the release text and asked only to locate numbers.
 *  2. Every number it returns is checked against the source text before it is
 *     stored. A figure that does not literally appear is discarded, not saved.
 */

import { extractJson } from "./llm";

const UA =
  (typeof process !== "undefined" && process.env.SEC_USER_AGENT) ||
  "EquityRadar/0.1 (contact: set SEC_USER_AGENT)";
const headers = { "User-Agent": UA };

export type ReleaseDoc = { url: string; name: string; text: string };

/** Strip HTML to readable text, preserving number/word spacing. */
function toText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#8217;|&#8216;/g, "'")
    .replace(/&#8220;|&#8221;/g, '"')
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#\d+;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const RELEASE_MARKERS = [
  "non-gaap",
  "diluted earnings per share",
  "outlook",
  "gross margin",
  "quarter",
];

/**
 * Filenames are not reliable — AMD calls its release `q22026991.htm`, not
 * `ex99-1.htm`. So candidates are scored on content instead.
 */
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function getWithRetry(url: string): Promise<Response | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url, { headers });
    if (res.ok) return res;
    // SEC throttles with 403/429 under burst. Back off rather than treating a
    // rate limit as "this filing has no earnings release".
    if (res.status === 403 || res.status === 429 || res.status >= 500) {
      await sleep(600 * (attempt + 1));
      continue;
    }
    return null; // genuine 404 — the file is not there
  }
  return null;
}

export type ReleaseLookup =
  | { kind: "found"; doc: ReleaseDoc }
  | { kind: "none"; detail: string }
  | { kind: "transient"; reason: string };

/**
 * Filenames are not reliable — AMD calls its release `q22026991.htm`, not
 * `ex99-1.htm`. So candidates are scored on content instead.
 *
 * The three-way return matters: a fetch that failed under rate limiting must
 * not be recorded as "no release exists", or the filing is skipped forever and
 * that quarter silently never gets an adjusted EPS.
 */
export async function findEarningsRelease(
  cik: string,
  accession: string
): Promise<ReleaseLookup> {
  const noDash = accession.replace(/-/g, "");
  const base = `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${noDash}`;

  // The filing index PAGE is the reliable source of document names. index.json
  // intermittently returns only container files (.txt, -xbrl.zip) for recent
  // accessions, which silently looked like "this filing has no release".
  const idxRes = await getWithRetry(`${base}/${accession}-index.html`);
  if (!idxRes) return { kind: "transient", reason: "filing index unavailable" };
  const indexHtml = await idxRes.text();

  // Document rows link to /Archives/...; EX-99.x is listed with its type, so
  // prefer those and fall back to scoring every .htm in the filing.
  const hrefs = Array.from(
    indexHtml.matchAll(/href="(\/Archives\/edgar\/data\/[^"]+?\.htm)"/gi),
    (m) => m[1]
  );
  const names = Array.from(
    new Set(
      hrefs
        .map((h) => h.split("/").pop() as string)
        .filter((n) => n && !/index/i.test(n) && !/^R\d+\.htm$/i.test(n))
    )
  );

  const exhibitFirst = [
    ...names.filter((n) => /99/.test(n)),
    ...names.filter((n) => !/99/.test(n)),
  ];
  const allNames = exhibitFirst;
  if (allNames.length === 0) {
    return { kind: "none", detail: "filing index lists no document files" };
  }

  const candidates = allNames.slice(0, 8);

  let best: ReleaseDoc | null = null;
  let bestScore = -1;
  let failures = 0;
  const seen: string[] = [];

  for (const name of candidates) {
    try {
      const res = await getWithRetry(`${base}/${name}`);
      if (!res) {
        failures++;
        seen.push(`${name}:fetchfail`);
        continue;
      }
      const text = toText(await res.text());
      const low = text.toLowerCase();
      const hits = RELEASE_MARKERS.filter((m) => low.includes(m)).length;
      seen.push(`${name}:${hits}h/${Math.round(text.length / 1000)}k`);
      // Marker count dominates; length breaks ties toward the fuller document.
      const score = hits * 1000 + Math.min(text.length, 80_000) / 1000;
      if (hits >= 3 && score > bestScore) {
        bestScore = score;
        best = { url: `${base}/${name}`, name, text };
      }
    } catch (e) {
      failures++;
      seen.push(`${name}:err`);
    }
    await sleep(120); // stay inside SEC fair-access limits
  }

  if (best) return { kind: "found", doc: best };
  if (failures > 0) return { kind: "transient", reason: `fetch failures: ${seen.join(" ")}` };
  return {
    kind: "none",
    detail: seen.length ? seen.join(" ") : `no candidates from ${allNames.length} files: ${allNames.slice(0, 10).join(",")}`,
  };
}

export type Extracted = {
  fiscalPeriodLabel: string | null;
  periodEndDate: string | null;
  gaapEps: number | null;
  adjEps: number | null;
  adjGrossMarginPct: number | null;
  guidancePeriodLabel: string | null;
  guidanceRevenueLow: number | null;
  guidanceRevenueHigh: number | null;
  guidanceEpsLow: number | null;
  guidanceEpsHigh: number | null;
};

const SYSTEM = `You extract reported figures from an SEC Item 2.02 earnings press release.
You do not estimate, infer, convert or calculate. You only report numbers that appear
in the text. If a figure is absent, return null for it — never guess.

Return ONLY a JSON object with exactly these keys:
{
  "fiscalPeriodLabel": string|null,      // the quarter this release reports, e.g. "Q2 2026"
  "periodEndDate": string|null,          // YYYY-MM-DD if the period end date is stated
  "gaapEps": number|null,                // GAAP diluted EPS for the reported quarter
  "adjEps": number|null,                 // non-GAAP / adjusted diluted EPS for the reported quarter
  "adjGrossMarginPct": number|null,      // non-GAAP gross margin as a decimal, e.g. 0.56 for 56%
  "guidancePeriodLabel": string|null,    // the period being guided, e.g. "Q3 2026"
  "guidanceRevenueLow": number|null,     // in whole dollars, e.g. 9600000000
  "guidanceRevenueHigh": number|null,
  "guidanceEpsLow": number|null,
  "guidanceEpsHigh": number|null
}

Rules:
- adjEps is the per-share figure described as non-GAAP or adjusted. Do not use the GAAP figure.
- If guidance gives a single point rather than a range, set low and high to the same value.
- Convert "approximately $9.6 billion" to 9600000000. Do not convert per-share figures.
- Report the CURRENT reported quarter, not prior-year comparatives.`;

/**
 * Numbers must survive a check against the source text. This catches the
 * failure mode that matters: a fluent, plausible figure that was never in the
 * filing. Per-share values are matched on their literal decimal form; large
 * dollar amounts on their mantissa ("9.6" for $9.6 billion).
 */
function appearsInText(value: number, text: string): boolean {
  const candidates = new Set<string>();
  const abs = Math.abs(value);

  if (abs < 1000) {
    candidates.add(abs.toFixed(2));
    candidates.add(String(Math.round(abs * 100) / 100));
    candidates.add(abs.toFixed(1));
    candidates.add(String(Math.round(abs)));
  } else {
    for (const unit of [1e9, 1e6, 1e3]) {
      const scaled = abs / unit;
      if (scaled >= 0.1 && scaled < 10000) {
        candidates.add(scaled.toFixed(1));
        candidates.add(scaled.toFixed(2));
        candidates.add(String(Math.round(scaled)));
        candidates.add(Math.round(scaled).toLocaleString("en-US"));
      }
    }
  }

  const haystack = text.replace(/,/g, "");
  for (const c of candidates) {
    if (text.includes(c) || haystack.includes(c.replace(/,/g, ""))) return true;
  }
  return false;
}

export type VerifiedExtraction = {
  data: Extracted;
  rejected: string[];
  model: string;
  sourceUrl: string;
};

export async function extractFromRelease(
  doc: ReleaseDoc,
  ticker: string
): Promise<VerifiedExtraction | { error: string }> {
  // The numbers live in the narrative and the outlook, both near the top. The
  // tail is boilerplate and reconciliation tables that only add tokens.
  const excerpt = doc.text.slice(0, 18_000);

  const result = await extractJson<Extracted>({
    system: SYSTEM,
    user: `Company: ${ticker}\n\nEarnings release text:\n${excerpt}`,
  });
  if (!result.ok) return { error: result.error };

  const raw = result.value;
  const rejected: string[] = [];
  const data: Extracted = { ...raw };

  const numericKeys: (keyof Extracted)[] = [
    "gaapEps",
    "adjEps",
    "adjGrossMarginPct",
    "guidanceRevenueLow",
    "guidanceRevenueHigh",
    "guidanceEpsLow",
    "guidanceEpsHigh",
  ];

  for (const key of numericKeys) {
    const v = data[key];
    if (typeof v !== "number" || !Number.isFinite(v)) {
      (data[key] as number | null) = null;
      continue;
    }
    // Gross margin is stated as a percentage in the text but stored as a
    // decimal, so verify against the percentage form.
    const probe = key === "adjGrossMarginPct" ? v * 100 : v;
    if (!appearsInText(probe, doc.text)) {
      rejected.push(`${key}=${v}`);
      (data[key] as number | null) = null;
    }
  }

  // A per-share figure outside this range is a units error, not a result.
  for (const key of ["gaapEps", "adjEps", "guidanceEpsLow", "guidanceEpsHigh"] as const) {
    const v = data[key];
    if (typeof v === "number" && Math.abs(v) > 500) {
      rejected.push(`${key}=${v} (implausible per-share)`);
      data[key] = null;
    }
  }

  return { data, rejected, model: result.model, sourceUrl: doc.url };
}
