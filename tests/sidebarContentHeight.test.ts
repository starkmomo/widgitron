import assert from "node:assert/strict";
import test from "node:test";
import { observeSidebarContentHeight } from "../src/utils/sidebarContentHeight.ts";

class FakeObserver {
  static instances: FakeObserver[] = [];
  targets: unknown[] = [];
  callback: () => void;
  constructor(callback: () => void) { this.callback = callback; FakeObserver.instances.push(this); }
  observe(target: unknown) { this.targets.push(target); }
  disconnect() { this.targets = []; }
}

test("observes a list inserted after async theme loading, measures replacement, and cleans up", () => {
  const previousResize = globalThis.ResizeObserver;
  const previousMutation = globalThis.MutationObserver;
  const previousStyle = globalThis.getComputedStyle;
  globalThis.ResizeObserver = FakeObserver as unknown as typeof ResizeObserver;
  globalThis.MutationObserver = FakeObserver as unknown as typeof MutationObserver;
  FakeObserver.instances = [];
  try {
    let viewportHeight = 500;
    const viewport = { parentElement: null as unknown, getBoundingClientRect: () => ({ top: 150, height: viewportHeight }) };
    let content: { parentElement: typeof viewport; querySelector: () => null; querySelectorAll: () => never[]; getBoundingClientRect: () => { height: number } } | null = null;
    let expanded = false;
    const section = {
      querySelector: (selector: string) => selector === "details[open]" ? expanded ? {} : null : content,
      getBoundingClientRect: () => ({ top: 100 }),
    } as unknown as HTMLElement;
    const body = { parentElement: section };
    viewport.parentElement = body;
    globalThis.getComputedStyle = ((node: unknown) => ({
      paddingBottom: node === viewport || node === body ? "8px" : "0px",
      borderBottomWidth: node === section ? "2px" : "0px",
      paddingTop: "0px", borderTopWidth: "0px", marginBottom: "0px",
    })) as typeof getComputedStyle;
    const heights: number[] = [];
    const stop = observeSidebarContentHeight(section, (height) => { heights.push(height); });
    const [resize, mutation] = FakeObserver.instances;
    assert.deepEqual(heights, []);
    assert.deepEqual(mutation.targets, [section]);

    let intrinsicHeight = 80;
    content = { parentElement: viewport, querySelector: () => null, querySelectorAll: () => [], getBoundingClientRect: () => ({ height: intrinsicHeight }) };
    mutation.callback();
    assert.deepEqual(heights, [148]);
    assert.ok(resize.targets.includes(content));
    viewportHeight = 1800;
    resize.callback();
    assert.deepEqual(heights, [148]); // viewport dragging does not inflate intrinsic height
    intrinsicHeight = 81;
    resize.callback();
    assert.deepEqual(heights, [148, 149]); // don't clip a one-pixel increase
    intrinsicHeight = 180;
    resize.callback();
    assert.deepEqual(heights, [148, 149, 248]);
    expanded = true;
    intrinsicHeight = 360;
    mutation.callback();
    assert.equal(heights.at(-1), 428);
    expanded = false;
    intrinsicHeight = 180;
    mutation.callback();
    assert.equal(heights.at(-1), 248);

    const oldContent = content;
    content = { parentElement: viewport, querySelector: () => null, querySelectorAll: () => [], getBoundingClientRect: () => ({ height: 60 }) };
    mutation.callback();
    assert.equal(resize.targets.includes(oldContent), false);
    assert.ok(resize.targets.includes(content));
    assert.equal(heights.at(-1), 128);

    stop();
    const count = heights.length;
    mutation.callback();
    resize.callback();
    assert.equal(heights.length, count);
    assert.deepEqual(resize.targets, []);
    assert.deepEqual(mutation.targets, []);
  } finally {
    globalThis.ResizeObserver = previousResize;
    globalThis.MutationObserver = previousMutation;
    globalThis.getComputedStyle = previousStyle;
  }
});

test("minimum follows the complete first card and framing, while maximum includes all cards", () => {
  const previous = { resize: globalThis.ResizeObserver, mutation: globalThis.MutationObserver, style: globalThis.getComputedStyle };
  globalThis.ResizeObserver = FakeObserver as unknown as typeof ResizeObserver;
  globalThis.MutationObserver = FakeObserver as unknown as typeof MutationObserver;
  FakeObserver.instances = [];
  try {
    let viewportTop = 150;
    let scroll = 0;
    let viewportHeight = 1000;
    let sectionWidth = 400;
    let totalHeight = 80;
    let firstHeight = 80;
    let expanded = false;
    let firstTimelineHeight = 0;
    let laterTimelineHeight = 0;
    const timeline = (height: () => number) => ({
      getBoundingClientRect: () => ({ height: height() + 20 }),
      querySelector: () => ({ getBoundingClientRect: () => ({ height: 20 }) }),
    });
    const firstTimeline = timeline(() => firstTimelineHeight);
    const laterTimeline = timeline(() => laterTimelineHeight);
    let firstTopMargin = 0;
    let contentBottomPadding = 0;
    let card = { getBoundingClientRect: () => ({ top: viewportTop - scroll + firstTopMargin, height: firstHeight }),
      querySelectorAll: () => firstTimelineHeight ? [firstTimeline] : [] };
    const viewport = { parentElement: null as unknown, getBoundingClientRect: () => ({ top: viewportTop, height: viewportHeight }) };
    const content = {
      parentElement: viewport,
      querySelector: () => card,
      querySelectorAll: () => [...(firstTimelineHeight ? [firstTimeline] : []), ...(laterTimelineHeight ? [laterTimeline] : [])],
      getBoundingClientRect: () => ({ top: viewportTop - scroll, height: totalHeight }),
    };
    const section = {
      querySelector: (selector: string) => selector === "details[open]" ? expanded ? {} : null : content,
      getBoundingClientRect: () => ({ top: 100, width: sectionWidth }),
    } as unknown as HTMLElement;
    const body = { parentElement: section };
    viewport.parentElement = body;
    globalThis.getComputedStyle = ((node: unknown) => ({
      paddingBottom: node === viewport || node === body ? "8px" : node === content ? `${contentBottomPadding}px` : "0px",
      borderBottomWidth: node === section ? "2px" : "0px",
      paddingTop: "0px", borderTopWidth: "0px", marginBottom: "0px",
    })) as typeof getComputedStyle;
    const values: { height: number; expanded: boolean; minimumHeight?: number }[] = [];
    const stop = observeSidebarContentHeight(section, (height, expanded, minimumHeight) => {
      values.push({ height, expanded, minimumHeight });
    });
    const [resize, mutation] = FakeObserver.instances;
    assert.deepEqual(values.at(-1), { height: 148, expanded: false, minimumHeight: 149 });
    assert.ok(resize.targets.includes(card));

    // A second Codex bar must increase the minimum, even if other content shrinks.
    firstHeight = 120;
    resize.callback();
    assert.deepEqual(values.at(-1), { height: 148, expanded: false, minimumHeight: 189 });
    totalHeight = 120;
    resize.callback();
    assert.deepEqual(values.at(-1), { height: 188, expanded: false, minimumHeight: 189 });

    totalHeight = 600; // More agents / servers / conferences change only the maximum.
    viewportHeight = 1800;
    scroll = 90;
    resize.callback();
    assert.deepEqual(values.at(-1), { height: 668, expanded: false, minimumHeight: 189 });
    expanded = true; // Expanding a later conference does not enlarge the first card.
    totalHeight = 900;
    laterTimelineHeight = 300;
    mutation.callback();
    assert.deepEqual(values.at(-1), { height: 668, expanded: true, minimumHeight: 189 });

    firstHeight = 320; // The first conference's timeline must not raise either size limit.
    firstTimelineHeight = 200;
    totalHeight = 1100;
    resize.callback();
    assert.deepEqual(values.at(-1), { height: 668, expanded: true, minimumHeight: 189 });
    viewportTop += 8; // Showing the colored title strip adds its actual height.
    contentBottomPadding = 4;
    mutation.callback();
    assert.equal(values.at(-1)?.minimumHeight, 201);

    const oldCard = card;
    firstHeight = 80;
    firstTimelineHeight = 0;
    totalHeight = 900;
    firstTopMargin = 6;
    card = { getBoundingClientRect: () => ({ top: viewportTop - scroll + firstTopMargin, height: firstHeight }), querySelectorAll: () => [] };
    mutation.callback();
    assert.ok(!resize.targets.includes(oldCard));
    assert.ok(resize.targets.includes(card));
    assert.equal(values.at(-1)?.minimumHeight, 167);
    const count = values.length;
    sectionWidth = 0;
    firstHeight = 0;
    resize.callback();
    assert.equal(values.length, count); // Hidden geometry cannot reset a good limit.
    stop();
    mutation.callback();
    resize.callback();
    assert.equal(values.length, count);
  } finally {
    globalThis.ResizeObserver = previous.resize;
    globalThis.MutationObserver = previous.mutation;
    globalThis.getComputedStyle = previous.style;
  }
});
