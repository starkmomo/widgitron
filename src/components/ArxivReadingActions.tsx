import { Bookmark, RotateCcw, EyeOff } from "lucide-react";
import type { ArxivPaper } from "../types/config";
import type { ArxivLibrary } from "../hooks/useArxivLibrary";

export function ArxivReadingActions({ paper, library, allowSkip = false, compact = false }: {
  paper: ArxivPaper; library: ArxivLibrary; allowSkip?: boolean; compact?: boolean;
}) {
  const saved = library.isSaved(paper);
  const skipped = library.isSkipped(paper);
  const size = compact ? 12 : 14;
  const button = `arxiv-reading-action inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 font-medium transition-colors disabled:opacity-50 hover:bg-blue-500/10 ${compact ? "text-[10px]" : "text-[11px]"}`;
  return (
    <div className="flex flex-wrap items-center gap-1" data-no-drag="true" onPointerDownCapture={event => event.stopPropagation()}>
      <button type="button" disabled={library.isPending(paper)} className={`${button} ${saved ? "text-blue-500 bg-blue-500/10" : "text-slate-500"}`}
        aria-pressed={saved} title={saved ? "Remove from saved" : "Save paper"} onClick={() => void library.act(paper, saved ? "unsave" : "save")}>
        <Bookmark size={size} fill={saved ? "currentColor" : "none"} aria-hidden="true" /><span>{saved ? "Saved" : "Bookmark"}</span>
      </button>
      {(skipped || (allowSkip && !saved)) && (
        <button type="button" disabled={library.isPending(paper)} className={`${button} text-slate-500`} onClick={() => void library.act(paper, skipped ? "restore" : "skip")}>
          {skipped ? <RotateCcw size={size} aria-hidden="true" /> : <EyeOff size={size} aria-hidden="true" />}<span>{skipped ? "Return to reading list" : "Ignore"}</span>
        </button>
      )}
    </div>
  );
}
