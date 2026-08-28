/** Client-side mirrors of the dip states, so the UI never imports Convex libs. */
export const DIP_LABEL: Record<string, string> = {
  none: "No pullback",
  falling: "Still falling",
  stabilising: "Selling easing",
  reversing: "Turning up",
  noVolume: "No volume data",
};

export const DIP_COLOR: Record<string, string> = {
  none: "var(--muted)",
  falling: "var(--bad)",
  stabilising: "var(--warn)",
  reversing: "var(--good)",
  noVolume: "var(--muted)",
};
