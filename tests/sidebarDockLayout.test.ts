import assert from "node:assert/strict";
import test from "node:test";
import { findDockedSidebarInsertion, layoutDockedSidebar, reorderDockedSidebar, sidebarCardWidth } from "../src/utils/sidebarDockLayout.ts";
import { type SidebarSectionKey, type SidebarTileRect, SIDEBAR_TILE_GAP } from "../src/utils/sidebarTileLayout.ts";

const keys: SidebarSectionKey[] = ["quota", "gpu", "deadlines", "arxiv"];
const source: Record<SidebarSectionKey, SidebarTileRect> = {
  quota: { x: 0, y: 0, w: 1, h: 148 },
  gpu: { x: 0.5, y: 0, w: 0.5, h: 160 },
  deadlines: { x: 0, y: 166, w: 1, h: 176 },
  arxiv: { x: 0, y: 348, w: 1, h: 600 },
};

test("top and bottom drawers use one horizontal row bounded by the available height", () => {
  for (const height of [180, 300, 700]) {
    const board = layoutDockedSidebar(source, keys, true, 1900, height);
    for (const [index, key] of keys.entries()) {
      const rect = board.layout[key];
      assert.equal(rect.y, 0);
      assert.equal(rect.h, height); // even an old 600px arXiv card fits a shallow drawer
      assert.ok(Math.abs(rect.w * board.width - 340) < 0.001);
      assert.ok(Math.abs(rect.x * board.width - index * (340 + SIDEBAR_TILE_GAP)) < 0.001);
    }
    assert.equal(board.height, height);
  }
});

test("custom widths overflow horizontally and never change saved vertical heights", () => {
  const before = structuredClone(source);
  const widths = { gpu: 510, arxiv: 720 };
  const board = layoutDockedSidebar(source, keys, true, 600, 250, widths);
  assert.equal(board.width, 340 + 510 + 340 + 720 + 3 * SIDEBAR_TILE_GAP);
  assert.equal(board.height, 250);
  assert.equal(board.layout.arxiv.h, 250);
  assert.deepEqual(source, before);
  const vertical = layoutDockedSidebar(source, keys, false, 380, 800, widths);
  for (const [index, key] of keys.entries()) {
    assert.equal(vertical.layout[key].x, 0);
    assert.equal(vertical.layout[key].w, 1);
    assert.equal(vertical.layout[key].h, source[key].h);
    assert.equal(vertical.layout[key].y, keys.slice(0, index).reduce((sum, prior) => sum + source[prior].h + SIDEBAR_TILE_GAP, 0));
  }
  assert.deepEqual(layoutDockedSidebar(source, keys, true, 600, 250, widths), board);
});

test("hidden cards leave no gaps, empty boards fill the viewport and invalid widths recover", () => {
  assert.equal(sidebarCardWidth(NaN), 340);
  assert.equal(sidebarCardWidth(Infinity), 340);
  assert.equal(sidebarCardWidth(-10), 240);
  assert.equal(sidebarCardWidth(2000), 2000);
  const board = layoutDockedSidebar(source, ["arxiv", "gpu"], true, 500, 220);
  assert.equal(board.layout.arxiv.x, 0);
  assert.equal(board.layout.gpu.x * board.width, 346);
  const empty = layoutDockedSidebar(source, [], true, 500, 220);
  assert.equal(empty.width, 500);
  assert.equal(empty.height, 220);
});

test("fitting vertical content does not add a scroll range to the viewport", () => {
  for (const height of [160, 200, 800]) {
    const board = layoutDockedSidebar(source, ["quota"], false, 380, height);
    assert.equal(board.height, height);
    assert.equal(board.layout.quota.y, 0);
  }
  const exact = layoutDockedSidebar(source, ["quota", "gpu"], false, 380, 326);
  assert.equal(exact.height, 326); // 148 + gap 6 + 160 + end space 12
  const overflowing = layoutDockedSidebar(source, ["quota", "gpu"], false, 380, 200);
  assert.equal(overflowing.height, 326);
  assert.equal(layoutDockedSidebar(source, [], false, 380, 200).height, 200);
});

test("horizontal bounds end at the final card instead of an invisible trailing gap", () => {
  for (const viewport of [340, 400, 686, 1000]) {
    const board = layoutDockedSidebar(source, ["quota", "gpu"], true, viewport, 250);
    assert.equal(board.width, Math.max(viewport, 686));
    assert.equal((board.layout.gpu.x + board.layout.gpu.w) * board.width, 686);
  }
  const single = layoutDockedSidebar(source, ["quota"], true, 340, 250);
  assert.equal(single.width, 340);
  assert.equal(single.layout.quota.w, 1);
});

test("drag insertion stays on the dock axis and preserves the other card order", () => {
  const horizontal = layoutDockedSidebar(source, keys, true, 1000, 250);
  const guide = findDockedSidebarInsertion(800, horizontal.layout, keys, "arxiv", true, horizontal.width)!;
  assert.deepEqual(guide, { targetKey: "deadlines", placement: "left" });
  assert.deepEqual(reorderDockedSidebar(keys, "arxiv", guide), ["quota", "gpu", "arxiv", "deadlines"]);
  const vertical = layoutDockedSidebar(source, keys, false, 380, 800);
  assert.deepEqual(findDockedSidebarInsertion(200, vertical.layout, keys, "arxiv", false, 380), { targetKey: "gpu", placement: "above" });
  assert.equal(findDockedSidebarInsertion(20, source, ["gpu"], "gpu", false, 380), null);
});
