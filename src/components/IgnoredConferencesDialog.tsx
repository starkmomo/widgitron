import { RotateCcw, Star } from "lucide-react";
import type { PaperDeadlineInfo } from "../types/config";
import { useResearchSelection } from "../hooks/useResearchSelection";
import { conferenceHasExpired, deadlineConferenceKey, type ConferencePreference } from "../utils/deadlineKeys";
import { ResearchListDialog } from "./ResearchListDialog";
import { ResearchBulkControls, ResearchBulkToggle, researchButton } from "./ResearchBulkControls";

export function IgnoredConferencesDialog({ conferences, now, isLight, saveError, onPreference }: {
  conferences: PaperDeadlineInfo[]; now: number; isLight: boolean; saveError?: boolean;
  onPreference: (ids: string[], action: ConferencePreference, undoable?: boolean) => void;
}) {
  const selection = useResearchSelection(conferences, deadlineConferenceKey, "ignored-conferences");
  const apply = (items: PaperDeadlineInfo[], action: ConferencePreference) => {
    if (!items.length) return;
    onPreference(items.map(deadlineConferenceKey), action, true);
    selection.clear();
  };
  const expired = conferences.filter(conference => conferenceHasExpired(conference, now));
  const button = researchButton(isLight);
  return <ResearchListDialog title="Ignored conferences" label="Ignored" closeLabel="Close ignored conferences" count={conferences.length} isLight={isLight}
    onClose={selection.finish}
    tools={<ResearchBulkToggle enabled={selection.enabled} onToggle={selection.toggleMode} isLight={isLight} />}
    error={saveError && <p role="alert" className="px-5 py-2 text-xs text-red-500">Could not save conference preferences. Please try again.</p>}
    toolbar={selection.enabled && <>
      <ResearchBulkControls total={conferences.length} selected={selection.chosen.length} onToggleAll={selection.toggleAll} isLight={isLight}>
        <button type="button" className={button} disabled={!selection.chosen.length} onClick={() => apply(selection.chosen, "restore")}>Restore selected</button>
        <button type="button" className={button} disabled={!selection.chosen.length} onClick={() => apply(selection.chosen, "follow")}>Follow selected</button>
      </ResearchBulkControls>
      <div className="mb-3 flex flex-wrap gap-2">
        <button type="button" className={button} disabled={!expired.length} onClick={() => apply(expired, "restore")}><span>Clear expired</span><span>({expired.length})</span></button>
        <button type="button" className={button} disabled={!conferences.length} onClick={() => apply(conferences, "restore")}>Restore all ignored</button>
      </div>
    </>}>
    {conferences.length === 0 ? <p className="py-10 text-center text-sm text-slate-500">No ignored conferences.</p> : <ul className={isLight ? "divide-y divide-slate-100" : "divide-y divide-slate-800"}>
      {conferences.map(conference => <li key={deadlineConferenceKey(conference)} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 py-4">
        {selection.enabled && <input type="checkbox" checked={selection.has(conference)} onChange={() => selection.toggle(conference)} aria-label={`${conference.title} ${conference.year}`} className="mt-0.5 size-4 shrink-0 accent-blue-600" />}
        <div className="min-w-0 flex-1 basis-48 text-sm font-medium leading-snug">
          {selection.enabled ? <button type="button" className="text-left" onClick={() => selection.toggle(conference)}>{conference.title} {conference.year}</button> : <span>{conference.title} {conference.year}</span>}
          {conferenceHasExpired(conference, now) && <span className="ml-2 rounded bg-slate-500/10 px-1.5 py-0.5 text-[10px] text-slate-500">Expired</span>}
        </div>
        {!selection.enabled && <div className="flex shrink-0 items-center gap-2 text-xs">
          <button type="button" className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-slate-500 hover:bg-blue-500/10 hover:text-blue-500" onClick={() => apply([conference], "restore")}><RotateCcw size={13} /><span>Restore conference</span></button>
          <button type="button" className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-blue-500 hover:bg-blue-500/10" onClick={() => apply([conference], "follow")}><Star size={13} /><span>Follow conference</span></button>
        </div>}
      </li>)}
    </ul>}
  </ResearchListDialog>;
}
