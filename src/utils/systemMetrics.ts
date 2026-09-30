export function formatSystemMemory(bytes: number): string {
  const gib = bytes / (1024 ** 3);
  return `${gib >= 10 ? gib.toFixed(0) : gib.toFixed(1)} GB`;
}

export function formatCpuPercent(percent?: number | null): string {
  return percent == null ? "…" : `${Math.round(percent)}%`;
}
