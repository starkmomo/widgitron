import type { PaperDeadlineInfo } from "../types/config";
import { deadlineStageNote, deadlineTimeline } from "../utils/deadlineKeys";

export function DeadlineTimeline({ deadline, now, compact = false }: {
  deadline: PaperDeadlineInfo; now: number; compact?: boolean;
}) {
  const events = deadlineTimeline(deadline);
  const rounds = new Set(events.map(event => event.round)).size;
  const next = events.find(event => event.deadline_utc && Date.parse(event.deadline_utc) > now);
  return (
    <div className={compact ? "mt-3 border-t border-current/10 pt-3" : "mt-5 border-t border-[var(--dashboard-border)] pt-5"}>
      <p className="mb-3 text-[10px] text-slate-500"><span>Local time</span><span data-no-localize> · {Intl.DateTimeFormat().resolvedOptions().timeZone}</span></p>
      <ol className="space-y-3">
        {events.map((event, index) => {
          const time = event.deadline_utc ? Date.parse(event.deadline_utc) : NaN;
          const past = Number.isFinite(time) && time <= now;
          const active = event === next;
          const note = deadlineStageNote(event.label, event.note);
          return (
            <li key={`${event.id}-${index}`} className={`flex items-start gap-3 ${past ? "opacity-55" : ""}`}>
              <span aria-hidden="true" className={`mt-1.5 size-2 shrink-0 rounded-full ${active ? "bg-blue-500 ring-4 ring-blue-500/10" : "bg-slate-400/50"}`} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <span data-no-localize className={`${compact ? "text-[10px]" : "text-xs"} font-semibold break-words`}>
                    {event.label}{rounds > 1 ? ` · Round ${event.round}` : ""}
                  </span>
                  <time className="text-[10px] tabular-nums" dateTime={event.deadline_utc ?? undefined} title={`${event.source_time} (${deadline.timezone})${event.deadline_utc ? ` · ${event.deadline_utc}` : ""}`}>
                    {Number.isFinite(time) ? new Date(time).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : event.source_time || "TBD"}
                  </time>
                </div>
                {(past || active || !Number.isFinite(time)) && (
                  <div className={`mt-0.5 text-[10px] ${active ? "text-blue-500" : "text-slate-500"}`}>
                    {past ? "Passed" : active ? "Next deadline" : "Time to be confirmed"}
                  </div>
                )}
                {note && <p data-no-localize className="mt-1 break-words text-[10px] leading-relaxed text-slate-500">{note}</p>}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
