import test from "node:test";
import assert from "node:assert/strict";
import { arxivQueryChanged } from "../src/utils/arxivSettings.ts";

test("arXiv display hints and polling intervals do not change the query", () => {
  const previous = { keywords: ["omni"], categories: ["cs"], show_card_hints: true, update_interval: 3600 };
  assert.equal(arxivQueryChanged(previous, { ...previous, show_card_hints: false }), false);
  assert.equal(arxivQueryChanged(previous, { ...previous, update_interval: 7200 }), false);
});

test("arXiv query comparison ignores duplicate terms, order, case and whitespace", () => {
  assert.equal(arxivQueryChanged({ keywords: ["Omni", "agent", "omni"], categories: ["stat", "cs"] },
    { keywords: [" agent ", '"omni"'], categories: ["CS", "STAT"] }), false);
});

test("actual category and keyword edits require a reading-list refresh", () => {
  const previous = { keywords: ["omni"], categories: ["cs"] };
  assert.equal(arxivQueryChanged(previous, { ...previous, keywords: [] }), true);
  assert.equal(arxivQueryChanged(previous, { ...previous, categories: ["stat"] }), true);
});
