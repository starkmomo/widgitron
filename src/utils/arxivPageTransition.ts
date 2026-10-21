import type { ArxivPaperPage } from "../types/tauri";
import { normalizeArxivKeyword, paperMatchesArxivKeyword } from "./arxivKeywords";

interface PageQuery {
  categories: string[];
  keywords: string[];
  date: string | null;
}

const normalized = (values: string[]) => [...new Set(values.map(normalizeArxivKeyword).filter(Boolean))].sort();

/** Retain readable results across keyword edits, never across categories or dates. */
export function retainArxivPage(previousKey: string, previous: ArxivPaperPage, nextKey: string): ArxivPaperPage | null {
  if (!previousKey || previousKey === nextKey) return null;
  const before = JSON.parse(previousKey) as PageQuery;
  const after = JSON.parse(nextKey) as PageQuery;
  if (before.date !== after.date
    || JSON.stringify(normalized(before.categories)) !== JSON.stringify(normalized(after.categories))) return null;
  const oldKeywords = normalized(before.keywords);
  const nextKeywords = normalized(after.keywords);
  // An unfiltered page cannot stand in for a new keyword query.
  if (!oldKeywords.length || !nextKeywords.length) return null;
  const onlyAdded = oldKeywords.every(keyword => nextKeywords.includes(keyword));
  const papers = onlyAdded ? previous.papers : previous.papers.filter(paper =>
    nextKeywords.some(keyword => paperMatchesArxivKeyword(paper, keyword)));
  return { ...previous, papers, fresh: false };
}
