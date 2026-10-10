import type { ArxivPaper } from "../types/config";

const ARXIV_ID = /^(?:\d{4}\.\d{4,5}|[a-z][a-z\d.-]*\/\d{7})(?:v\d+)?$/i;

// Cached papers often store a PDF URL in `link`; `id` normally contains the
// abstract URL. Normalize both so opening a paper always uses its arXiv page.
export function arxivPaperLinks(paper: Pick<ArxivPaper, "id" | "link">) {
  for (const source of [paper.id, paper.link]) {
    let id = source.trim();
    if (/^https?:\/\//i.test(id)) {
      try {
        const url = new URL(id);
        if (!["arxiv.org", "www.arxiv.org", "export.arxiv.org"].includes(url.hostname)) continue;
        if (!/^\/(abs|pdf)\//.test(url.pathname)) continue;
        id = url.pathname.replace(/^\/(abs|pdf)\//, "");
      } catch {
        continue;
      }
    }
    id = id.replace(/\.pdf$/i, "");
    if (ARXIV_ID.test(id)) {
      return { id, pageUrl: `https://arxiv.org/abs/${id}` };
    }
  }
  return null;
}
