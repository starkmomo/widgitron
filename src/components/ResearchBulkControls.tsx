import type { ReactNode } from "react";
import { CheckSquare, ListChecks } from "lucide-react";

export const researchButton = (isLight: boolean) => `inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${isLight ? "border-slate-200 bg-white text-slate-600 hover:bg-slate-100" : "border-white/10 bg-white/5 text-slate-300 hover:bg-white/10"}`;

export function ResearchBulkToggle({ enabled, onToggle, isLight, disabled = false, compact = false }: { enabled: boolean; onToggle: () => void; isLight: boolean; disabled?: boolean; compact?: boolean }) {
  return <button type="button" aria-pressed={enabled} aria-label={enabled ? "Finish selecting" : "Bulk selection"} onClick={onToggle} disabled={disabled} className={researchButton(isLight)} title={enabled ? "Finish selecting" : "Bulk selection"}>
    <ListChecks size={14} /><span className={compact ? "sr-only" : undefined}>{enabled ? "Done" : "Select"}</span>
  </button>;
}

export function ResearchBulkControls({ total, selected, onToggleAll, isLight, busy = false, paged = false, children }: {
  total: number; selected: number; onToggleAll: () => void; isLight: boolean; busy?: boolean; paged?: boolean; children: ReactNode;
}) {
  return <div className={`mb-4 rounded-xl border p-3 ${isLight ? "border-blue-200 bg-blue-50" : "border-blue-500/25 bg-blue-500/10"}`}>
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" disabled={!total || busy} className={researchButton(isLight)} onClick={onToggleAll}>
        <CheckSquare size={14} /><span>{selected > 0 && selected === total ? "Deselect all" : paged ? "Select current page" : "Select current results"}</span>
      </button>
      <span className="mr-auto text-xs text-slate-500"><span>Selected</span> <span className="tabular-nums">{selected}</span></span>
      {children}
    </div>
  </div>;
}
