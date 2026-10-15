import type { DeadlineMilestone, PaperConfig, PaperDeadlineInfo } from "../types/config";

export function deadlineConferenceKey(deadline: Pick<PaperDeadlineInfo, "title" | "year">): string {
  return `${deadline.title.trim().toLowerCase()}|${deadline.year.trim().toLowerCase()}`;
}

export function deadlinePinMatches(key: string, deadline: Pick<PaperDeadlineInfo, "title" | "year">): boolean {
  const conference = deadlineConferenceKey(deadline);
  const normalized = key.trim().toLowerCase();
  return normalized === conference || normalized.startsWith(`${conference}|`);
}

export function deadlineStageLabel(deadline: Pick<PaperDeadlineInfo, "deadline_stage" | "deadline_label">): string {
  if (deadline.deadline_label) return deadline.deadline_label;
  switch (deadline.deadline_stage) {
    case "abstract_submission": return "Abstract submission";
    case "full_paper_submission": return "Full paper submission";
    case "submission": return "Paper submission";
    case "arr_submission": return "ARR submission";
    case "arr_commitment": return "ARR commitment · reviewed papers only";
    case "rebuttal": return "Rebuttal / author response";
    case "decision": return "Decision notification";
    default: return "Deadline type not specified";
  }
}

export function deadlineStageNote(label: string, note?: string | null): string | undefined {
  const normalize = (value: string) => value.trim().replace(/\s+/g, " ").toLowerCase();
  const trimmed = note?.trim();
  return trimmed && normalize(trimmed) !== normalize(label) ? trimmed : undefined;
}

export function deadlineTimeline(deadline: PaperDeadlineInfo): DeadlineMilestone[] {
  if (deadline.timeline?.length) return deadline.timeline;
  return [{ id: deadlineInstanceKey(deadline), label: deadlineStageLabel(deadline),
    stage: deadline.deadline_stage ?? "unspecified", deadline_utc: deadline.deadline_utc || null,
    source_time: deadline.deadline_utc, note: deadline.deadline_note ?? null, round: 1 }];
}

export function conferenceDeadlines(deadlines: PaperDeadlineInfo[], now = Date.now(), includeExpired = false): PaperDeadlineInfo[] {
  const groups = new Map<string, { base: PaperDeadlineInfo; events: Map<string, DeadlineMilestone> }>();
  for (const deadline of deadlines) {
    const key = deadlineConferenceKey(deadline);
    const group = groups.get(key) ?? { base: deadline, events: new Map<string, DeadlineMilestone>() };
    for (const event of deadlineTimeline(deadline)) {
      const identity = JSON.stringify([event.deadline_utc, event.stage, event.round, event.note]);
      group.events.set(identity, event);
    }
    groups.set(key, group);
  }
  return [...groups.values()].flatMap(({ base, events }) => {
    const timeline = [...events.values()].sort((a, b) =>
      (a.deadline_utc ? Date.parse(a.deadline_utc) : Infinity) - (b.deadline_utc ? Date.parse(b.deadline_utc) : Infinity));
    const next = timeline.find(event => event.deadline_utc && Date.parse(event.deadline_utc) > now)
      ?? (Number(base.year) >= new Date(now).getUTCFullYear() ? timeline.find(event => !event.deadline_utc) : undefined)
      ?? (includeExpired ? timeline.find(event => !event.deadline_utc) ?? timeline[timeline.length - 1] : undefined);
    return next ? [{ ...base, timeline, deadline_utc: next.deadline_utc ?? "",
      deadline_stage: next.stage, deadline_label: next.label, deadline_note: next.note }] : [];
  }).sort((a, b) => (a.deadline_utc ? Date.parse(a.deadline_utc) : Infinity)
    - (b.deadline_utc ? Date.parse(b.deadline_utc) : Infinity));
}

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

export function conferencePreferenceIds(config: PaperConfig, kind: "followed" | "ignored"): string[] {
  const ids = kind === "ignored" ? config.ignored_conference_ids ?? [] : [
    ...(config.followed_conference_ids ?? []),
    ...(config.pinned_deadline_ids ?? []).map(key => key.split("|").slice(0, 2).join("|")),
  ];
  const legacy = kind === "ignored" ? config.ignored_titles ?? []
    : [...(config.subscribed_titles ?? []), ...(config.pinned_titles ?? [])];
  return [...new Set([...ids, ...legacy.map(title => `${title}|`)].map(id => id.trim().toLowerCase()))];
}

export function resolveConferencePreferences(config: PaperConfig, deadlines: PaperDeadlineInfo[], now: number): PaperConfig {
  const rows = conferenceDeadlines(deadlines, now, true);
  const bind = (kind: "followed" | "ignored") => conferencePreferenceIds(config, kind).map(id => {
    if (id.split("|")[1]) return id;
    const candidates = rows.filter(row => deadlineTitleEquals(row.title, id.split("|")[0]));
    const upcoming = candidates.filter(row => row.deadline_utc ? Date.parse(row.deadline_utc) > now
      : Number(row.year) >= new Date(now).getUTCFullYear());
    const chosen = upcoming.sort((a, b) => (a.deadline_utc ? Date.parse(a.deadline_utc) : Infinity)
      - (b.deadline_utc ? Date.parse(b.deadline_utc) : Infinity) || Number(a.year) - Number(b.year))[0]
      ?? candidates.sort((a, b) => Number(b.year) - Number(a.year))[0];
    return chosen ? deadlineConferenceKey(chosen) : id;
  });
  const ignored = bind("ignored");
  return { ...config, followed_conference_ids: bind("followed").filter(id => !ignored.includes(id)),
    ignored_conference_ids: ignored, subscribed_titles: [], pinned_titles: [], pinned_deadline_ids: [], ignored_titles: [] };
}

export function isConferenceIgnored(deadline: Pick<PaperDeadlineInfo, "title" | "year">, config: PaperConfig): boolean {
  return conferencePreferenceIds(config, "ignored").includes(deadlineConferenceKey(deadline));
}

export function isConferenceFollowed(deadline: Pick<PaperDeadlineInfo, "title" | "year">, config: PaperConfig): boolean {
  return !isConferenceIgnored(deadline, config) && conferencePreferenceIds(config, "followed").includes(deadlineConferenceKey(deadline));
}

export type ConferencePreference = "follow" | "unfollow" | "ignore" | "restore";

export function updateConferencePreference(config: PaperConfig, id: string, action: ConferencePreference): PaperConfig {
  id = id.trim().toLowerCase();
  const title = id.split("|")[0];
  const otherTitles = (titles?: string[] | null) => (titles ?? []).filter(item => !deadlineTitleEquals(item, title));
  const originalFollowed = [...(config.followed_conference_ids ?? []), ...(config.pinned_deadline_ids ?? []).map(key => key.split("|").slice(0, 2).join("|"))].map(key => key.toLowerCase());
  const followed = originalFollowed.filter(key => key !== id);
  const ignored = (config.ignored_conference_ids ?? []).filter(key => key.toLowerCase() !== id);
  return { ...config,
    followed_conference_ids: action === "follow" ? [...followed, id]
      : action === "restore" ? originalFollowed : followed,
    ignored_conference_ids: action === "ignore" ? [...ignored, id] : ignored,
    subscribed_titles: otherTitles(config.subscribed_titles), ignored_titles: otherTitles(config.ignored_titles),
    pinned_titles: otherTitles(config.pinned_titles),
    pinned_deadline_ids: (config.pinned_deadline_ids ?? []).filter(key => key.split("|").slice(0, 2).join("|").toLowerCase() !== id),
  };
}

export function updateConferencePreferences(config: PaperConfig, ids: string[], action: ConferencePreference): PaperConfig {
  return [...new Set(ids)].reduce((next, id) => updateConferencePreference(next, id, action), config);
}

export function conferenceHasExpired(deadline: PaperDeadlineInfo, now = Date.now()): boolean {
  const events = deadlineTimeline(deadline);
  // An unpublished or unparseable date is unknown, not expired.
  return events.length > 0 && events.every(event => {
    const time = event.deadline_utc ? Date.parse(event.deadline_utc) : NaN;
    return Number.isFinite(time) && time <= now;
  });
}

export function conferenceManagementRows(deadlines: PaperDeadlineInfo[], config: PaperConfig, now = Date.now()): PaperDeadlineInfo[] {
  const preferences = resolveConferencePreferences(config, deadlines, now);
  const ids = [...conferencePreferenceIds(preferences, "followed"), ...conferencePreferenceIds(preferences, "ignored")];
  const rows = conferenceDeadlines(deadlines, now, true).filter(row => !conferenceHasExpired(row, now) || ids.includes(deadlineConferenceKey(row)));
  for (const id of ids) {
    if (!rows.some(row => deadlineConferenceKey(row) === id)) {
      const [title, year = ""] = id.split("|");
      rows.push({ title: title.toUpperCase(), year, deadline_utc: "", timezone: "", rank: "", sub: "", place: "", link: "", timeline: [] });
    }
  }
  return rows.sort((a, b) => Number(conferenceHasExpired(a, now)) - Number(conferenceHasExpired(b, now))
    || (a.deadline_utc ? Date.parse(a.deadline_utc) : Infinity) - (b.deadline_utc ? Date.parse(b.deadline_utc) : Infinity)
    || a.title.localeCompare(b.title) || Number(b.year) - Number(a.year));
}

export function matchesDeadlineSearch(deadline: PaperDeadlineInfo, query: string): boolean {
  const text = `${deadline.title} ${deadline.description ?? ""} ${deadline.year}`.toLowerCase();
  return query.trim().toLowerCase().split(/\s+/).every(word => text.includes(word));
}

export function selectWidgetDeadlines(
  deadlines: PaperDeadlineInfo[],
  config: PaperConfig,
  now = Date.now()
): PaperDeadlineInfo[] {
  const preferences = resolveConferencePreferences(config, deadlines, now);
  return conferenceDeadlines(deadlines, now).filter(deadline => isConferenceFollowed(deadline, preferences));
}
