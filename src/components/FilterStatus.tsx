import { Check, RefreshCw } from "lucide-react";

export type FilterSaveResult = "applied" | "refresh-error" | "save-error";
export type FilterStatusState = "idle" | "applying" | "updating" | FilterSaveResult;

export function FilterStatus({ state, draftMessage, progress, applied, error }: {
  state: FilterStatusState; draftMessage?: string;
  progress: string; applied: string; error?: string | null;
}) {
  if (state === "idle" && !draftMessage) return null;
  const busy = !draftMessage && (state === "applying" || state === "updating");
  const failed = !draftMessage && (state === "refresh-error" || state === "save-error");
  const message = draftMessage ?? (busy ? progress
    : state === "save-error" ? "Could not save filters. Please try again."
    : state === "refresh-error" ? "Filters saved, but the list could not be updated. Try again."
    : applied);
  return <p role={failed ? "alert" : "status"} aria-live="polite" title={failed ? error ?? undefined : undefined}
    className={`flex items-center gap-2 text-xs ${failed ? "text-red-500" : busy ? "text-blue-500" : "text-slate-500"}`}>
    {busy ? <RefreshCw size={14} className="shrink-0 animate-spin" aria-hidden="true" />
      : state === "applied" && !draftMessage ? <Check size={14} className="shrink-0" aria-hidden="true" /> : null}
    <span>{message}</span>
  </p>;
}
