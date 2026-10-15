import { ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";

export function ArxivPagination({ page, pageSize, total, loading, onPrevious, onNext, isLight }: {
  page: number; pageSize: number; total: number; loading: boolean;
  onPrevious: () => void; onNext: () => void; isLight: boolean;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const button = `inline-flex items-center gap-1 rounded-lg border border-[var(--dashboard-border)] px-3 py-2 text-xs font-semibold disabled:opacity-40 disabled:cursor-default ${isLight ? "bg-white text-slate-700 hover:enabled:bg-slate-50" : "bg-white/5 text-white/80 hover:enabled:bg-white/10"}`;
  return (
    <nav aria-label="Paper pagination" className="mt-6 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-500">
      <span data-no-localize>{Math.min((page - 1) * pageSize + 1, total)}–{Math.min(page * pageSize, total)} / {total}</span>
      <div className="flex items-center gap-3">
        {loading && <RefreshCw size={14} className="animate-spin" aria-label="Loading papers" />}
        <button type="button" className={button} disabled={loading || page <= 1} onClick={onPrevious}><ChevronLeft size={14} />Previous page</button>
        <span data-no-localize className="tabular-nums">{page} / {pages}</span>
        <button type="button" className={button} disabled={loading || page >= pages} onClick={onNext}>Next page<ChevronRight size={14} /></button>
      </div>
    </nav>
  );
}
