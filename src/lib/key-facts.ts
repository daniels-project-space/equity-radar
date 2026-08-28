/**
 * The three or four things worth knowing about a company right now.
 *
 * This replaces a list of stored alert rows. Those were written at evaluation
 * time and never expired, so a Strategy page could show "price is above $6.57,
 * the top of the 6x anchor" months after the model had been taught that a
 * bitcoin treasury is not valued on an earnings multiple. A stale sentence
 * stated confidently is worse than no sentence.
 *
 * Everything below is derived from the current numbers on every render, so it
 * cannot disagree with the chart above it. Facts are ranked by how much they
 * should change a decision and then cut to a handful — the point is to be read,
 * not to be complete. The disclosures underneath hold the full detail.
 *
 * Each line is one sentence, with the number in it, in words that mean
 * something without knowing how the model works. "Asymmetry 26.8 -> 32.4" is
 * not information unless you already know what asymmetry is.
 */

export type Tone = "good" | "warn" | "bad" | "neutral";
export type Fact = { tone: Tone; text: string; weight: number };

export const TONE_COLOR: Record<Tone, string> = {
  good: "var(--good)",
  warn: "var(--warn)",
  bad: "var(--bad)",
  neutral: "var(--muted)",
};

type Input = {
  ticker: string;
  price?: {
    last?: number;
    prevClose?: number;
    ret3m?: number;
    drawdownFromHigh?: number;
    wk52High?: number;
    wk52Low?: number;
  };
  bands?: {
    fairValue?: number;
    upside?: number;
    currentBand?: string;
    confidence?: string;
    dispersion?: number;
    anchorLabel?: string;
    archetype?: string;
  };
  metrics?: {
    moatScore?: number;
    moatTrend?: number;
    sharesYoY?: number;
    grossMarginPct?: number;
    grossMarginDeltaYoY?: number;
    revYoY?: number;
    revAccel?: number;
    fcfMarginPct?: number;
    netDebtToEbitda?: number;
    expectations?: {
      impliedGrowth?: number;
      referenceGrowth?: number;
      verdict?: string;
    };
  };
  score?: { verdict?: string };
};

const money = (n: number) =>
  n >= 1000 ? `$${Math.round(n).toLocaleString()}` : `$${n.toFixed(2)}`;
const pc = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;

export function keyFacts(d: Input): Fact[] {
  const out: Fact[] = [];
  const price = d.price?.last;
  const b = d.bands;
  const m = d.metrics;
  const e = m?.expectations;

  // 1. Where the price sits, and against what. This is the headline because it
  //    is the only fact that directly answers "should I buy it today".
  if (price && b?.fairValue) {
    const up = b.upside ?? (b.fairValue / price - 1) * 100;
    const cheap = up > 0;
    out.push({
      tone: up > 15 ? "good" : up > -15 ? "neutral" : "bad",
      weight: 100,
      text:
        `At ${money(price)} it trades ${Math.abs(up).toFixed(0)}% ${cheap ? "below" : "above"} ` +
        `a fair value of ${money(b.fairValue)}` +
        (b.currentBand ? `, which puts it in the ${b.currentBand.toLowerCase()} band.` : "."),
    });
  }

  // 2. What that price is asking the business to do. The one line that stays
  //    useful when every name on the list looks expensive at once.
  if (e?.verdict && e.verdict !== "unpriceable" && e.impliedGrowth !== undefined) {
    const ref = e.referenceGrowth;
    out.push({
      tone:
        e.verdict === "heroic"
          ? "bad"
          : e.verdict === "demanding"
            ? "warn"
            : e.verdict === "undemanding"
              ? "good"
              : "neutral",
      weight: 95,
      text:
        `Buying here assumes ${e.impliedGrowth.toFixed(0)}% growth in cash flow` +
        (ref === undefined
          ? "."
          : ref >= e.impliedGrowth
            ? `, less than the ${ref.toFixed(0)}% it has been delivering.`
            : `, against the ${ref.toFixed(0)}% it has been delivering.`),
    });
  } else if (e?.verdict === "unpriceable") {
    out.push({
      tone: "neutral",
      weight: 60,
      text:
        "It does not generate free cash flow, so the price cannot be translated into a growth " +
        "assumption — judge this one on assets and the path to cash.",
    });
  }

  // 3. Moat, said as a direction rather than a score.
  if (m?.moatScore !== undefined) {
    const t = m.moatTrend ?? 0;
    const dir = t > 10 ? "widening" : t < -10 ? "narrowing" : "holding steady";
    out.push({
      tone: t < -10 ? "warn" : t > 10 ? "good" : "neutral",
      weight: 70 + Math.abs(t) / 4,
      text:
        `Competitive position scores ${Math.round(m.moatScore)} out of 100 and is ${dir}` +
        (m.moatScore >= 70
          ? " — the kind of durability that justifies paying up."
          : m.moatScore < 40
            ? " — thin enough that a stumble would show up quickly."
            : "."),
    });
  }

  // 4. Dilution, but only when it is big enough to matter to a per-share number.
  if (m?.sharesYoY !== undefined && Math.abs(m.sharesYoY) > 0.03) {
    const up = m.sharesYoY > 0;
    out.push({
      tone: up ? "warn" : "good",
      weight: 55 + Math.abs(m.sharesYoY) * 100,
      text: up
        ? `Share count grew ${pc(m.sharesYoY * 100)} over the year, so some of the growth per share is being paid for by issuing stock.`
        : `Share count shrank ${(Math.abs(m.sharesYoY) * 100).toFixed(1)}%, quietly adding to per-share results.`,
    });
  }

  // 5. Margin direction, in basis points as filed.
  if (m?.grossMarginDeltaYoY !== undefined && Math.abs(m.grossMarginDeltaYoY) >= 100) {
    const down = m.grossMarginDeltaYoY < 0;
    out.push({
      tone: down ? "warn" : "good",
      weight: 50 + Math.abs(m.grossMarginDeltaYoY) / 50,
      text:
        `Gross margin ${down ? "fell" : "rose"} ${Math.abs(Math.round(m.grossMarginDeltaYoY))} basis points ` +
        `over the year` +
        (m.grossMarginPct !== undefined ? `, to ${(m.grossMarginPct * 100).toFixed(1)}%.` : "."),
    });
  }

  // 6. Growth turning, which usually leads everything else.
  if (m?.revAccel !== undefined && Math.abs(m.revAccel) >= 5) {
    const acc = m.revAccel > 0;
    out.push({
      tone: acc ? "good" : "warn",
      weight: 60 + Math.abs(m.revAccel) / 3,
      text:
        `Revenue growth is ${acc ? "accelerating" : "slowing"} — ` +
        `${Math.abs(m.revAccel).toFixed(0)} points ${acc ? "faster" : "slower"} than the prior year` +
        (m.revYoY !== undefined ? `, now ${(m.revYoY * 100).toFixed(0)}%.` : "."),
    });
  }

  // 7. Position against the 52-week high.
  //
  // This is here because it is the best-supported pattern found anywhere in
  // this project, and it points away from buying weakness. George and Hwang
  // documented that stocks near their 52-week high subsequently outperform
  // those far from it; this project's own calibration independently put "at
  // high" as the strongest of 37 buckets tested (+5.0pp over baseline, 67%
  // positive); and pooled across the watchlist, entries taken below the
  // 200-day trend returned a median 10.8% over 120 days against 20.9% for
  // entries above it.
  //
  // It is reported as context rather than instruction: none of it clears
  // statistical significance on this sample, and it split 7 names to 7 on
  // which side won.
  if (price && d.price?.wk52High && d.price.wk52High > 0) {
    const near = price / d.price.wk52High;
    const off = (1 - near) * 100;
    if (near >= 0.95) {
      out.push({
        tone: "neutral",
        weight: 52,
        text: `Trading within ${off < 1 ? "a percent" : `${off.toFixed(0)}%`} of its 52-week high — historically the side of the range that has done better, though not reliably enough to act on alone.`,
      });
    } else if (off >= 25) {
      out.push({
        tone: "warn",
        weight: 54,
        text: `It sits ${off.toFixed(0)}% below its 52-week high. Deep discounts have not been where returns came from on this watchlist — buying strength beat buying weakness by roughly 10 points over 120 days.`,
      });
    }
  }

  // 8. Leverage, only when it constrains the decision.
  if (m?.netDebtToEbitda !== undefined && m.netDebtToEbitda > 3) {
    out.push({
      tone: "warn",
      weight: 58,
      text: `Net debt is ${m.netDebtToEbitda.toFixed(1)}x earnings before interest and tax — enough that a weak year gets uncomfortable.`,
    });
  }

  // 9. How much to trust any of the above.
  if (b?.confidence === "low") {
    out.push({
      tone: "warn",
      weight: 45,
      text: "The valuation methods disagree widely here, so treat the fair value as a range rather than a number.",
    });
  }

  return out.sort((a, z) => z.weight - a.weight).slice(0, 5);
}
