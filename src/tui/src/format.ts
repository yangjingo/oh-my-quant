export function fmtPrice(p: number): string {
  if (p >= 10000) return p.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (p >= 1) return p.toFixed(2);
  return p.toFixed(2);
}

export function fmtPct(p: number): string {
  if (Math.abs(p) < 0.001) return "0.00%";
  return `${p > 0 ? "+" : ""}${p.toFixed(2)}%`;
}

export function fmtElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
