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

function getArxivKeywordTerms(keyword: string): string[] {
  return normalizeArxivKeyword(keyword)
    .split(/\s+/)
    .map((term) => term.replace(/^[^a-z0-9]+|[^a-z0-9]+$/gi, ""))
    .filter(Boolean);
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

/** Spaces belong to a phrase; commas, semicolons and line breaks separate entries. */
export function parseArxivKeywordInput(input: string): string[] {
  return getArxivKeywords(input.split(/[,，;；\r\n]+/).map(value => value.trim().replace(/\s+/g, " ")));
}

export function appendArxivKeywords(keywords: string[], input: string): string[] {
  // Also repair legacy entries entered with Chinese separators in the old field.
  return getArxivKeywords([...keywords.flatMap(parseArxivKeywordInput), ...parseArxivKeywordInput(input)]);
}

export function hasArxivKeywords(keywords?: string[]): boolean {
  return getArxivKeywords(keywords).some(keyword => /[\p{L}\p{N}]/u.test(keyword));
}

export function paperMatchesArxivKeyword(paper: ArxivPaper, keyword: string): boolean {
  const normalized = normalizeArxivKeyword(keyword);
  if (!normalized) return false;

  if ((paper.matched_keywords || []).some((matched) => normalizeArxivKeyword(matched) === normalized)) {
    return true;
  }

  const haystack = `${paper.title} ${paper.summary}`.toLowerCase();
  if (haystack.includes(normalized)) return true;

  const terms = getArxivKeywordTerms(keyword);
  return terms.length > 0 && terms.every((term) => haystack.includes(term));
}

export function getPaperArxivKeywords(paper: ArxivPaper, keywords?: string[]): string[] {
  return getArxivKeywords(keywords).filter((keyword) => paperMatchesArxivKeyword(paper, keyword));
}

export function groupArxivPapersByKeyword(papers: ArxivPaper[], keywords?: string[]): ArxivKeywordGroup[] {
  const configuredKeywords = getArxivKeywords(keywords);
  if (configuredKeywords.length === 0) {
    return papers.length > 0 ? [{ keyword: ALL_ARXIV_KEYWORDS, papers }] : [];
  }
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
  if (keyword === ALL_ARXIV_KEYWORDS) return "All papers";
  return keyword === UNCATEGORIZED_ARXIV_KEYWORD ? "Other matches" : keyword;
}
