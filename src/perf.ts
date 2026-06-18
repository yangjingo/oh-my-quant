export function perfEnabled(): boolean {
  const value = process.env.WHYJ_PERF?.toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}

export function perfNow(): number {
  return performance.now();
}

export function perfLog(label: string, startedAt: number, details?: Record<string, string | number | boolean | null | undefined>): void {
  if (!perfEnabled()) return;
  const elapsed = Math.round(performance.now() - startedAt);
  const suffix = details
    ? " " + Object.entries(details)
      .filter((entry): entry is [string, string | number | boolean] => entry[1] !== undefined && entry[1] !== null)
      .map(([key, value]) => `${key}=${sanitizePerfValue(String(value))}`)
      .join(" ")
    : "";
  process.stderr.write(`[whyj:perf] ${label} ${elapsed}ms${suffix}\n`);
}

function sanitizePerfValue(value: string): string {
  return value
    .replace(/\x1b\[[0-9;]*m/g, "")
    .replace(/[\r\n\t]/g, " ");
}
