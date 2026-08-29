/**
 * What an asset is actually a bet on.
 *
 * The valuation reads filings, so it sees Strategy as a software company with
 * weak margins and says the price makes no sense. That is true of the software
 * company and beside the point about the security: Strategy is a leveraged claim
 * on bitcoin, and its premium to book is the market pricing that claim rather
 * than an error. The same argument, more mildly, applies to Fabrinet and Marvell
 * against Nvidia — a supplier positioned inside someone else's demand curve is
 * partly a derivative of it.
 *
 * The objection to acting on that is that "it's really a bitcoin proxy" is the
 * kind of story that sounds equally good whether or not it is true, and this
 * project has spent a lot of effort not acting on stories. So it gets measured
 * instead. Regressing daily returns on a candidate driver gives a beta — how
 * much of the driver's move shows up here — and an R², which is the part that
 * matters: how much of this asset's variation the driver explains at all.
 *
 * A high R² with a beta above one is a factual statement that the asset is a
 * leveraged expression of something else, and it cuts both ways. It explains why
 * a name can trade far above what its own cash flows justify, and it says the
 * downside is levered by the same factor. Neither half is a recommendation; both
 * are things the filings cannot tell you.
 */

export type Link = {
  driver: string;
  /** Sensitivity: a 1% move in the driver moves this asset beta%. */
  beta: number;
  /** Share of this asset's daily variation the driver explains, 0-1. */
  rSquared: number;
  correlation: number;
  observations: number;
  /** Annualised volatility of the asset, for context on the leverage. */
  assetVol: number;
  driverVol: number;
};

export type Linkage = {
  /** Strongest explanatory driver, if any clears the bar. */
  primary?: Link;
  all: Link[];
  summary: string;
};

/** Below this the driver explains too little to be worth naming. */
const MIN_R2 = 0.25;
const MIN_OBS = 120;

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

function logReturns(series: { date: string; c: number }[]): Map<string, number> {
  const out = new Map<string, number>();
  for (let i = 1; i < series.length; i++) {
    const a = series[i - 1].c;
    const b = series[i].c;
    if (a > 0 && b > 0) out.set(series[i].date, Math.log(b / a));
  }
  return out;
}

const r2n = (n: number) => Math.round(n * 100) / 100 + 0;

export function measureLinkage(
  asset: { date: string; c: number }[],
  drivers: { name: string; bars: { date: string; c: number }[] }[]
): Linkage | null {
  const ar = logReturns(asset);
  if (ar.size < MIN_OBS) return null;

  const links: Link[] = [];

  for (const d of drivers) {
    const dr = logReturns(d.bars);
    // Only dates both series traded. Crypto trades weekends and equities do
    // not, so an unaligned join would silently compare a two-day crypto move
    // against a one-day equity move and inflate every beta.
    const xs: number[] = [];
    const ys: number[] = [];
    for (const [date, y] of ar) {
      const x = dr.get(date);
      if (x !== undefined) {
        xs.push(x);
        ys.push(y);
      }
    }
    if (xs.length < MIN_OBS) continue;

    const mx = mean(xs);
    const my = mean(ys);
    let cov = 0;
    let vx = 0;
    let vy = 0;
    for (let i = 0; i < xs.length; i++) {
      cov += (xs[i] - mx) * (ys[i] - my);
      vx += (xs[i] - mx) ** 2;
      vy += (ys[i] - my) ** 2;
    }
    if (vx <= 0 || vy <= 0) continue;

    const beta = cov / vx;
    const corr = cov / Math.sqrt(vx * vy);
    links.push({
      driver: d.name,
      beta: r2n(beta),
      rSquared: r2n(corr * corr),
      correlation: r2n(corr),
      observations: xs.length,
      assetVol: r2n(Math.sqrt(vy / (ys.length - 1)) * Math.sqrt(252) * 100),
      driverVol: r2n(Math.sqrt(vx / (xs.length - 1)) * Math.sqrt(252) * 100),
    });
  }

  if (links.length === 0) return null;
  links.sort((a, b) => b.rSquared - a.rSquared);
  const top = links[0];
  const primary = top.rSquared >= MIN_R2 ? top : undefined;

  const summary = primary
    ? `${Math.round(primary.rSquared * 100)}% of its day-to-day movement tracks ${primary.driver}, ` +
      `at ${primary.beta.toFixed(2)}x its moves. ` +
      (primary.beta > 1.3
        ? `Most of what this is, as a holding, is a leveraged position in ${primary.driver} — which is ` +
          `why it can trade far above what its own accounts justify, and why the downside is levered too.`
        : `That linkage explains a large part of the price without appearing anywhere in the filings.`)
    : `No single driver explains more than ${Math.round(top.rSquared * 100)}% of its movement — ` +
      `this one mostly trades on its own news.`;

  return { primary, all: links, summary };
}
