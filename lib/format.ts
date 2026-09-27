export function formatUsd(value: number, digits = 2): string {
  if (!Number.isFinite(value)) return "—";
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `${sign}$${(abs / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 10_000) return `${sign}$${(abs / 1_000).toFixed(1)}K`;
  return `${sign}$${abs.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}`;
}

export function formatPrice(value: number): string {
  if (!Number.isFinite(value) || value === 0) return "—";
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  if (abs >= 1000) return `${sign}$${abs.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
  if (abs >= 1) return `${sign}$${abs.toFixed(4)}`;
  if (abs >= 0.01) return `${sign}$${abs.toFixed(5)}`;
  return `${sign}$${abs.toPrecision(3)}`;
}

export function formatPct(value: number, digits = 1): string {
  if (!Number.isFinite(value)) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(digits)}%`;
}

export function formatAge(minutes: number | null): string {
  if (minutes == null || !Number.isFinite(minutes)) return "未知";
  if (minutes < 90) return `${Math.max(0, Math.floor(minutes))} 分钟`;
  if (minutes < 60 * 48) return `${(minutes / 60).toFixed(1)} 小时`;
  return `${Math.floor(minutes / 1440)} 天`;
}

export function formatTime(ts: number): string {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(ts);
}

export function formatBps(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return `${Math.round(value)} bps`;
}
