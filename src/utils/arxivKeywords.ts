import type { ArxivPaper } from "../types/config";

export const ALL_ARXIV_KEYWORDS = "__all__";
export const UNCATEGORIZED_ARXIV_KEYWORD = "__uncategorized__";

export interface ArxivKeywordGroup {
  keyword: string;
  papers: ArxivPaper[];
}

export function normalizeArxivKeyword(keyword: string): string {
  return keyword.trim().replace(/^"|"$/g, "").toLowerCase();
}

export function getArxivKeywords(keywords?: string[]): string[] {
  const seen = new Set<string>();
  return (keywords || []).filter((keyword) => {
    const normalized = normalizeArxivKeyword(keyword);
    if (!normalized || seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
}

export function paperMatchesArxivKeyword(paper: ArxivPaper, keyword: string): boolean {
  const normalized = normalizeArxivKeyword(keyword);
  if (!normalized) return false;

  if ((paper.matched_keywords || []).some((matched) => normalizeArxivKeyword(matched) === normalized)) {
    return true;
  }

  return `${paper.title} ${paper.summary}`.toLowerCase().includes(normalized);
}

export function getPaperArxivKeywords(paper: ArxivPaper, keywords?: string[]): string[] {
  return getArxivKeywords(keywords).filter((keyword) => paperMatchesArxivKeyword(paper, keyword));
}

export function groupArxivPapersByKeyword(papers: ArxivPaper[], keywords?: string[]): ArxivKeywordGroup[] {
  const configuredKeywords = getArxivKeywords(keywords);
  const groups = configuredKeywords.map((keyword) => ({
    keyword,
    papers: papers.filter((paper) => paperMatchesArxivKeyword(paper, keyword)),
  }));

  const uncategorized = papers.filter((paper) => getPaperArxivKeywords(paper, configuredKeywords).length === 0);
  if (uncategorized.length > 0) {
    groups.push({ keyword: UNCATEGORIZED_ARXIV_KEYWORD, papers: uncategorized });
  }

  return groups.filter((group) => group.papers.length > 0);
}

export function filterArxivPapersByKeyword(
  papers: ArxivPaper[],
  selectedKeyword: string,
  keywords?: string[]
): ArxivPaper[] {
  if (selectedKeyword === ALL_ARXIV_KEYWORDS) return papers;
  if (selectedKeyword === UNCATEGORIZED_ARXIV_KEYWORD) {
    return papers.filter((paper) => getPaperArxivKeywords(paper, keywords).length === 0);
  }
  return papers.filter((paper) => paperMatchesArxivKeyword(paper, selectedKeyword));
}


export function filterArxivPapersByKeywords(
  papers: ArxivPaper[],
  selectedKeywords: string[],
  keywords?: string[]
): ArxivPaper[] {
  if (selectedKeywords.length === 0 || selectedKeywords.includes(ALL_ARXIV_KEYWORDS)) return papers;
  return papers.filter((paper) =>
    selectedKeywords.some((keyword) => {
      if (keyword === UNCATEGORIZED_ARXIV_KEYWORD) {
        return getPaperArxivKeywords(paper, keywords).length === 0;
      }
      return paperMatchesArxivKeyword(paper, keyword);
    })
  );
}
export function formatArxivKeywordLabel(keyword: string): string {
  return keyword === UNCATEGORIZED_ARXIV_KEYWORD ? "Other matches" : keyword;
}