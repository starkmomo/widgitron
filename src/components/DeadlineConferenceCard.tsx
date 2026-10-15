import { useState } from "react";
import { ChevronDown, EyeOff, RotateCcw, Star, Trophy } from "lucide-react";
import type { PaperDeadlineInfo } from "../types/config";
import type { UiLanguage } from "../utils/localization";
import { DeadlineCountdown } from "./DeadlineCountdown";
import { DeadlineStageDetails } from "./DeadlineStageDetails";
import { DeadlineTimeline } from "./DeadlineTimeline";
import { conferenceHasExpired } from "../utils/deadlineKeys";

export function DeadlineConferenceCard({ deadline, now, language, isLight, isFollowed, isIgnored, onFollow, onIgnore, onRestore, selecting = false, selected = false, onSelect }: {
  deadline: PaperDeadlineInfo; now: number; language: UiLanguage; isLight: boolean; isFollowed: boolean;
  isIgnored: boolean; onFollow: () => void; onIgnore: () => void; onRestore: () => void;
  selecting?: boolean; selected?: boolean; onSelect?: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const date = deadline.deadline_utc ? new Date(deadline.deadline_utc) : null;
  const expired = conferenceHasExpired(deadline, now);
  const hasData = Boolean(deadline.timeline?.length || deadline.deadline_utc);
  const id = `timeline-${encodeURIComponent(`${deadline.title}-${deadline.year}`)}`;
  return (
    <article onClick={event => {
      if (!(event.target as Element).closest("button,a,input,label")) {
        if (selecting) onSelect?.(); else if (hasData) setExpanded(value => !value);
      }
    }} className={`border border-[var(--dashboard-border)] rounded-2xl p-6 cursor-pointer ${isLight ? "bg-white text-slate-900" : "bg-white/5 text-slate-100"}`}>
      <div className="flex flex-wrap items-center justify-between gap-5">
        <div className="flex min-w-0 flex-1 items-start gap-4">
          {selecting && <input type="checkbox" checked={selected} onChange={onSelect} aria-label={`${deadline.title} ${deadline.year}`} className="mt-5 size-5 shrink-0 cursor-pointer accent-blue-600" />}
          <div className={`flex size-16 shrink-0 flex-col items-center justify-center rounded-2xl ${isLight ? "bg-purple-100 text-purple-600" : "bg-purple-500/15 text-purple-400"}`}>
            <span className="text-[10px] font-bold opacity-70">{deadline.sub}</span>
            <Trophy size={20} />
          </div>
          <div className="min-w-0">
            <h3 className="flex flex-wrap items-center gap-2 text-lg font-bold">
              <span>{deadline.title} {deadline.year}</span>
              {expired && <span className="rounded bg-slate-500/10 px-2 py-0.5 text-[10px] text-slate-500">Expired</span>}
              {deadline.ccf && <span className="rounded bg-purple-500/10 px-1.5 py-0.5 text-[9px] text-purple-500">{deadline.ccf === "N" ? "Non CCF" : `CCF ${deadline.ccf}`}</span>}
              {deadline.core && <span className="rounded bg-blue-500/10 px-1.5 py-0.5 text-[9px] text-blue-500">{deadline.core === "N" ? "Non Core" : `Core ${deadline.core}`}</span>}
            </h3>
            {deadline.description && <p data-no-localize className="mt-1 text-xs leading-relaxed text-slate-500">{deadline.description}</p>}
            <p className="mt-1 text-xs text-slate-500">{deadline.place}</p>
            {hasData ? <DeadlineStageDetails deadline={deadline} isLight={isLight} /> : <p className="mt-2 text-xs text-slate-500">No deadline data available</p>}
            {date && !expired && <div className="mt-1 text-[11px] font-mono font-semibold text-purple-500"><DeadlineCountdown date={deadline.deadline_utc} /></div>}
          </div>
        </div>
        <div className="ml-auto flex shrink-0 flex-col items-end gap-2 text-right">
          {!selecting && <div className="flex items-center gap-2">
            {isIgnored ? (
              <button type="button" onClick={onRestore} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-[var(--dashboard-border)] px-3 py-2 text-xs font-semibold hover:bg-blue-500/10 focus-visible:outline-2 focus-visible:outline-blue-500">
                <RotateCcw size={14} /><span>Restore conference</span>
              </button>
            ) : <>
              <button type="button" onClick={onFollow} aria-pressed={isFollowed}
                title={isFollowed ? "Unfollow conference" : "Follow conference"}
                className={`inline-flex min-h-9 items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 ${isFollowed ? "bg-emerald-500 text-white hover:bg-emerald-600" : isLight ? "bg-slate-100 text-slate-700 hover:bg-slate-200" : "bg-white/10 text-slate-200 hover:bg-white/15"}`}>
                <Star size={14} className={isFollowed ? "fill-current" : ""} /><span>{isFollowed ? "Followed" : "Follow"}</span>
              </button>
              <button type="button" onClick={onIgnore} aria-label="Ignore conference" title="Ignore conference"
                className="inline-flex min-h-9 min-w-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-500/10 hover:text-slate-700 focus-visible:outline-2 focus-visible:outline-blue-500">
                <EyeOff size={15} />
              </button>
            </>}
          </div>}
          <time data-no-localize dateTime={deadline.deadline_utc || undefined} className={`text-xl font-bold tabular-nums ${expired ? "text-slate-500" : ""}`}>{date ? date.toLocaleDateString(language) : "TBD"}</time>
          {date && <span data-no-localize className="text-[10px] text-slate-500">{date.toLocaleTimeString(language, { hour: "2-digit", minute: "2-digit", timeZoneName: "short" })}</span>}
          {hasData && <button type="button" onClick={() => setExpanded(value => !value)} aria-expanded={expanded} aria-controls={id}
            className="inline-flex items-center gap-1 text-[11px] font-medium text-blue-500">
            <span>{expanded ? "Hide timeline" : "View timeline"}</span><ChevronDown size={13} className={expanded ? "rotate-180" : ""} />
          </button>}
        </div>
      </div>
      {expanded && <div id={id}><DeadlineTimeline deadline={deadline} now={now} language={language} /></div>}
    </article>
  );
}
