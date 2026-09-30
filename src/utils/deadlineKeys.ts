import type { PaperConfig, PaperDeadlineInfo } from "../types/config";

export function deadlineInstanceKey(deadline: Pick<PaperDeadlineInfo, "title" | "year" | "deadline_utc">): string {
  return [
    deadline.title.trim().toLowerCase(),
    deadline.year.trim().toLowerCase(),
    deadline.deadline_utc.trim(),
  ].join("|");
}

export function deadlineTitleEquals(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

export function selectWidgetDeadlines(
  deadlines: PaperDeadlineInfo[],
  config: PaperConfig,
  now = Date.now()
): PaperDeadlineInfo[] {
  const subscribed = new Set((config.subscribed_titles || []).map((title) => title.trim().toLowerCase()));
  const pinned = new Set(config.pinned_deadline_ids || []);
  const selected = new Map<string, { deadline: PaperDeadlineInfo; pinned: boolean; time: number }>();

  for (const deadline of deadlines) {
    const isPinned = pinned.has(deadlineInstanceKey(deadline));
    if (!isPinned && !subscribed.has(deadline.title.trim().toLowerCase())) continue;

    const time = Date.parse(deadline.deadline_utc);
    if (!Number.isFinite(time) || time <= now) continue;

    const conference = JSON.stringify([
      deadline.title.trim().toLowerCase(),
      deadline.year.trim().toLowerCase(),
    ]);
    const current = selected.get(conference);
    if (!current || (isPinned && !current.pinned) || (isPinned === current.pinned && time < current.time)) {
      selected.set(conference, { deadline, pinned: isPinned, time });
    }
  }

  return [...selected.values()]
    .sort((a, b) => a.time - b.time)
    .map(({ deadline }) => deadline);
}
