export const usd = (n?: number | null, dp = 2) =>
  typeof n === "number" && Number.isFinite(n) ? `$${n.toFixed(dp)}` : "—";

export const bigUsd = (n?: number | null) => {
  if (typeof n !== "number" || !Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
};

export const pct = (n?: number | null, dp = 1) =>
  typeof n === "number" && Number.isFinite(n) ? `${(n * 100).toFixed(dp)}%` : "—";

export const signedPct = (n?: number | null, dp = 1) =>
  typeof n === "number" && Number.isFinite(n)
    ? `${n >= 0 ? "+" : ""}${(n * 100).toFixed(dp)}%`
    : "—";

export const mult = (n?: number | null, dp = 1) =>
  typeof n === "number" && Number.isFinite(n) ? `${n.toFixed(dp)}x` : "—";

export const bps = (n?: number | null) =>
  typeof n === "number" && Number.isFinite(n) ? `${n >= 0 ? "+" : ""}${Math.round(n)}bps` : "—";

export const num = (n?: number | null, dp = 1) =>
  typeof n === "number" && Number.isFinite(n) ? n.toFixed(dp) : "—";

export const VERDICT_COLOR: Record<string, string> = {
  STRONG_BUY: "#34d399",
  BUY: "#4ade80",
  ACCUMULATE: "#a3e635",
  HOLD: "#fbbf24",
  TRIM: "#fb923c",
  AVOID: "#f87171",
  INSUFFICIENT_DATA: "#64748b",
};

export const ACTION_COLOR: Record<string, string> = {
  BUY_AGGRESSIVE: "#10b981",
  BUY: "#34d399",
  ACCUMULATE: "#a3e635",
  HOLD: "#fbbf24",
  TRIM: "#f87171",
};

/**
 * A domestic filer is at most ~135 days behind (quarter end + filing window).
 * Beyond that the numbers are a different vintage from the rest of the table,
 * which matters more than it looks when comparing growth rates side by side —
 * foreign private issuers on 20-F/6-K routinely lag by two or three quarters.
 */
export const isStale = (periodEnd?: string) =>
  !!periodEnd && Date.now() - Date.parse(periodEnd) > 150 * 86_400_000;

export const scoreColor = (n?: number) => {
  if (typeof n !== "number") return "#64748b";
  if (n >= 70) return "#34d399";
  if (n >= 55) return "#a3e635";
  if (n >= 40) return "#fbbf24";
  return "#f87171";
};
