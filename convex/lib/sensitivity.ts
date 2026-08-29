/**
 * How much does each hand-chosen number actually change the answer?
 *
 * A fair share of this app rests on constants somebody picked. Some are now
 * anchored to published evidence — the growth ceiling comes from Chan, Karceski
 * and Lakonishok's measured 90th percentile, the forecast horizons from the same
 * work, the signal multipliers from this project's own calibration. Others are
 * judgement wearing a decimal point: a base margin of safety of 12%, a P/E
 * target of 14 plus 75 times growth, method weights of 0.24 and 0.25 and 0.20.
 *
 * The reasonable complaint is that nobody can tell which is which by looking,
 * and that a number invented in five minutes can quietly dominate the output.
 * Listing the constants does not settle it either — what matters is not whether
 * a value was chosen but whether the conclusion moves when it changes.
 *
 * So each one is perturbed and the effect measured. A constant that shifts fair
 * value by a fraction of a percent is harmless however it was picked. One that
 * swings the answer by a third is load-bearing and has to be defensible. This
 * turns "some of this is arbitrary" from a worry into a ranked list, and the
 * ranking is what tells you where to spend effort.
 */

export type Knob = {
  key: string;
  label: string;
  /** Where the value came from. */
  source: "measured" | "convention" | "judgement";
  /** One line on why it holds the value it does. */
  basis: string;
  value: number;
};

export type KnobEffect = {
  key: string;
  label: string;
  source: Knob["source"];
  basis: string;
  value: number;
  /** Median absolute change in fair value across the sample, in %. */
  medianShift: number;
  /** Largest change seen on any single name, in %. */
  maxShift: number;
  /** How many names changed verdict band as a result. */
  bandChanges: number;
  /** Ranked verdict on how much this number matters. */
  weight: "load-bearing" | "moderate" | "negligible";
};

export type Sensitivity = {
  knobs: KnobEffect[];
  names: number;
  perturbation: number;
  summary: string;
  computedAt: number;
};

/** How far each constant is moved, as a fraction of itself. */
const BUMP = 0.25;

// `+ 0` collapses negative zero, which Math.round produces from any tiny
// negative and Convex then stores as a tagged float the UI cannot format.
const r1 = (n: number) => Math.round(n * 10) / 10 + 0;

/**
 * The constants worth interrogating, with an honest label for where each came
 * from. `apply` re-derives a fair value under the perturbed setting.
 */
export type Sample = {
  ticker: string;
  fairValue: number;
  price?: number;
  marginOfSafety: number;
  dispersion: number;
  methods: { key: string; perShare: number; weight: number }[];
  justifiedGrowth?: number;
  horizonYears?: number;
  discountRate?: number;
  revGrowth?: number;
  grossMargin?: number;
};

function blended(methods: Sample["methods"], overrides: Record<string, number> = {}): number {
  const w = methods.map((m) => ({ ...m, weight: overrides[m.key] ?? m.weight }));
  const total = w.reduce((s, m) => s + m.weight, 0);
  if (total <= 0) return 0;
  return w.reduce((s, m) => s + m.perShare * (m.weight / total), 0);
}

export function analyseSensitivity(samples: Sample[]): Sensitivity | null {
  const usable = samples.filter((s) => s.fairValue > 0 && s.methods?.length);
  if (usable.length < 3) return null;

  const knobs: Knob[] = [
    {
      key: "mosBase",
      label: "Base margin of safety",
      source: "judgement",
      basis: "12% floor before disagreement and coverage widen it. Chosen, not derived.",
      value: 0.12,
    },
    {
      key: "mosDispersion",
      label: "Margin of safety per unit of method disagreement",
      source: "judgement",
      basis: "0.35x the coefficient of variation across methods. Chosen.",
      value: 0.35,
    },
    {
      key: "dcfWeight",
      label: "Weight on the cash-flow method",
      source: "judgement",
      basis: "0.25 of the earnings blend, set so one non-multiple method could outvote a re-rating.",
      value: 0.25,
    },
    {
      key: "epsWeight",
      label: "Weight on the earnings multiple",
      source: "judgement",
      basis: "0.24 of the earnings blend.",
      value: 0.24,
    },
    {
      key: "growthCap",
      label: "Ceiling on justified growth",
      source: "measured",
      basis:
        "18% for a wide moat — the documented 90th percentile of ten-year growth in Chan, Karceski and Lakonishok (2003).",
      value: 0.18,
    },
    {
      key: "peSlope",
      label: "Growth multiplier in the P/E target",
      source: "judgement",
      basis:
        "targetPE = 14 + 75x growth, clamped to 10-45. The slope is the single most invented number in the model — it decides what growth is worth in multiple terms.",
      value: 75,
    },
    {
      key: "peIntercept",
      label: "No-growth P/E floor",
      source: "judgement",
      basis: "The 14 in that formula: what a business growing at zero is deemed worth.",
      value: 14,
    },
    {
      key: "discountRate",
      label: "Discount rate",
      source: "convention",
      basis: "9% base, adjusted for moat and leverage. A conventional equity hurdle, not measured here.",
      value: 0.09,
    },
  ];

  const effects: KnobEffect[] = knobs.map((k) => {
    const shifts: number[] = [];
    let bandChanges = 0;

    for (const s of usable) {
      let bumped = s.fairValue;

      if (k.key === "dcfWeight" || k.key === "epsWeight") {
        const target = k.key === "dcfWeight" ? "expectationsDcf" : "epsMultiple";
        const m = s.methods.find((x) => x.key === target);
        if (!m) continue;
        bumped = blended(s.methods, { [target]: m.weight * (1 + BUMP) });
      } else if (k.key === "peSlope" || k.key === "peIntercept") {
        // The earnings multiple scales with its target, so a change in the
        // target moves that method proportionally before the blend dilutes it.
        const m = s.methods.find((x) => x.key === "epsMultiple");
        if (!m || s.revGrowth === undefined) continue;
        const g = Math.max(-0.2, Math.min(0.6, s.revGrowth));
        const clamp45 = (x: number) => Math.max(10, Math.min(45, x));
        const basePe = clamp45(14 + g * 75);
        const bumpedPe =
          k.key === "peSlope" ? clamp45(14 + g * 75 * (1 + BUMP)) : clamp45(14 * (1 + BUMP) + g * 75);
        if (basePe <= 0) continue;
        const total = s.methods.reduce((sum, x) => sum + x.weight, 0);
        const delta = (m.perShare * (bumpedPe / basePe - 1) * m.weight) / total;
        bumped = s.fairValue + delta;
      } else if (k.key === "growthCap" || k.key === "discountRate") {
        // Both act on the cash-flow method only. A higher cap lifts it; a higher
        // discount rate lowers it. The elasticity used here is deliberately
        // rough — the point is the ranking, not a second decimal place.
        const m = s.methods.find((x) => x.key === "expectationsDcf");
        if (!m) continue;
        const factor = k.key === "growthCap" ? 1 + BUMP * 0.9 : 1 - BUMP * 1.4;
        const total = s.methods.reduce((sum, x) => sum + x.weight, 0);
        const delta = (m.perShare * (factor - 1) * m.weight) / total;
        bumped = s.fairValue + delta;
      } else {
        // The margin-of-safety knobs do not move fair value at all; they move
        // the zone boundaries around it. Measured as the change in the buy
        // threshold rather than in the estimate.
        const mos =
          k.key === "mosBase"
            ? s.marginOfSafety + 0.12 * BUMP
            : s.marginOfSafety + s.dispersion * 0.35 * BUMP;
        const before = s.fairValue * (1 - s.marginOfSafety);
        const after = s.fairValue * (1 - mos);
        shifts.push(Math.abs((after - before) / before) * 100);
        if (s.price && (s.price < before) !== (s.price < after)) bandChanges++;
        continue;
      }

      if (!(bumped > 0)) continue;
      shifts.push(Math.abs((bumped - s.fairValue) / s.fairValue) * 100);
      if (s.price) {
        const wasCheap = s.price < s.fairValue;
        const nowCheap = s.price < bumped;
        if (wasCheap !== nowCheap) bandChanges++;
      }
    }

    const sorted = shifts.sort((a, b) => a - b);
    const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
    const max = sorted.length ? sorted[sorted.length - 1] : 0;

    return {
      key: k.key,
      label: k.label,
      source: k.source,
      basis: k.basis,
      value: k.value,
      medianShift: r1(median),
      maxShift: r1(max),
      bandChanges,
      weight: median >= 8 ? "load-bearing" : median >= 2 ? "moderate" : "negligible",
    };
  });

  effects.sort((a, b) => b.medianShift - a.medianShift);

  const loadBearing = effects.filter((e) => e.weight === "load-bearing");
  const judgementHeavy = loadBearing.filter((e) => e.source === "judgement");

  return {
    knobs: effects,
    names: usable.length,
    perturbation: BUMP,
    summary:
      judgementHeavy.length === 0
        ? `Moving any of these by ${Math.round(BUMP * 100)}% shifts fair value by less than 8% at the median, and nothing load-bearing rests on an unjustified number.`
        : `${judgementHeavy.length} of the ${loadBearing.length} load-bearing constants are judgement rather than measurement: ` +
          judgementHeavy.map((e) => e.label.toLowerCase()).join(", ") +
          `. Those are where the model is most exposed to having been set by hand.`,
    computedAt: Date.now(),
  };
}
