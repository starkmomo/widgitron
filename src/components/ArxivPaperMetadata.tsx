import type { ArxivPaper } from "../types/config";

export function ArxivPaperMetadata({ paper, full = false, compact = false, isLight, color, className = "" }: {
  paper: Pick<ArxivPaper, "authors"> & Partial<Pick<ArxivPaper, "published">>;
  full?: boolean;
  compact?: boolean;
  isLight: boolean;
  color?: string;
  className?: string;
}) {
  const authors = (paper.authors || []).map(author => author.trim()).filter(Boolean);
  const authorText = full ? authors.join(", ") : `${authors[0] || ""}${authors.length > 1 ? " et al." : ""}`;
  const published = paper.published ? new Date(paper.published) : null;
  const publishedDay = published && Number.isFinite(published.getTime()) ? published.toISOString().slice(0, 10) : null;
  const authorClass = compact && !full
    ? "arxiv-paper-meta inline-block max-w-full truncate rounded-full bg-white/5 px-2 py-0.5 align-top font-medium"
    : "break-words";

  return <div className={`min-w-0 ${full ? "space-y-1 text-xs leading-snug" : compact ? "text-[8px]" : "text-[10px]"} ${isLight ? "text-slate-500" : "text-slate-400"} ${className}`} style={{ color }}>
    {authors.length > 0
      ? <p data-no-localize className={authorClass}>{authorText}</p>
      : <p className={authorClass}>Unknown Author</p>}
    {full && publishedDay && <p className="flex flex-wrap items-baseline gap-x-1.5">
      <span>Submission date (UTC)</span>
      <time dateTime={paper.published} data-no-localize className="whitespace-nowrap tabular-nums">{publishedDay}</time>
    </p>}
  </div>;
}
