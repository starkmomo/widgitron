import { useCallback, useEffect, useRef, useState } from "react";
import type { ArxivPaperPage } from "../types/tauri";
import { tauriInvoke } from "../utils/tauriInvoke";
import { retainArxivPage } from "../utils/arxivPageTransition";

const emptyPage: ArxivPaperPage = {
  papers: [], data_date: null, total: 0, page: 1, page_size: 100, fresh: false,
};

export function useArxivPaperPages(active: boolean, categories: string[] | undefined, keywords: string[] | undefined, date: string | null) {
  const key = JSON.stringify({ categories: categories ?? [], keywords: keywords ?? [], date });
  const revision = useRef(0);
  const visited = useRef(new Map<string, { page: number; date: string | null }>());
  const [snapshot, setSnapshot] = useState({ key: "", result: emptyPage, loading: false, loaded: false, preservingResults: false, error: null as string | null });

  const load = useCallback(async (page: number, force: boolean) => {
    const request = ++revision.current;
    const query = JSON.parse(key) as { categories: string[]; keywords: string[]; date: string | null };
    // Pin subsequent pages to the first page's date, even if a new day appears meanwhile.
    const args = { ...query, date: query.date ?? (page > 1 ? visited.current.get(key)?.date ?? null : null), page };
    const current = () => request === revision.current;
    setSnapshot(previous => {
      const retained = retainArxivPage(previous.key, previous.result, key);
      return {
        key, result: previous.key === key ? previous.result : retained ?? emptyPage,
        loaded: previous.key === key && previous.loaded, loading: true,
        preservingResults: previous.key === key ? previous.preservingResults : retained !== null,
        error: null,
      };
    });
    const show = (result: ArxivPaperPage, loading: boolean) => {
      visited.current.set(key, { page: result.page, date: result.data_date });
      setSnapshot({ key, result, loading, loaded: true, preservingResults: false, error: null });
    };
    try {
      if (!force) {
        const cache = await tauriInvoke("get_arxiv_paper_page", args);
        if (!current()) return;
        if (cache) {
          show(cache, !cache.fresh);
          if (cache.fresh) return;
        }
      }
      const result = await tauriInvoke("refresh_arxiv_paper_page", { ...args, force });
      if (current()) show(result, false);
    } catch (error) {
      if (current()) setSnapshot(previous => ({ ...previous, loading: false, error: String(error) }));
    }
  }, [key]);

  useEffect(() => {
    if (active) void load(visited.current.get(key)?.page ?? 1, false);
    else {
      // Read existing cache metadata for inactive tabs without making API calls.
      const request = ++revision.current;
      const args = JSON.parse(key) as { categories: string[]; keywords: string[]; date: string | null };
      void tauriInvoke("get_arxiv_paper_page", { ...args, page: 1 }).then(cache => {
        if (request === revision.current && cache) {
          setSnapshot({ key, result: cache, loading: false, loaded: true, preservingResults: false, error: null });
        }
      }).catch(() => {});
    }
    return () => { revision.current++; };
  }, [active, key, load]);

  // Project during render as well: waiting for the effect would produce a
  // one-frame empty list whenever the keyword key changes.
  const retained = retainArxivPage(snapshot.key, snapshot.result, key);
  const result = snapshot.key === key ? snapshot.result : retained ?? emptyPage;
  return {
    ...result,
    loaded: snapshot.key === key && snapshot.loaded,
    loading: active && (snapshot.key !== key || snapshot.loading),
    preservingResults: snapshot.key === key ? snapshot.preservingResults : retained !== null,
    error: snapshot.key === key ? snapshot.error : null,
    refresh: () => load(1, true),
    previousPage: () => load(Math.max(1, result.page - 1), false),
    nextPage: () => load(result.page + 1, false),
    dismissError: () => setSnapshot(previous => ({ ...previous, error: null })),
  };
}
