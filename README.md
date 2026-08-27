# Equity Radar

US-listed equity watchlist with automatic daily scoring, computed buy zones, and
signal alerts. Fundamentals come straight from SEC XBRL filings; nothing is typed in
by hand and nothing is recalled from a language model.

> Research tooling, not investment advice. The system never places an order.

## What it does

- **Search + add any US filer** (~7,700 NYSE/Nasdaq/NYSE American/CBOE tickers).
- **Pulls fundamentals from SEC XBRL** — 12 quarters of revenue, margins, EPS,
  cash flow, share count, balance sheet, each traceable to `data.sec.gov`.
- **Scores two different things**, on purpose:
  - `composite` — how good the business is.
  - `asymmetry` — how good the *entry* is: quality minus how expensive and how
    already-discovered the name is. A great company that has already run 600%
    scores high on the first and low on the second.
- **Draws buy zones on the chart** — price bands derived from a target multiple
  (peer median where available) applied to forward or trailing EPS, falling back
  to EV/Sales for pre-profit names. Recomputed daily as estimates move.
- **Fires signals**, level-triggered with a re-arm window so nothing spams:
  `BUY_ZONE_ENTERED`, `FUNDAMENTALS_UP_PRICE_DOWN` (business accelerating into a
  drawdown), `MARGIN_COMPRESSION`, `DILUTION_SPIKE`, `GROWTH_DECEL`,
  `VALUATION_STRETCHED`, `VERDICT_CHANGE`.

## Stack

| Piece | Where |
|---|---|
| Dashboard | Next.js 16 on Vercel |
| System of record | Convex (own deployment) |
| Schedules | Convex crons |
| Charts | lightweight-charts |

## Data sources

**The app runs with zero API keys.** Every default source is keyless.

| Source | Used for | Key |
|---|---|---|
| SEC `data.sec.gov` XBRL companyfacts | all fundamentals | none |
| SEC `submissions` | SIC code, filing feed | none |
| SEC `company_tickers_exchange.json` | universe | none |
| Yahoo chart v8 | daily bars (primary) | none |
| Nasdaq chart | daily bars (fallback) | none |
| Alpaca Market Data | daily bars (used only if keys exist) | optional |
| FMP | consensus forward EPS (optional upgrade) | optional |

Price sources are tried in order and the first one returning bars wins, so a
single endpoint changing shape does not take the app down.

### Required environment

`SEC_USER_AGENT` is the one thing you must set. SEC returns 403 on
`www.sec.gov` unless the User-Agent contains an email-shaped contact:

```bash
npx convex env set SEC_USER_AGENT "EquityRadar/0.1 (you@example.com)"
```

### Optional upgrades

There is **no free keyless source of consensus analyst estimates** — that data
is proprietary, and Yahoo's quote endpoints that used to expose it now return
401 behind a crumb. So buy zones fall back to a *modelled* NTM EPS derived from
filed results (see below). Setting `FMP_API_KEY` swaps that for real consensus:

```bash
npx convex env set FMP_API_KEY "..."
npx convex env set ALPACA_KEY_ID "..."     # supported price feed
npx convex env set ALPACA_SECRET "..."
```

### Valuation basis

Buy zones are anchored to whichever of these is available, and the UI always
says which one it used — they are not interchangeable:

| Basis | Meaning |
|---|---|
| `fwdEps` | consensus forward EPS (needs `FMP_API_KEY`) |
| `modelledEps` | trailing EPS grown by the damped median of the last four quarterly YoY rates, capped to [-30%, +60%] and damped by 0.6 |
| `ttmEps` | trailing EPS only |
| `evSales` | EV/Sales, for loss-making names |

The modelled basis exists because trailing-only badly misprices fast growers.
It reads *more expensive* than consensus for companies with large stock comp or
amortization, because it is built on GAAP earnings while consensus is quoted on
adjusted. Extracting adjusted EPS from 8-K EX-99.1 press releases is the fix,
and is not built yet.

## Two parsing details that matter

1. **Cash-flow and share-count lines are filed year-to-date**, not per quarter.
   A 10-Q carries Q1, then H1, then 9M; the 10-K carries the full year. Discrete
   quarters are recovered by unwinding consecutive differences within a fiscal
   year. Without this, every TTM cash-flow metric silently comes back empty.
2. **Weighted averages and per-share figures are not additive**, so they are
   never unwound. Fiscal-Q4 share count is carried forward from the prior
   quarter and that quarter's EPS is derived as net income ÷ shares.

## Schedules

| Cron | When (UTC) | Job |
|---|---|---|
| `daily watchlist eval` | `0 5 * * 2-6` | re-ingest, re-score, diff, fire alerts |
| `weekly universe refresh` | `17 3 * * 0` | ticker/CIK map |
| `poll filings` | every 6h | re-evaluate on a fresh 10-K/10-Q |

## Dev

```bash
npm install
npx convex dev          # schema + functions
npm run dev             # dashboard
npm run build           # typecheck + production build
```

Manual pipeline runs:

```bash
npx convex run ingest:refreshUniverse '{}'
npx convex run ingest:refreshTicker '{"ticker":"FN","cik":"0001408710"}'
```

## Known limitations

- Adjusted EPS and guidance live in 8-K EX-99.1 press releases, not XBRL. The
  schema has fields for them; the extractor is not built yet, so all EPS is GAAP.
  This is why the modelled forward multiple reads high for AMD and similar names.
- SEC restatements mean historical scores carry mild look-ahead bias. Fine for
  sanity checks, not for claiming a track record.
- The keyless price feeds are unofficial and can change without notice. Two are
  wired in sequence to reduce that risk; set Alpaca keys for a supported feed.
- The Nasdaq fallback omits volume, so ADV degrades to zero when it is the
  source that answered.
