import { useEffect, useState } from "react";
import { Clock, RefreshCw } from "lucide-react";

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;

function parseResetTime(reset: string): number | null {
  // Cached quota timestamps are local time. Normalize the separator for WebKit.
  const value = reset.trim().replace(" ", "T");
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})?$/.test(value)) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function countdownLabel(remaining: number): string {
  if (remaining <= 0) return "Reset due";
  const hours = Math.floor(remaining / HOUR_MS);
  if (hours === 0) {
    const minutes = Math.floor(remaining / MINUTE_MS);
    return minutes > 0 ? `${minutes}m` : "<1m";
  }
  const days = Math.floor(hours / 24);
  const hoursAfterDays = hours % 24;
  return `${days ? `${days}d` : ""}${hoursAfterDays ? `${hoursAfterDays}h` : ""}`;
}

export function QuotaResetCountdown({ reset, className }: { reset: string; className?: string }) {
  const resetAt = parseResetTime(reset);
  const [now, setNow] = useState(Date.now);

  useEffect(() => {
    if (resetAt === null) return;
    let timer: number | undefined;
    const update = () => {
      window.clearTimeout(timer);
      const current = Date.now();
      setNow(current);
      const remaining = resetAt - current;
      if (remaining > 0) {
        const unit = remaining < HOUR_MS ? MINUTE_MS : HOUR_MS;
        timer = window.setTimeout(update, Math.min(remaining, remaining % unit + 1));
      }
    };
    update();
    window.addEventListener("focus", update);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("focus", update);
    };
  }, [resetAt]);

  const title = `Reset: ${reset}`;
  const style = `tabular-nums ${className ?? ""}`;
  if (resetAt === null) return <span className={style} title={title}>{title}</span>;

  return (
    <time className={style} dateTime={new Date(resetAt).toISOString()} title={title}>
      {countdownLabel(resetAt - now)}
    </time>
  );
}

export function QuotaLastUpdated({ updated, onRefresh, refreshing, disabled, className }: {
  updated?: string | null;
  onRefresh: () => void;
  refreshing: boolean;
  disabled?: boolean;
  className?: string;
}) {
  const shortTime = updated?.match(/^\d{4}-\d{2}-\d{2}[ T](\d{2}:\d{2})/)?.[1] ?? updated;
  const updateTitle = `Last Update: ${updated || "Never"}`;
  const title = disabled || refreshing ? updateTitle : `${updateTitle}\nClick to refresh quotas`;

  return (
    <button type="button" onClick={onRefresh} disabled={disabled || refreshing} aria-busy={refreshing}
      aria-label="Refresh Quotas" title={title}
      className={`-my-1 -mr-1 inline-flex shrink-0 cursor-pointer items-center gap-1 rounded px-1 py-1 whitespace-nowrap tabular-nums hover:bg-slate-500/10 disabled:cursor-default disabled:hover:bg-transparent ${className ?? ""}`}>
      {refreshing ? <RefreshCw size="1em" className="animate-spin" aria-hidden="true" /> : <Clock size="1em" aria-hidden="true" />}
      {shortTime}
    </button>
  );
}
