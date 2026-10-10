import { useState } from "react";
import { Check, Download, ExternalLink, LoaderCircle } from "lucide-react";
import type { ArxivPaper } from "../types/config";
import { arxivPaperLinks } from "../utils/arxivPaperLinks";
import { tauriInvoke } from "../utils/tauriInvoke";

export function ArxivPaperActions({ paper, compact = false }: {
  paper: Pick<ArxivPaper, "id" | "link">;
  compact?: boolean;
}) {
  const links = arxivPaperLinks(paper);
  const [downloading, setDownloading] = useState(false);
  const [savedPath, setSavedPath] = useState<string | null>(null);
  const [error, setError] = useState<{ message: string; detail: string } | null>(null);
  const iconSize = compact ? 14 : 16;
  const buttonClass = `inline-flex items-center justify-center rounded-lg text-blue-500 hover:bg-blue-500/10 transition-colors disabled:opacity-50 disabled:cursor-default ${compact ? "p-1.5" : "p-2"}`;

  const openPage = async () => {
    if (!links) return;
    setError(null);
    try {
      await tauriInvoke("open_link", { url: links.pageUrl });
    } catch (cause) {
      setError({ message: "Could not open arXiv page.", detail: String(cause) });
    }
  };

  const download = async () => {
    if (!links || downloading) return;
    setDownloading(true);
    setSavedPath(null);
    setError(null);
    try {
      setSavedPath(await tauriInvoke("download_arxiv_pdf", { id: links.id }));
    } catch (cause) {
      setError({ message: "Could not download PDF. Try again.", detail: String(cause) });
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="min-w-0" data-no-drag="true" onPointerDownCapture={(event) => event.stopPropagation()}>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={buttonClass} disabled={!links} onClick={openPage} title="Open arXiv page" aria-label="Open arXiv page">
          <ExternalLink size={iconSize} aria-hidden="true" />
        </button>
        <button type="button" className={buttonClass} disabled={!links || downloading} onClick={download} title={downloading ? "Downloading…" : "Download PDF to Downloads"} aria-label={downloading ? "Downloading…" : "Download PDF to Downloads"}>
          {downloading ? <LoaderCircle size={iconSize} className="animate-spin" aria-hidden="true" /> : <Download size={iconSize} aria-hidden="true" />}
        </button>
      </div>
      <div aria-live="polite" className={compact ? "text-[9px]" : "text-[10px]"}>
        {savedPath && <p className="mt-2 flex items-center gap-1 text-emerald-500" title={savedPath}><Check size={iconSize} aria-hidden="true" /><span>Saved to Downloads</span></p>}
        {error && <p className="mt-2 text-red-500 break-words" title={error.detail}>{error.message}</p>}
      </div>
    </div>
  );
}
