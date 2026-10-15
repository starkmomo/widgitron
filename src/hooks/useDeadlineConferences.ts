import { useEffect, useMemo, useState } from "react";
import type { PaperDeadlineInfo } from "../types/config";
import { conferenceDeadlines } from "../utils/deadlineKeys";

export function useDeadlineConferences(deadlines: PaperDeadlineInfo[]) {
  const [now, setNow] = useState(Date.now);
  const conferences = useMemo(() => conferenceDeadlines(deadlines, now), [deadlines, now]);
  useEffect(() => {
    const update = () => setNow(Date.now());
    const next = Math.min(...conferences.map(item => Date.parse(item.deadline_utc)).filter(Number.isFinite));
    // Re-render only at a stage boundary; individual countdowns tick separately.
    const timer = Number.isFinite(next)
      ? window.setTimeout(update, Math.min(2_147_483_647, Math.max(0, next - Date.now()) + 25)) : undefined;
    window.addEventListener("focus", update);
    document.addEventListener("visibilitychange", update);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("focus", update);
      document.removeEventListener("visibilitychange", update);
    };
  }, [conferences]);
  return { conferences, now };
}
