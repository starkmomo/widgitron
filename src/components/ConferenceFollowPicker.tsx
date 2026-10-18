import { useEffect, useId, useRef, useState } from "react";
import { Check, LoaderCircle, Plus, Search, X } from "lucide-react";
import type { PaperConfig, PaperDeadlineInfo } from "../types/config";
import { conferencePreferenceIds, deadlineConferenceKey, matchesDeadlineSearch } from "../utils/deadlineKeys";
import { tauriInvoke } from "../utils/tauriInvoke";
import { tauriListen } from "../utils/tauriListen";

export function ConferenceFollowPicker({ config, onPreference, isLight }: {
  config: PaperConfig;
  onPreference: (id: string, action: "follow" | "unfollow") => Promise<boolean>;
  isLight: boolean;
}) {
  const inputId = useId();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [catalog, setCatalog] = useState<PaperDeadlineInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [pending, setPending] = useState<Set<string>>(new Set());
  const mounted = useRef(false);
  const search = useRef<HTMLDivElement>(null);
  const loadRevision = useRef(0);
  const followed = conferencePreferenceIds(config, "followed");

  const load = async () => {
    const revision = ++loadRevision.current;
    setLoading(true);
    setLoadError(false);
    try {
      const rows = await tauriInvoke("get_conference_catalog");
      if (mounted.current && revision === loadRevision.current) setCatalog(rows);
    } catch (error) {
      console.error("Could not load conference catalog", error);
      if (mounted.current && revision === loadRevision.current) setLoadError(true);
    } finally {
      if (mounted.current && revision === loadRevision.current) setLoading(false);
    }
  };

  useEffect(() => {
    mounted.current = true;
    let active = true;
    void load();
    let stop: (() => void) | undefined;
    void tauriListen("paper_update", () => { if (active) void load(); }).then(unlisten => {
      if (active) stop = unlisten;
      else unlisten();
    }).catch(console.error);
    return () => { active = false; mounted.current = false; stop?.(); };
  }, []);

  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      if (!search.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [open]);

  const change = async (id: string, action: "follow" | "unfollow") => {
    if (pending.has(id)) return;
    setPending(current => new Set(current).add(id));
    setSaveError(false);
    try {
      const saved = await onPreference(id, action);
      if (mounted.current && !saved) setSaveError(true);
    } catch (error) {
      console.error("Could not save conference follow", error);
      if (mounted.current) setSaveError(true);
    } finally {
      if (mounted.current) setPending(current => { const next = new Set(current); next.delete(id); return next; });
    }
  };

  const matches = catalog.filter(row => matchesDeadlineSearch(row, query));
  const results = matches.slice(0, 8);
  return <div className="space-y-3">
    <label htmlFor={inputId} className="text-[10px] font-black uppercase tracking-widest text-slate-500">Subscribed Conferences</label>
    <div className="flex flex-wrap gap-2">
      {followed.map(id => <button key={id} type="button" disabled={pending.has(id)}
        onClick={() => void change(id, "unfollow")}
        className={`inline-flex max-w-full items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs disabled:opacity-50 ${
          isLight ? "border-blue-100 bg-blue-50 text-blue-700" : "border-blue-500/20 bg-blue-500/15 text-blue-200"
        }`} title="Unfollow conference">
        <span className="truncate" data-no-localize>{id.replace("|", " ").toUpperCase()}</span><X size={12} className="shrink-0" />
      </button>)}
      {!followed.length && <p className="text-xs text-slate-500">No followed conferences.</p>}
    </div>
    <div ref={search} className="space-y-2" onBlur={event => {
      // WebKit may report no focus target between pointer-down and click.
      // Keep result buttons mounted until their click has been delivered.
      if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node)) setOpen(false);
    }} onKeyDown={event => { if (event.key === "Escape") setOpen(false); }}>
      <div className={`flex items-center gap-2 rounded-xl border px-3 focus-within:border-blue-500 ${
        isLight ? "border-slate-200 bg-slate-50" : "border-white/10 bg-black/30"
      }`}>
        <Search size={15} className="shrink-0 text-slate-400" />
        <input id={inputId} type="search" value={query} aria-label="Search conferences"
          placeholder="Search acronym or full name" onFocus={() => setOpen(true)}
          onChange={event => { setQuery(event.target.value); setOpen(true); }}
          className={`min-w-0 flex-1 bg-transparent py-3 text-xs outline-none ${isLight ? "text-slate-900" : "text-white"}`} />
        {loading && <LoaderCircle size={14} className="shrink-0 animate-spin text-slate-400" />}
      </div>
      {open && <div className={`max-h-64 overflow-y-auto rounded-xl border p-1 ${
        isLight ? "border-slate-200 bg-slate-50/70" : "border-white/10 bg-black/20"
      }`}>
        {loadError ? <div className="flex items-center justify-between gap-3 px-3 py-3 text-xs text-slate-500">
          <span>Could not load conferences.</span>
          <button type="button" className="shrink-0 text-blue-500" onClick={() => void load()}>Retry</button>
        </div> : loading && !catalog.length ? <p className="px-3 py-3 text-xs text-slate-500">Loading conferences…</p>
          : !results.length ? <p className="px-3 py-3 text-xs text-slate-500">No upcoming conferences found.</p>
          : <ul aria-label="Conference search results" className="divide-y divide-[var(--dashboard-border)]">
            {results.map(row => {
              const id = deadlineConferenceKey(row);
              const selected = followed.includes(id);
              return <li key={id} className="flex items-center gap-3 px-3 py-2.5">
                <div className="min-w-0 flex-1" data-no-localize>
                  <div className={`text-xs font-bold ${isLight ? "text-slate-800" : "text-slate-200"}`}>{row.title} {row.year}</div>
                  {row.description && <div className="mt-1 truncate text-[10px] text-slate-500" title={row.description}>{row.description}</div>}
                </div>
                <button type="button" disabled={selected || pending.has(id)} onClick={() => void change(id, "follow")}
                  className={`flex shrink-0 items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold ${
                    selected ? "text-emerald-500" : "bg-blue-500/10 text-blue-500 hover:bg-blue-500/20"
                  }`}>
                  {selected ? <Check size={12} /> : <Plus size={12} />}<span>{selected ? "Followed" : "Follow"}</span>
                </button>
              </li>;
            })}
          </ul>}
        {!loadError && matches.length > results.length && <p className="px-3 py-2 text-[10px] text-slate-500">Keep typing to narrow the results.</p>}
      </div>}
    </div>
    {saveError && <p role="alert" className="text-xs text-red-500">Could not save conference selection.</p>}
  </div>;
}
