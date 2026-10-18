import { useState } from "react";
import { Bookmark, RotateCcw } from "lucide-react";
import { arxivPaperKey, type ArxivLibrary } from "../hooks/useArxivLibrary";
import { useResearchSelection } from "../hooks/useResearchSelection";
import { arxivPaperLinks } from "../utils/arxivPaperLinks";
import { tauriInvoke } from "../utils/tauriInvoke";
import { ResearchListDialog } from "./ResearchListDialog";
import { ResearchBulkControls, ResearchBulkToggle } from "./ResearchBulkControls";
import { ArxivBulkActions } from "./ArxivBulkActions";

export function ArxivSkippedDialog({ library, isLight, compact = false }: { library: ArxivLibrary; isLight: boolean; compact?: boolean }) {
  const [openError, setOpenError] = useState(false);
  const selection = useResearchSelection(library.skipped, arxivPaperKey, library.batch);
  return <ResearchListDialog title="Ignored papers" label="Ignored" closeLabel="Close ignored papers" count={library.skipped.length} isLight={isLight} compact={compact}
    onClose={() => { selection.finish(); setOpenError(false); }}
    tools={<ResearchBulkToggle enabled={selection.enabled} onToggle={selection.toggleMode} isLight={isLight} disabled={library.busy} compact={compact} />}
    error={(library.error || openError) && <p role="alert" className="px-5 py-2 text-xs text-red-500" title={library.error ?? undefined}>{openError ? "Could not open arXiv page." : "Could not update paper. Please try again."}</p>}
    toolbar={selection.enabled && <ResearchBulkControls total={library.skipped.length} selected={selection.chosen.length} onToggleAll={selection.toggleAll} isLight={isLight} busy={library.busy}>
      <ArxivBulkActions chosen={selection.chosen} library={library} isLight={isLight} restoring onDone={selection.clear} />
    </ResearchBulkControls>}>
    {library.skipped.length === 0 ? <p className="py-10 text-center text-sm text-slate-500">No ignored papers in this batch.</p> : <ul className={isLight ? "divide-y divide-slate-100" : "divide-y divide-slate-800"}>
      {library.skipped.map(paper => <li key={paper.id} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 py-4">
        {selection.enabled && <input type="checkbox" checked={selection.has(paper)} onChange={() => selection.toggle(paper)} disabled={library.busy} aria-label={paper.title} className="mt-0.5 size-4 shrink-0 accent-blue-600" />}
        <button type="button" data-no-localize className="min-w-0 flex-1 basis-64 text-left text-sm font-medium leading-snug break-words hover:text-blue-500 hover:underline" onClick={async () => {
          if (selection.enabled) { selection.toggle(paper); return; }
          const links = arxivPaperLinks(paper); if (!links) return;
          try { await tauriInvoke("open_link", { url: links.pageUrl }); setOpenError(false); } catch { setOpenError(true); }
        }}>{paper.title}</button>
        {!selection.enabled && <div className="flex shrink-0 flex-wrap items-center gap-2 text-xs">
          <button type="button" disabled={library.isPending(paper)} className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-slate-500 hover:bg-blue-500/10 hover:text-blue-500 disabled:opacity-50" onClick={() => void library.act(paper, "restore")}><RotateCcw size={13} /><span>Return to reading list</span></button>
          <button type="button" disabled={library.isPending(paper)} className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-blue-500 hover:bg-blue-500/10 disabled:opacity-50" onClick={() => void library.act(paper, "save")}><Bookmark size={13} /><span>Bookmark</span></button>
        </div>}
      </li>)}
    </ul>}
  </ResearchListDialog>;
}
