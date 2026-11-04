/** Smallest "clean" axis maximum (1, 2, 2.5, 4, 5 or 10 × 10ⁿ) at or above `value`; never below 1. */
export function niceAxisMax(value: number): number {
  if (!Number.isFinite(value) || value <= 1) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const step = [1, 2, 2.5, 4, 5, 10].find((s) => s * magnitude >= value) ?? 10;
  return step * magnitude;
}

/** Short axis label: 950, 1.5K, 1.2M. */
export function compactNumber(n: number): string {
  const abs = Math.abs(n);
  const short = (v: number) => String(Math.round(v * 10) / 10);
  if (abs >= 1_000_000) return `${short(n / 1_000_000)}M`;
  if (abs >= 1_000) return `${short(n / 1_000)}K`;
  return short(n);
}
