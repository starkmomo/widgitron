import type { ArxivPaper } from "../types/config";
import type { ArxivPaperAction } from "../types/tauri";
import type { ArxivLibrary } from "../hooks/useArxivLibrary";
import { researchButton } from "./ResearchBulkControls";

export function ArxivBulkActions({ chosen, library, isLight, allowSkip = false, restoring = false, onDone }: {
  chosen: ArxivPaper[]; library: ArxivLibrary; isLight: boolean; allowSkip?: boolean; restoring?: boolean; onDone: () => void;
}) {
  const save = chosen.filter(paper => !library.isSaved(paper));
  const unsave = chosen.filter(library.isSaved);
  const skip = chosen.filter(paper => !library.isSaved(paper) && !library.isSkipped(paper));
  const run = async (papers: ArxivPaper[], action: ArxivPaperAction) => { if (await library.actMany(papers, action)) onDone(); };
  const button = researchButton(isLight);
  return <>
    <button type="button" className={button} disabled={library.busy || !save.length} onClick={() => void run(save, "save")}>Save selected papers</button>
    {!restoring && <button type="button" className={button} disabled={library.busy || !unsave.length} onClick={() => void run(unsave, "unsave")}>Unsave selected papers</button>}
    {allowSkip && <button type="button" className={button} disabled={library.busy || !skip.length} onClick={() => void run(skip, "skip")}>Ignore selected papers</button>}
    {restoring && <button type="button" className={button} disabled={library.busy || !chosen.length} onClick={() => void run(chosen, "restore")}>Return selected papers</button>}
  </>;
}
