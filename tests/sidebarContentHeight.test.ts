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
  globalThis.ResizeObserver = FakeObserver as unknown as typeof ResizeObserver;
  globalThis.MutationObserver = FakeObserver as unknown as typeof MutationObserver;
  FakeObserver.instances = [];
  try {
    const viewport = { getBoundingClientRect: () => ({ top: 150 }) };
    let content: { parentElement: typeof viewport; getBoundingClientRect: () => { height: number } } | null = null;
    let expanded = false;
    const section = {
      querySelector: (selector: string) => selector === "details[open]" ? expanded ? {} : null : content,
      getBoundingClientRect: () => ({ top: 100 }),
    } as unknown as HTMLElement;
    const heights: number[] = [];
    const stop = observeSidebarContentHeight(section, (height) => { heights.push(height); });
    const [resize, mutation] = FakeObserver.instances;
    assert.deepEqual(heights, []);
    assert.deepEqual(mutation.targets, [section]);

    let intrinsicHeight = 80;
    content = { parentElement: viewport, getBoundingClientRect: () => ({ height: intrinsicHeight }) };
    mutation.callback();
    assert.deepEqual(heights, [148]);
    assert.ok(resize.targets.includes(content));
    resize.callback();
    assert.deepEqual(heights, [148]); // viewport dragging does not inflate intrinsic height
    intrinsicHeight = 180;
    resize.callback();
    assert.deepEqual(heights, [148, 248]);
    expanded = true;
    intrinsicHeight = 360;
    mutation.callback();
    assert.equal(heights.at(-1), 428);
    expanded = false;
    intrinsicHeight = 180;
    mutation.callback();
    assert.equal(heights.at(-1), 248);

    const oldContent = content;
    content = { parentElement: viewport, getBoundingClientRect: () => ({ height: 60 }) };
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
  }
});
