"use client";

/** Inline SVG, no chart library — a card should not pay for one. */
export function Sparkline({
  values,
  width = 120,
  height = 34,
  color,
}: {
  values?: number[];
  width?: number;
  height?: number;
  color?: string;
}) {
  if (!values || values.length < 2) {
    return <div style={{ width, height }} className="rounded bg-[var(--panel-2)]" />;
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const step = width / (values.length - 1);

  const points = values.map((v, i) => {
    const x = i * step;
    // 2px inset top and bottom so the stroke is never clipped
    const y = height - 2 - ((v - min) / span) * (height - 4);
    return [x, y] as const;
  });

  const line = points.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `${line} L${width},${height} L0,${height} Z`;
  const stroke = color ?? (values[values.length - 1] >= values[0] ? "var(--good)" : "var(--bad)");
  const id = `spark-${Math.round(min * 100)}-${values.length}`;

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden>
      <defs>
        <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.22" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${id})`} />
      <path d={line} fill="none" stroke={stroke} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
