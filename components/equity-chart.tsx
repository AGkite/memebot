import type { EquityPoint } from "@/lib/types";

export function EquityChart({ points }: { points: EquityPoint[] }) {
  if (points.length < 2) {
    return <p className="text-sm text-muted-foreground">结算或回测跑过之后，这里会出现净值曲线。</p>;
  }

  const width = 640;
  const height = 168;
  const values = points.map((point) => point.equity);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const coords = points.map((point, index) => {
    const x = (index / (points.length - 1)) * width;
    const y = height - 10 - ((point.equity - min) / span) * (height - 20);
    return [x, y] as const;
  });
  const line = coords
    .map(([x, y], index) => `${index === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`)
    .join(" ");
  const up = values[values.length - 1] >= values[0];
  const color = up ? "var(--up)" : "var(--down)";

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-40 w-full" role="img" aria-label="净值曲线">
      <path d={`${line} L${width} ${height} L0 ${height} Z`} fill={color} opacity="0.16" />
      <path d={line} fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round" />
    </svg>
  );
}
