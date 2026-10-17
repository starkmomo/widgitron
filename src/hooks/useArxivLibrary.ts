import { useCallback, useEffect, useRef, useState } from "react";
import type { ArxivPaper } from "../types/config";
import type { ArxivPaperAction, ArxivReadingState } from "../types/tauri";
import { arxivPaperLinks } from "../utils/arxivPaperLinks";
import { tauriInvoke } from "../utils/tauriInvoke";
import { tauriListen } from "../utils/tauriListen";
import { startWindowSnapshotSync } from "../utils/windowSnapshotSync";

export function arxivPaperKey(paper: ArxivPaper) {
  return (arxivPaperLinks(paper)?.id ?? paper.id).replace(/v\d+$/, "");
}

export function useArxivLibrary(active = true) {
  const [snapshot, setSnapshot] = useState<ArxivReadingState>({ revision: -1, batch: "", saved: [], skipped: [] });
  const [pending, setPending] = useState<Set<string>>(new Set());
  const pendingRef = useRef(new Set<string>());
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(false);
  const apply = useCallback((next: ArxivReadingState) => {
    if (mounted.current) setSnapshot(previous => next.revision >= previous.revision ? next : previous);
  }, []);

  useEffect(() => {
    mounted.current = true;
    if (!active) return () => { mounted.current = false; };
    const sync = startWindowSnapshotSync<ArxivReadingState>({
      listen: handler => tauriListen("arxiv_library_update", event => handler(event.payload)),
      read: () => tauriInvoke("get_arxiv_reading_state"),
      apply,
      onError: error => { if (mounted.current) setError(String(error)); },
    });
    return () => { mounted.current = false; sync.stop(); };
  }, [active, apply]);

  const actMany = useCallback(async (papers: ArxivPaper[], action: ArxivPaperAction) => {
    if (!papers.length || pendingRef.current.size > 0) return false;
    const keys = papers.map(arxivPaperKey);
    keys.forEach(key => pendingRef.current.add(key));
    setPending(new Set(pendingRef.current));
    setError(null);
    try {
      apply(await tauriInvoke("set_arxiv_papers_status", { papers, action }));
      return true;
    } catch (error) {
      if (mounted.current) setError(String(error));
      return false;
    } finally {
      keys.forEach(key => pendingRef.current.delete(key));
      if (mounted.current) setPending(new Set(pendingRef.current));
    }
  }, [apply]);
  const act = useCallback((paper: ArxivPaper, action: ArxivPaperAction) => actMany([paper], action), [actMany]);

  return {
    ...snapshot, act, actMany, busy: pending.size > 0, error, dismissError: () => setError(null),
    isSaved: (paper: ArxivPaper) => snapshot.saved.some(saved => arxivPaperKey(saved) === arxivPaperKey(paper)),
    isSkipped: (paper: ArxivPaper) => snapshot.skipped.some(skipped => arxivPaperKey(skipped) === arxivPaperKey(paper)),
    isPending: (_paper: ArxivPaper) => pending.size > 0,
  };
}

export type ArxivLibrary = ReturnType<typeof useArxivLibrary>;
