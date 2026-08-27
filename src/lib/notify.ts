export type Severity = "critical" | "high" | "medium";

const RANK: Record<Severity, number> = { medium: 1, high: 2, critical: 3 };

export type NotifyPrefs = {
  enabled: boolean;
  minSeverity: Severity;
  mutedTypes: string[];
};

export type AlertLike = { type: string; severity: Severity; acknowledgedAt?: number };

/**
 * Preferences filter what is *shown*, never what is recorded. Every alert stays
 * in the table so muting a type today does not erase history.
 */
export function visibleAlerts<T extends AlertLike>(alerts: T[], prefs?: NotifyPrefs): T[] {
  if (!prefs || !prefs.enabled) return [];
  return alerts.filter(
    (a) => RANK[a.severity] >= RANK[prefs.minSeverity] && !prefs.mutedTypes.includes(a.type)
  );
}

export const SEVERITY_COLOR: Record<Severity, string> = {
  critical: "var(--bad)",
  high: "var(--warn)",
  medium: "var(--muted)",
};
