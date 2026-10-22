import { useEffect, useState, type ReactNode } from "react";
import { Search, X } from "lucide-react";
import type { PaperConfig, PaperDeadlineInfo } from "../types/config";
import type { UiLanguage } from "../utils/localization";
import { conferenceHasExpired, conferenceManagementRows, conferencePreferenceIds, deadlineConferenceKey, isConferenceFollowed, isConferenceIgnored, matchesDeadlineSearch, resolveConferencePreferences, type ConferencePreference } from "../utils/deadlineKeys";
import { DeadlineConferenceCard } from "./DeadlineConferenceCard";
import { IgnoredConferencesDialog } from "./IgnoredConferencesDialog";
import { ResearchBulkControls, ResearchBulkToggle, researchButton } from "./ResearchBulkControls";
import { SectionEmptyState } from "./SectionEmptyState";
import { ResearchPageHeader, ResearchTabs } from "./ResearchPageHeader";

type View = "all" | "followed";

export interface ConferenceNavigationRequest { view: View; id: number }

export function DeadlineConferenceBrowser({ deadlines, config, now, language, isLight, onPreference, onAdjustFilters, headerActions, saveError, navigationRequest, children }: {
  deadlines: PaperDeadlineInfo[]; config: PaperConfig; now: number; language: UiLanguage; isLight: boolean;
  onPreference: (ids: string[], action: ConferencePreference, undoable?: boolean) => void;
  onAdjustFilters: () => void; headerActions: ReactNode; saveError?: boolean; children?: ReactNode;
  navigationRequest?: ConferenceNavigationRequest | null;
}) {
  const [view, setView] = useState<View>(navigationRequest?.view ?? "all");
  const [query, setQuery] = useState("");
  const [batch, setBatch] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!navigationRequest) return;
    setView(navigationRequest.view);
    setQuery("");
    setBatch(false);
    setSelected(new Set());
  }, [navigationRequest]);
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
  const button = researchButton(isLight);
  const changeView = (next: View) => { setView(next); setSelected(new Set()); };
  const apply = (keys: string[], action: ConferencePreference) => {
    if (!keys.length) return;
    onPreference(keys, action, true);
    setSelected(new Set());
  };
  const emptyMessage = query.trim() ? "No conferences found."
    : view === "followed" ? "No followed conferences."
    : "No deadlines match your current filters.";
  return (
    <div>
      <ResearchPageHeader title="Paper Deadlines" actions={headerActions}
        tabs={<ResearchTabs<View> value={view} onChange={changeView} label="Conference lists" idPrefix="conference" panelId="conference-list" isLight={isLight}
          items={[{ value: "all", label: "All", count: lists.all.length }, { value: "followed", label: "Followed", count: lists.followed.length }]} />}
        toolbarActions={<>
          <ResearchBulkToggle enabled={batch} onToggle={() => { setBatch(value => !value); setSelected(new Set()); }} isLight={isLight} />
          <IgnoredConferencesDialog conferences={lists.ignored} now={now} isLight={isLight} saveError={saveError} onPreference={onPreference} />
        </>}
        filter={<label className={`flex min-h-10 w-full items-center gap-2 rounded-xl border border-[var(--dashboard-border)] px-3 ${isLight ? "bg-white" : "bg-white/5"}`}>
          <Search aria-hidden="true" size={15} className="shrink-0 text-slate-400" />
          <input type="search" aria-label="Search conferences" placeholder="Search conferences" title="Search acronym or full name" value={query}
            autoComplete="off" autoCorrect="off" spellCheck={false}
            onChange={event => { setQuery(event.target.value); setSelected(new Set()); }} className="min-w-0 flex-1 bg-transparent py-2 text-xs text-[var(--dashboard-text)] outline-none placeholder:text-slate-400 [&::-webkit-search-cancel-button]:hidden" />
          {query && <button type="button" aria-label="Clear search" title="Clear search" onClick={() => { setQuery(""); setSelected(new Set()); }}
            className="rounded-md p-1 text-slate-500 hover:bg-slate-500/10"><X size={13} /></button>}
        </label>} />
      {children}
      {batch && <>
        <ResearchBulkControls total={ids.length} selected={checked.length} onToggleAll={() => setSelected(new Set(checked.length === ids.length ? [] : ids))} isLight={isLight}>
          <button type="button" className={button} disabled={!checked.length} onClick={() => apply(checked, "follow")}>Follow selected</button>
          {view === "followed" && <button type="button" className={button} disabled={!checked.length} onClick={() => apply(checked, "unfollow")}>Unfollow selected</button>}
          <button type="button" className={button} disabled={!checked.length} onClick={() => apply(checked, "ignore")}>Ignore selected</button>
        </ResearchBulkControls>
        {view === "followed" && <div className="mb-4 flex flex-wrap gap-2">
          <button type="button" disabled={!expired.length} onClick={() => apply(expired, "unfollow")} className={button}><span>Clear expired</span>{expired.length > 0 && <span className="opacity-60">{expired.length}</span>}</button>
          <button type="button" disabled={!lists.followed.length} onClick={() => apply(conferencePreferenceIds(preferences, "followed"), "unfollow")} className={button}>Unfollow all</button>
        </div>}
      </>}
      <div id="conference-list" role="tabpanel" aria-labelledby={`conference-tab-${view}`} className="space-y-4">
        {visible.length ? visible.map(item => {
          const id = deadlineConferenceKey(item);
          return <DeadlineConferenceCard key={id} deadline={item} now={now} language={language} isLight={isLight}
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
