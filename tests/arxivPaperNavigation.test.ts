import test from "node:test";
import assert from "node:assert/strict";
import { arxivPaperArrowDirection, moveArxivPaperCursor, resolveArxivPaperCursor } from "../src/utils/arxivPaperNavigation.ts";

test("only unmodified left/right keys browse, without auto-repeat or composition", () => {
  assert.equal(arxivPaperArrowDirection({ key: "ArrowLeft" }), -1);
  assert.equal(arxivPaperArrowDirection({ key: "ArrowRight" }), 1);
  assert.equal(arxivPaperArrowDirection({ key: "Escape" }), null);
  for (const flag of ["defaultPrevented", "repeat", "isComposing", "ctrlKey", "metaKey", "shiftKey", "altKey"]) {
    assert.equal(arxivPaperArrowDirection({ key: "ArrowRight", [flag]: true }), null);
  }
});

test("browse forward and back without removing papers or wrapping at the ends", () => {
  const papers = ["one", "two", "three"];
  const first = { key: "one", index: 0 };
  const second = moveArxivPaperCursor(papers, first, 1);
  assert.deepEqual(second, { key: "two", index: 1 });
  assert.deepEqual(moveArxivPaperCursor(papers, second, -1), first);
  assert.deepEqual(moveArxivPaperCursor(papers, first, -1), first);
  assert.deepEqual(moveArxivPaperCursor(papers, { key: "three", index: 2 }, 1), { key: "three", index: 2 });
  assert.deepEqual(papers, ["one", "two", "three"]);
});

test("refreshes and removals before the displayed paper preserve its identity", () => {
  const current = { key: "two", index: 1 };
  assert.deepEqual(resolveArxivPaperCursor(["new", "one", "two", "three"], current), { key: "two", index: 2 });
  assert.deepEqual(resolveArxivPaperCursor(["two", "three"], current), { key: "two", index: 0 });
});

test("saving or ignoring the displayed paper shows its next neighbour, or previous at the end", () => {
  const keys = ["one", "three"];
  assert.deepEqual(resolveArxivPaperCursor(keys, { key: "two", index: 1 }), { key: "three", index: 1 });
  assert.deepEqual(resolveArxivPaperCursor(["one", "two"], { key: "three", index: 2 }), { key: "two", index: 1 });
});

test("an explicit filter reset starts at the first match and empty lists stay valid", () => {
  assert.deepEqual(resolveArxivPaperCursor(["match", "another"], { key: null, index: 0 }), { key: "match", index: 0 });
  const empty = resolveArxivPaperCursor([], { key: "old", index: 7 });
  assert.deepEqual(empty, { key: null, index: 0 });
  assert.deepEqual(moveArxivPaperCursor([], empty, 1), empty);
  assert.deepEqual(resolveArxivPaperCursor(["new"], empty), { key: "new", index: 0 });
});
