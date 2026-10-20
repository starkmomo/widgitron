import assert from "node:assert/strict";
import test from "node:test";
import {
  constrainSidebarTileHeights, resizeSidebarTileRect, sidebarRectsOverlap, sidebarTileHeightLimits,
  type SidebarSectionKey, type SidebarTileHeightLimitMap, type SidebarTileRect,
} from "../src/utils/sidebarTileLayout.ts";

test("a single monitor cannot leave a long blank card, while longer lists may scroll", () => {
  const short = sidebarTileHeightLimits("quota", 800, 148);
  const long = sidebarTileHeightLimits("quota", 800, 2200);
  assert.deepEqual(short, { min: 148, max: 148 });
  assert.equal(resizeSidebarTileRect({ x: 0, y: 0, w: 1, h: 148 }, "s", 0, 2000, 400, short).h, 148);
  assert.equal(long.max, 2200);
  assert.equal(sidebarTileHeightLimits("gpu", 400, 2000).max, 2000);
});

test("an asynchronously loading widget cannot use the full screen as a blank height limit", () => {
  for (const key of ["quota", "gpu", "deadlines"] as const) {
    const limits = sidebarTileHeightLimits(key, 2400);
    assert.equal(limits.max, limits.min);
    assert.equal(resizeSidebarTileRect({ x: 0, y: 0, w: 1, h: limits.min }, "s", 0, 2000, 400, limits).h, limits.min);
  }
});

test("arXiv retains a reading area even on a short sidebar and has an upper limit", () => {
  assert.deepEqual(sidebarTileHeightLimits("arxiv", 900, 100), { min: 300, max: 560 });
  assert.deepEqual(sidebarTileHeightLimits("arxiv", 250), { min: 300, max: 300 });
});

test("north and south resize edges respect limits and retain the opposite edge", () => {
  const rect = { x: 0, y: 300, w: 1, h: 320 };
  const limits = { min: 300, max: 500 };
  assert.equal(resizeSidebarTileRect(rect, "s", 0, -1000, 400, limits).h, 300);
  assert.equal(resizeSidebarTileRect(rect, "s", 0, 1000, 400, limits).h, 500);
  for (const delta of [-1000, 1000]) {
    const next = resizeSidebarTileRect(rect, "n", 0, delta, 400, limits);
    assert.ok(next.h >= limits.min && next.h <= limits.max);
    assert.equal(next.y + next.h, rect.y + rect.h);
  }
  assert.equal(resizeSidebarTileRect({ ...rect, y: 0 }, "n", 0, -1000, 400, limits).y, 0);
});

test("old tiny or oversized cards are clamped and following cards close up without overlap", () => {
  const keys: SidebarSectionKey[] = ["quota", "gpu", "deadlines", "arxiv"];
  const layout: Record<SidebarSectionKey, SidebarTileRect> = {
    quota: { x: 0, y: 0, w: 1, h: 2000 },
    gpu: { x: 0, y: 2006, w: 1, h: 1200 },
    deadlines: { x: 0, y: 3212, w: 1, h: 500 },
    arxiv: { x: 0, y: 3718, w: 1, h: 128 },
  };
  const limits = Object.fromEntries(keys.map(key => [key, sidebarTileHeightLimits(key, 800, 150)])) as SidebarTileHeightLimitMap;
  const next = constrainSidebarTileHeights(layout, keys, limits);
  assert.equal(next.arxiv.h, 300);
  assert.equal(next.quota.h, 150);
  assert.equal(next.gpu.y, next.quota.h + 6);
  for (const [index, key] of keys.entries()) {
    assert.ok(next[key].h >= limits[key].min && next[key].h <= limits[key].max);
    for (const other of keys.slice(index + 1)) assert.equal(sidebarRectsOverlap(next[key], next[other]), false);
  }
  assert.deepEqual(constrainSidebarTileHeights(next, keys, limits), next);
});

test("timeline growth is temporary and adds only the newly expanded content", () => {
  const keys: SidebarSectionKey[] = ["deadlines", "arxiv"];
  const layout: Record<SidebarSectionKey, SidebarTileRect> = {
    quota: { x: 0, y: 0, w: 1, h: 2000 },
    gpu: { x: 0, y: 0, w: 1, h: 160 },
    deadlines: { x: 0, y: 0, w: 1, h: 176 },
    arxiv: { x: 0, y: 182, w: 1, h: 400 },
  };
  const limits = Object.fromEntries(["quota", "gpu", "deadlines", "arxiv"].map(key => [key,
    sidebarTileHeightLimits(key as SidebarSectionKey, 800, key === "deadlines" ? 500 : 150),
  ])) as SidebarTileHeightLimitMap;
  const opened = constrainSidebarTileHeights(layout, keys, limits, { deadlines: 350 });
  assert.equal(opened.deadlines.h, 500);
  assert.equal(opened.arxiv.y, 506);
  assert.equal(opened.arxiv.h, 400);
  assert.equal(layout.deadlines.h, 176);
  const collapsed = constrainSidebarTileHeights(layout, keys, { ...limits, deadlines: sidebarTileHeightLimits("deadlines", 800, 150) });
  assert.equal(collapsed.deadlines.h, 176);
  assert.equal(collapsed.arxiv.y, 182);
  assert.equal(collapsed.arxiv.h, 400);

  const many = constrainSidebarTileHeights(layout, ["quota"], { ...limits, quota: sidebarTileHeightLimits("quota", 800, 3000) });
  assert.equal(many.quota.h, 2000); // a long list may be expanded beyond one screen
  const few = constrainSidebarTileHeights(many, ["quota"], { ...limits, quota: sidebarTileHeightLimits("quota", 800, 150) });
  assert.equal(few.quota.h, 150);

  const manyConferences = constrainSidebarTileHeights(layout, keys, { ...limits, deadlines: sidebarTileHeightLimits("deadlines", 800, 1200) }, { deadlines: 200 });
  assert.equal(manyConferences.deadlines.h, 376); // do not open the entire collapsed conference list
  assert.equal(manyConferences.arxiv.y, 382);
});
