import { useState } from "react";
import { CheckSquare, ListChecks, Search, Undo2, X } from "lucide-react";
import type { PaperConfig, PaperDeadlineInfo } from "../types/config";
import { conferenceHasExpired, conferenceManagementRows, conferencePreferenceIds, deadlineConferenceKey, isConferenceFollowed, isConferenceIgnored, matchesDeadlineSearch, resolveConferencePreferences, type ConferencePreference } from "../utils/deadlineKeys";
import { DeadlineConferenceCard } from "./DeadlineConferenceCard";
import { SectionEmptyState } from "./SectionEmptyState";

type View = "all" | "followed" | "ignored";

export function DeadlineConferenceBrowser({ deadlines, config, now, isLight, onPreference, onAdjustFilters, canUndo, onUndo }: {
  deadlines: PaperDeadlineInfo[]; config: PaperConfig; now: number; isLight: boolean;
  onPreference: (ids: string[], action: ConferencePreference, undoable?: boolean) => void;
  onAdjustFilters: () => void; canUndo: boolean; onUndo: () => void;
}) {
  const [view, setView] = useState<View>("all");
  const [query, setQuery] = useState("");
  const [batch, setBatch] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const preferences = resolveConferencePreferences(config, deadlines, now);
  const rows = conferenceManagementRows(deadlines, preferences, now);
  const lists = {
    all: rows.filter(item => !isConferenceIgnored(item, preferences) && !conferenceHasExpired(item, now)),
    followed: rows.filter(item => isConferenceFollowed(item, preferences)),
    ignored: rows.filter(item => isConferenceIgnored(item, preferences)),
  };
  const visible = lists[view].filter(item => matchesDeadlineSearch(item, query));
  const ids = visible.map(deadlineConferenceKey);
  const checked = ids.filter(id => selected.has(id));
  const expired = lists[view].filter(item => conferenceHasExpired(item, now)).map(deadlineConferenceKey);
  const button = `inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${isLight ? "border-slate-200 bg-white text-slate-600 hover:bg-slate-100" : "border-white/10 bg-white/5 text-slate-300 hover:bg-white/10"}`;
  const changeView = (next: View) => { setView(next); setSelected(new Set()); };
  const apply = (keys: string[], action: ConferencePreference) => {
    if (!keys.length) return;
    onPreference(keys, action, true);
    setSelected(new Set());
  };
  const emptyMessage = query.trim() ? "No conferences found."
    : view === "followed" ? "No followed conferences."
    : view === "ignored" ? "No ignored conferences." : "No deadlines match your current filters.";
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="tablist" aria-label="Conference lists" className={`inline-flex gap-1 rounded-xl p-1 ${isLight ? "bg-slate-100" : "bg-white/5"}`}>
          {([['all', 'All'], ['followed', 'Followed'], ['ignored', 'Ignored']] as const).map(([key, label]) => (
            <button key={key} id={`conference-tab-${key}`} type="button" role="tab" aria-selected={view === key} aria-controls="conference-list"
              tabIndex={view === key ? 0 : -1} onKeyDown={event => {
                const keys: View[] = ["all", "followed", "ignored"];
                const index = keys.indexOf(view);
                const next = event.key === "ArrowRight" ? keys[(index + 1) % keys.length]
                  : event.key === "ArrowLeft" ? keys[(index + keys.length - 1) % keys.length]
                  : event.key === "Home" ? keys[0] : event.key === "End" ? keys[2] : undefined;
                if (next) { event.preventDefault(); changeView(next); document.getElementById(`conference-tab-${next}`)?.focus(); }
              }}
              onClick={() => changeView(key)} className={`inline-flex min-h-9 items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold focus-visible:outline-2 focus-visible:outline-blue-500 ${view === key ? isLight ? "bg-white text-slate-900 shadow-sm" : "bg-white/10 text-white" : "text-slate-500 hover:text-blue-500"}`}>
              <span>{label}</span><span className="text-[10px] tabular-nums opacity-65">{lists[key].length}</span>
            </button>
          ))}
        </div>
        <label className={`flex min-h-10 w-full items-center gap-2 rounded-xl border border-[var(--dashboard-border)] px-3 sm:w-80 ${isLight ? "bg-white" : "bg-white/5"}`}>
          <Search aria-hidden="true" size={15} className="shrink-0 text-slate-400" />
          <input type="search" aria-label="Search conferences" placeholder="Search acronym or full name" value={query}
            autoComplete="off" autoCorrect="off" spellCheck={false}
            onChange={event => { setQuery(event.target.value); setSelected(new Set()); }} className="min-w-0 flex-1 bg-transparent py-2 text-xs text-[var(--dashboard-text)] outline-none placeholder:text-slate-400 [&::-webkit-search-cancel-button]:hidden" />
          {query && <button type="button" aria-label="Clear search" title="Clear search" onClick={() => { setQuery(""); setSelected(new Set()); }}
            className="rounded-md p-1 text-slate-500 hover:bg-slate-500/10"><X size={13} /></button>}
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => { setBatch(value => !value); setSelected(new Set()); }} className={button} aria-pressed={batch}>
          <ListChecks size={14} /><span>{batch ? "Finish selecting" : "Bulk manage"}</span>
        </button>
        {view !== "all" && <>
          <button type="button" disabled={!expired.length} onClick={() => apply(expired, view === "followed" ? "unfollow" : "restore")} className={button}>
            <span>Clear expired</span>{expired.length > 0 && <span className="opacity-60">{expired.length}</span>}
          </button>
          <button type="button" disabled={!lists[view].length} onClick={() => apply(conferencePreferenceIds(preferences, view), view === "followed" ? "unfollow" : "restore")} className={button}>
            {view === "followed" ? "Unfollow all" : "Restore all ignored"}
          </button>
        </>}
        {canUndo && <button type="button" onClick={onUndo} className="ml-auto inline-flex min-h-9 items-center gap-1.5 px-2 text-xs font-semibold text-blue-500"><Undo2 size={14} /><span>Undo last change</span></button>}
      </div>
      {batch && <div className={`flex flex-wrap items-center gap-2 rounded-xl border p-3 ${isLight ? "border-blue-200 bg-blue-50" : "border-blue-500/25 bg-blue-500/10"}`}>
        <button type="button" disabled={!ids.length} className={button} onClick={() => setSelected(new Set(checked.length === ids.length ? [] : ids))}>
          <CheckSquare size={14} /><span>{checked.length && checked.length === ids.length ? "Deselect all" : "Select current results"}</span>
        </button>
        <span className="mr-auto text-xs text-slate-500"><span>Selected</span> {checked.length}</span>
        <button type="button" className={button} disabled={!checked.length} onClick={() => apply(checked, "follow")}>Follow selected</button>
        {view === "followed" && <button type="button" className={button} disabled={!checked.length} onClick={() => apply(checked, "unfollow")}>Unfollow selected</button>}
        <button type="button" className={button} disabled={!checked.length} onClick={() => apply(checked, view === "ignored" ? "restore" : "ignore")}>
          {view === "ignored" ? "Restore selected" : "Ignore selected"}
        </button>
      </div>}
      <div id="conference-list" role="tabpanel" aria-labelledby={`conference-tab-${view}`} className="space-y-4">
        {visible.length ? visible.map(item => {
          const id = deadlineConferenceKey(item);
          return <DeadlineConferenceCard key={id} deadline={item} now={now} isLight={isLight}
            selecting={batch} selected={selected.has(id)} onSelect={() => setSelected(previous => {
              const next = new Set(previous); if (next.has(id)) next.delete(id); else next.add(id); return next;
            })}
            isFollowed={isConferenceFollowed(item, preferences)} isIgnored={isConferenceIgnored(item, preferences)}
            onFollow={() => onPreference([id], isConferenceFollowed(item, preferences) ? "unfollow" : "follow")}
            onIgnore={() => onPreference([id], "ignore")} onRestore={() => onPreference([id], "restore")} />;
        }) : <SectionEmptyState message={emptyMessage}
          action={query.trim() ? "Clear search" : view === "all" ? "Adjust filters" : "View all conferences"}
          onAction={() => { if (query.trim()) setQuery(""); else if (view === "all") onAdjustFilters(); else changeView("all"); }} />}
      </div>
    </div>
  );
}
