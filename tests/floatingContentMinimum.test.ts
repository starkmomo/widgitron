import assert from "node:assert/strict";
import test from "node:test";
import { observeFloatingContentMinimum } from "../src/utils/floatingContentMinimum.ts";

class FakeObserver {
  static instances: FakeObserver[] = [];
  targets: unknown[] = [];
  callback: () => void;
  constructor(callback: () => void) { this.callback = callback; FakeObserver.instances.push(this); }
  observe(target: unknown) { this.targets.push(target); }
  disconnect() { this.targets = []; }
}

test("measures one complete card plus framing, not the viewport, other cards or scroll offset", () => {
  const original = { resize: globalThis.ResizeObserver, mutation: globalThis.MutationObserver, style: globalThis.getComputedStyle };
  globalThis.ResizeObserver = FakeObserver as unknown as typeof ResizeObserver;
  globalThis.MutationObserver = FakeObserver as unknown as typeof MutationObserver;
  FakeObserver.instances = [];
  try {
    let scroll = 0;
    let viewportTop = 150;
    let windowHeight = 600;
    let windowWidth = 400;
    let naturalHeight = 600;
    let firstHeight = 80;
    let timelineHeight = 0;
    const timeline = { getBoundingClientRect: () => ({ height: timelineHeight + 20 }),
      querySelector: () => ({ getBoundingClientRect: () => ({ height: 20 }) }) };
    let natural: { parentElement: unknown; querySelector: () => unknown; getBoundingClientRect: () => unknown } | null = null;
    let card = { getBoundingClientRect: () => ({ top: viewportTop - scroll, height: firstHeight }),
      querySelectorAll: () => timelineHeight ? [timeline] : [] };
    const viewport = { parentElement: null as unknown, getBoundingClientRect: () => ({ top: viewportTop, height: windowHeight - 50 }) };
    const shell = { querySelector: () => natural, getBoundingClientRect: () => ({ top: 100, width: windowWidth, height: windowHeight }) } as unknown as HTMLElement;
    const body = { parentElement: shell };
    viewport.parentElement = body;
    globalThis.getComputedStyle = ((node: unknown) => ({
      paddingBottom: node === viewport ? "8px" : node === body ? "12px" : "0px",
      borderBottomWidth: node === body ? "1px" : "0px",
      paddingTop: "0px", borderTopWidth: "0px", marginBottom: "0px",
    })) as typeof getComputedStyle;
    const values: number[] = [];
    const stop = observeFloatingContentMinimum(shell, (height) => values.push(height));
    const [resize, mutation] = FakeObserver.instances;
    assert.deepEqual(values, []); // No theme/list on the first render.
    natural = { parentElement: viewport, querySelector: () => card,
      getBoundingClientRect: () => ({ top: viewportTop - scroll, height: naturalHeight }) };
    mutation.callback();
    assert.deepEqual(values, [152]);

    windowHeight = 1400;
    naturalHeight = 2500;
    scroll = 70;
    resize.callback();
    assert.deepEqual(values, [152]); // User resizing, later cards and scrolling cannot inflate the minimum.
    firstHeight = 120;
    resize.callback();
    assert.equal(values.at(-1), 192); // A real additional quota bar needs space.
    timelineHeight = 300;
    firstHeight = 420;
    mutation.callback();
    assert.equal(values.at(-1), 192); // An open conference timeline scrolls without raising the native minimum.
    timelineHeight = 0;
    firstHeight = 80;
    resize.callback();
    assert.equal(values.at(-1), 152);

    viewportTop = 170; // A real warning/banner above the list needs space too.
    mutation.callback();
    assert.equal(values.at(-1), 172);
    windowWidth = 0;
    firstHeight = 200;
    resize.callback();
    assert.equal(values.at(-1), 172); // Hidden native windows cannot replace a valid measurement with zero geometry.
    windowWidth = 400;
    resize.callback();
    assert.equal(values.at(-1), 292);

    const oldCard = card;
    card = { getBoundingClientRect: () => ({ top: viewportTop - scroll + 8, height: 55 }), querySelectorAll: () => [] };
    mutation.callback();
    assert.ok(!resize.targets.includes(oldCard));
    assert.ok(resize.targets.includes(card));
    assert.equal(values.at(-1), 155); // Includes the new first card's top margin.
    stop();
    const count = values.length;
    resize.callback();
    mutation.callback();
    assert.equal(values.length, count);
    assert.deepEqual(resize.targets, []);
    assert.deepEqual(mutation.targets, []);
  } finally {
    globalThis.ResizeObserver = original.resize;
    globalThis.MutationObserver = original.mutation;
    globalThis.getComputedStyle = original.style;
  }
});
