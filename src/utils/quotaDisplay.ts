import type { QuotaBar, QuotaItem } from "../types/config";
import { messageShowsCached } from "./cachedLabels";

export type QuotaDisplayItem = Pick<
  QuotaItem,
  "current_value" | "error_msg" | "bars"
>;

export function isStaleQuotaWarning(msg: string | null | undefined): boolean {
  if (!msg) return false;
  const lower = msg.toLowerCase();
  // Soft retention only — hard fetch errors should render as errors even if
  // last-known values are still displayed.
  return (
    lower.includes("showing cached") ||
    messageShowsCached(msg) ||
    lower.includes("retaining last") ||
    lower.includes("offline —") ||
    lower.includes("offline -")
  );
}

export function quotaHasDisplayValue(q: QuotaDisplayItem): boolean {
  if (q.bars && q.bars.length > 0) return true;
  return q.current_value !== undefined && q.current_value !== null;
}

export function quotaErrorClassName(q: QuotaDisplayItem, staleSuffix: string, errorSuffix: string): string {
  const stale = isStaleQuotaWarning(q.error_msg) && quotaHasDisplayValue(q);
  return stale ? staleSuffix : errorSuffix;
}

const QUOTA_BAR_PROVIDERS = new Set([
  "codex", "cursor", "antigravity", "copilot", "pioneer", "qoder-cn", "claude-code",
]);

export function getQuotaBarDisplay(q: QuotaItem): {
  bars: QuotaBar[];
  cardReset: QuotaItem["primary_reset"];
} {
  const { secondary_value: secondary, tertiary_value: tertiary } = q;
  const hasSecondary = secondary != null;
  const hasTertiary = tertiary != null;
  const usesBars = q.current_value != null && QUOTA_BAR_PROVIDERS.has(q.provider) &&
    (q.bars?.length || q.provider === "copilot" || hasSecondary || hasTertiary);

  if (!usesBars) return { bars: [], cardReset: q.primary_reset };

  const cardReset = q.provider === "cursor" || q.provider === "copilot" ? q.primary_reset : null;
  if (q.bars?.length) return { bars: q.bars, cardReset };

  const bars = [{ value: q.current_value ?? 0, name: q.primary_name || "Usage", reset: q.primary_reset }];
  if (hasSecondary) {
    bars.push({ value: secondary, name: q.secondary_name || "", reset: q.secondary_reset });
  }
  if (hasTertiary) {
    bars.push({ value: tertiary, name: q.tertiary_name || "", reset: q.tertiary_reset });
  }
  return { bars, cardReset };
}

export function orderQuotaByConfig<T extends { id: string }>(
  quotaData: T[],
  configItems: { id: string }[] | undefined | null,
): T[] {
  if (!configItems || configItems.length === 0) {
    return quotaData;
  }
  const byId = new Map(quotaData.map((q) => [q.id, q]));
  return configItems
    .map((cfg) => byId.get(cfg.id))
    .filter((q): q is T => q !== undefined);
}
