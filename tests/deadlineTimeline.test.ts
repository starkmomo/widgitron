import assert from "node:assert/strict";
import test from "node:test";
import type { DeadlineMilestone, PaperDeadlineInfo } from "../src/types/config.ts";
import { conferenceDeadlines, conferenceHasExpired, conferenceManagementRows, conferencePreferenceIds, resolveConferencePreferences, updateConferencePreferences, deadlineConferenceKey, deadlineInstanceKey, deadlinePinMatches, deadlineStageLabel, isConferenceFollowed, isConferenceIgnored, matchesDeadlineSearch, selectWidgetDeadlines, updateConferencePreference } from "../src/utils/deadlineKeys.ts";

const event = (id: string, day: number, stage: DeadlineMilestone["stage"], label: string, round = 1): DeadlineMilestone => ({
  id, label, stage, deadline_utc: `2100-11-${String(day).padStart(2, "0")}T12:00:00Z`,
  source_time: `2100-11-${day} 12:00:00`, note: null, round,
});
const abstract = event("abs", 10, "abstract_submission", "Abstract submission");
const full = event("full", 16, "full_paper_submission", "Full paper submission");
const rebuttal = event("rebuttal", 20, "rebuttal", "Rebuttal / author response");
const decision = event("decision", 25, "decision", "Decision notification");
const conference: PaperDeadlineInfo = {
  title: "CVPR", year: "2100", deadline_utc: abstract.deadline_utc!,
  timezone: "UTC+0", rank: "A", sub: "AI", place: "Seattle", link: "https://example.com",
  timeline: [abstract, full, rebuttal, decision],
};

test("one conference has its complete timeline and rolls at the exact boundary", () => {
  const before = conferenceDeadlines([conference], Date.parse("2100-11-09T00:00:00Z"));
  assert.equal(before.length, 1);
  assert.equal(before[0].deadline_label, "Abstract submission");
  for (const [passed, next] of [[abstract, full], [full, rebuttal], [rebuttal, decision]]) {
    const current = conferenceDeadlines([conference], Date.parse(passed.deadline_utc!));
    assert.equal(current[0].deadline_label, next.label);
    assert.equal(current[0].timeline?.length, 4);
    assert.equal(deadlineConferenceKey(current[0]), deadlineConferenceKey(before[0]));
  }
  assert.equal(conferenceDeadlines([conference], Date.parse(decision.deadline_utc!)).length, 0);
});

test("old date-specific pins keep the conference and follow its nearest stage", () => {
  const oldPin = deadlineInstanceKey({ ...conference, deadline_utc: full.deadline_utc! });
  assert.equal(deadlinePinMatches(oldPin, conference), true);
  assert.equal(deadlinePinMatches("cvpr|2099|some-date", conference), false);
  const config = { pinned_deadline_ids: [oldPin] };
  assert.equal(selectWidgetDeadlines([conference], config, Date.parse("2100-11-09T00:00:00Z"))[0].deadline_label, "Abstract submission");
  assert.equal(selectWidgetDeadlines([conference], config, Date.parse(full.deadline_utc!))[0].deadline_label, "Rebuttal / author response");
  assert.equal(selectWidgetDeadlines([conference], {}, Date.parse("2100-11-09T00:00:00Z")).length, 0);
});

test("legacy per-round cached rows are grouped into one card without losing rounds", () => {
  const rows = [10, 16, 20].map(day => ({ ...conference, title: "VLDB", timeline: undefined,
    deadline_utc: `2100-11-${day}T12:00:00Z` }));
  const current = conferenceDeadlines(rows, Date.parse("2100-11-09T00:00:00Z"));
  assert.equal(current.length, 1);
  assert.equal(current[0].timeline?.length, 3);
});

test("TBD remains undated and stage copy remains English", () => {
  const tbd = { ...decision, deadline_utc: null, source_time: "TBD" };
  const current = conferenceDeadlines([{ ...conference, timeline: [abstract, tbd] }], Date.parse(abstract.deadline_utc!));
  assert.equal(current[0].deadline_utc, "");
  assert.equal(current[0].deadline_label, "Decision notification");
  assert.equal(deadlineStageLabel({ deadline_stage: "arr_commitment" }), "ARR commitment · reviewed papers only");
});

test("ignore removes old pins and follows, restore does not silently follow again", () => {
  const empty = { subscribed_titles: null, ignored_titles: null, pinned_titles: null, pinned_deadline_ids: null };
  assert.equal(isConferenceFollowed(conference, updateConferencePreference(empty, "cvpr|2100", "follow")), true);
  assert.equal(isConferenceIgnored(conference, updateConferencePreference(empty, "cvpr|2100", "ignore")), true);
  const config = { followed_conference_ids: ["cvpr|2100", "acl|2100"], pinned_titles: ["cvpr"],
    pinned_deadline_ids: [deadlineInstanceKey(conference)], filter_by_rank: ["A"] };
  const ignored = updateConferencePreference(config, "cvpr|2100", "ignore");
  assert.equal(isConferenceIgnored(conference, ignored), true);
  assert.equal(isConferenceFollowed(conference, ignored), false);
  assert.deepEqual(ignored.followed_conference_ids, ["acl|2100"]);
  assert.deepEqual(ignored.filter_by_rank, ["A"]);
  assert.equal(selectWidgetDeadlines([conference], ignored, Date.parse("2100-11-09T00:00:00Z")).length, 0);
  const restored = updateConferencePreference(ignored, "cvpr|2100", "restore");
  assert.equal(isConferenceIgnored(conference, restored), false);
  assert.equal(isConferenceFollowed(conference, restored), false);
  const followed = updateConferencePreference(ignored, "cvpr|2100", "follow");
  assert.equal(isConferenceIgnored(conference, followed), false);
  assert.equal(isConferenceFollowed(conference, followed), true);
  assert.equal(isConferenceFollowed(conference, updateConferencePreference(followed, "cvpr|2100", "unfollow")), false);
});

test("search accepts acronym, source full name and year without changing selections", () => {
  const item = { ...conference, description: "IEEE/CVF Conference on Computer Vision and Pattern Recognition" };
  assert.equal(matchesDeadlineSearch(item, "cvpr 2100"), true);
  assert.equal(matchesDeadlineSearch(item, "  computer   VISION "), true);
  assert.equal(matchesDeadlineSearch(item, "ACL"), false);
  assert.equal(matchesDeadlineSearch({ ...conference, description: undefined }, "CVPR"), true);
});

test("edition preferences do not follow or ignore the next year and legacy titles bind once", () => {
  const nextYear = { ...conference, year: "2101", timeline: [{ ...abstract, deadline_utc: "2101-11-10T12:00:00Z" }] };
  const now = Date.parse("2100-11-09T00:00:00Z");
  const bound = resolveConferencePreferences({ subscribed_titles: ["CVPR"] }, [conference, nextYear], now);
  assert.deepEqual(conferencePreferenceIds(bound, "followed"), ["cvpr|2100"]);
  assert.equal(isConferenceFollowed(nextYear, bound), false);
  const ignored = updateConferencePreference(bound, "cvpr|2100", "ignore");
  assert.equal(isConferenceIgnored(nextYear, ignored), false);
});

test("bulk changes preserve other editions, unknown dates and unrelated settings", () => {
  const ended = { ...conference, year: "2099", timeline: [{ ...decision, deadline_utc: "2099-11-25T12:00:00Z" }] };
  const unknown = { ...conference, title: "TBD Conf", timeline: [{ ...abstract, deadline_utc: null, source_time: "TBD" }] };
  const now = Date.parse("2100-11-09T00:00:00Z");
  const original = { followed_conference_ids: ["cvpr|2099", "cvpr|2100", "tbd conf|2100", "missing|2090"], filter_by_rank: ["A"] };
  const rows = conferenceManagementRows([ended, conference, unknown], original, now);
  assert.equal(rows.length, 4);
  const expired = rows.filter(row => conferenceHasExpired(row, now)).map(deadlineConferenceKey);
  assert.deepEqual(expired, ["cvpr|2099"]);
  const cleaned = updateConferencePreferences(original, expired, "unfollow");
  assert.deepEqual(cleaned.followed_conference_ids, ["cvpr|2100", "tbd conf|2100", "missing|2090"]);
  assert.deepEqual(cleaned.filter_by_rank, ["A"]);
  const ignored = updateConferencePreferences(cleaned, ["cvpr|2100", "tbd conf|2100"], "ignore");
  assert.deepEqual(ignored.followed_conference_ids, ["missing|2090"]);
  assert.deepEqual(ignored.ignored_conference_ids, ["cvpr|2100", "tbd conf|2100"]);
  const restored = updateConferencePreferences(ignored, conferencePreferenceIds(ignored, "ignored"), "restore");
  assert.deepEqual(restored.ignored_conference_ids, []);
  assert.deepEqual(selectWidgetDeadlines([ended], original, now), []);
});
