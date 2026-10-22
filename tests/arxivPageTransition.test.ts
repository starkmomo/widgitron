import test from "node:test";
import assert from "node:assert/strict";
import { retainArxivPage } from "../src/utils/arxivPageTransition.ts";
import type { ArxivPaperPage } from "../src/types/tauri.ts";

const key = (keywords: string[], date: string | null = "2026-10-20", categories = ["cs"]) =>
  JSON.stringify({ categories, keywords, date });
const page: ArxivPaperPage = {
  papers: [
    { id: "one", title: "Omni learning", summary: "", authors: [], link: "", published: "2026-10-20" },
    { id: "two", title: "Audio research", summary: "", authors: [], link: "", published: "2026-10-20" },
    { id: "three", title: "Server metadata match", summary: "", authors: [], link: "", published: "2026-10-20", matched_keywords: ["audio"] },
  ],
  data_date: "2026-10-20", total: 103, page: 1, page_size: 100, fresh: true,
};

test("adding keywords retains existing historical papers during the new query", () => {
  const retained = retainArxivPage(key(["omni", "audio"]), page, key(["omni", "audio", "agent"]));
  assert.deepEqual(retained?.papers, page.papers);
  assert.equal(retained?.fresh, false);
  assert.equal(page.fresh, true);
});

test("removing a keyword immediately retains other matches without an empty loading page", () => {
  const retained = retainArxivPage(key(["omni", "audio"]), page, key(["audio"]));
  assert.deepEqual(retained?.papers.map(paper => paper.id), ["two", "three"]);
});

test("category, date and unfiltered query changes never reuse unrelated results", () => {
  assert.equal(retainArxivPage(key(["omni"]), page, key(["omni"], "2026-10-21")), null);
  assert.equal(retainArxivPage(key(["omni"]), page, key(["omni"], "2026-10-20", ["stat"])), null);
  assert.equal(retainArxivPage(key([]), page, key(["audio"])), null);
  assert.equal(retainArxivPage(key(["omni"]), page, key([])), null);
  assert.equal(retainArxivPage("", page, key(["audio"])), null);
});

test("a keyword edit with no retained match is distinguished from an initial load", () => {
  const retained = retainArxivPage(key(["omni"]), page, key(["robotics"]));
  assert.notEqual(retained, null);
  assert.deepEqual(retained?.papers, []);
});
