import type { PaperDeadlineInfo } from "../types/config";
import { deadlineStageLabel, deadlineStageNote } from "../utils/deadlineKeys";

export function DeadlineStageDetails({ deadline, compact = false, color, isLight = false }: {
  deadline: PaperDeadlineInfo; compact?: boolean; color?: string; isLight?: boolean;
}) {
  const commitment = deadline.deadline_stage === "arr_commitment";
  const label = deadlineStageLabel(deadline);
  const note = deadlineStageNote(label, deadline.deadline_note);

  return (
    <div data-no-localize className={compact ? "mt-1 text-[9px] leading-relaxed" : "mt-2 text-xs leading-relaxed"}>
      <p className="font-semibold text-slate-500"
        style={{ color: commitment ? isLight ? "#b45309" : "#fbbf24" : color }}>
        {label}
      </p>
      {note && (
        <p data-no-localize title={note}
          className={`${compact ? "line-clamp-2" : "mt-0.5"} break-words text-slate-500`}
          style={{ color }}>
          {note}
        </p>
      )}
    </div>
  );
}
