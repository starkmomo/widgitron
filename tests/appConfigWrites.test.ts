import assert from "node:assert/strict";
import test from "node:test";
import { appConfigPatch, createAppConfigWriter } from "../src/utils/appConfigWrites.ts";
import type { AppConfig } from "../src/types/config.ts";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

const settle = () => new Promise<void>(resolve => setImmediate(resolve));
const initial: AppConfig = { theme: "light", language: "en", sidebar_pinned: false };

function fixture(read?: () => Promise<AppConfig>) {
  let disk = { ...initial };
  let reads = 0;
  const starts: { config: AppConfig; base: AppConfig; gate: ReturnType<typeof deferred<void>> }[] = [];
  const applied: AppConfig[] = [];
  const errors: unknown[] = [];
  const writer = createAppConfigWriter({
    initial,
    save: async (config, base) => {
      const gate = deferred<void>();
      starts.push({ config, base, gate });
      await gate.promise;
      disk = { ...disk, ...appConfigPatch(base, config) };
    },
    read: async () => { reads += 1; return read ? read() : { ...disk }; },
    apply: config => applied.push(config),
    onError: error => errors.push(error),
  });
  return {
    writer, starts, applied, errors,
    reads: () => reads,
    disk: () => disk,
    native(patch: Partial<AppConfig>) { disk = { ...disk, ...patch }; writer.receive({ ...disk }); },
  };
}

test("old save events, stale input props and native pins preserve unrelated settings", async () => {
  const f = fixture();
  const a = f.writer.save(initial, { ...initial, theme: "dark" });
  // Both callbacks can run before React provides new props to the controls.
  const b = f.writer.save(initial, { ...initial, language: "zh-CN" });
  assert.deepEqual(f.writer.current(), { ...initial, theme: "dark", language: "zh-CN" });
  await settle();
  assert.equal(f.starts.length, 1, "Save requests must be serialized");
  f.writer.receive({ ...initial, theme: "dark" });
  assert.equal(f.writer.current().language, "zh-CN", "The first save event must not undo the second input");
  f.native({ sidebar_pinned: true });
  const visible = f.writer.current();
  const c = f.writer.save(visible, { ...visible, hide_on_startup: true });
  for (let index = 0; index < 3; index += 1) {
    assert.equal(f.starts.length, index + 1);
    f.starts[index].gate.resolve();
    await settle();
  }
  await Promise.all([a, b, c]);
  assert.deepEqual(f.writer.current(), {
    ...initial, theme: "dark", language: "zh-CN", sidebar_pinned: true, hide_on_startup: true,
  });
  assert.deepEqual(f.disk(), f.writer.current());
  assert.equal(f.reads(), 1, "Read back only after this batch drains");
  assert.deepEqual(f.starts[1].base, initial, "Send the original UI base to the backend patch merger");
  f.native({ language: "en" });
  assert.equal(f.writer.current().language, "en", "Finished edits cannot mask future native changes");
});

test("a failed save rolls back and does not block later writes", async () => {
  const f = fixture();
  const failed = assert.rejects(f.writer.save(initial, { ...initial, theme: "dark" }), /disk failure/);
  const following = f.writer.save(initial, { ...initial, language: "zh-CN" });
  await settle();
  f.starts[0].gate.reject(new Error("disk failure"));
  await settle();
  assert.equal(f.starts.length, 2);
  assert.equal(f.writer.current().theme, "light");
  f.starts[1].gate.resolve();
  await Promise.all([failed, following]);
  assert.deepEqual(f.writer.current(), { ...initial, language: "zh-CN" });
  assert.equal(f.errors.length, 1);
});

test("the final failed write reads disk and retires its optimistic patch", async () => {
  const f = fixture();
  const failed = assert.rejects(f.writer.save(initial, { ...initial, theme: "dark" }), /disk failure/);
  await settle();
  f.starts[0].gate.reject(new Error("disk failure"));
  await failed;
  assert.deepEqual(f.writer.current(), initial);
  assert.equal(f.reads(), 1);
  f.native({ theme: "dark" });
  f.native({ theme: "light" });
  assert.equal(f.writer.current().theme, "light");
});

test("a failed reconciliation read retains successful writes without leaving pending edits", async () => {
  const f = fixture(async () => { throw new Error("read failure"); });
  const save = f.writer.save(initial, { ...initial, theme: "dark" });
  await settle();
  f.starts[0].gate.resolve();
  await save;
  assert.equal(f.writer.current().theme, "dark");
  assert.equal(f.errors.length, 1);
  f.native({ theme: "light", sidebar_pinned: true });
  assert.equal(f.writer.current().theme, "light");
  assert.equal(f.writer.current().sidebar_pinned, true);
});

test("a native event arriving during the final read wins over that stale read", async () => {
  const read = deferred<AppConfig>();
  const f = fixture(() => read.promise);
  const save = f.writer.save(initial, { ...initial, theme: "dark" });
  await settle();
  f.starts[0].gate.resolve();
  await settle();
  f.native({ sidebar_pinned: true });
  read.resolve({ ...initial, theme: "dark" });
  await save;
  assert.equal(f.writer.current().sidebar_pinned, true);
  assert.equal(f.writer.current().theme, "dark");
});

test("a new edit during reconciliation remains optimistic and is saved in the next batch", async () => {
  const firstRead = deferred<AppConfig>();
  let readCount = 0;
  const f = fixture(async () => ++readCount === 1 ? firstRead.promise : f.disk());
  const a = f.writer.save(initial, { ...initial, theme: "dark" });
  await settle();
  f.starts[0].gate.resolve();
  await settle();
  const visible = f.writer.current();
  const b = f.writer.save(visible, { ...visible, language: "zh-CN" });
  firstRead.resolve({ ...initial, theme: "dark" });
  await a;
  await settle();
  assert.equal(f.writer.current().language, "zh-CN");
  assert.equal(f.starts.length, 2);
  f.starts[1].gate.resolve();
  await b;
  assert.deepEqual(f.writer.current(), { ...initial, theme: "dark", language: "zh-CN" });
});

test("UI snapshots cannot change native-owned visibility and unchanged fields do not write", async () => {
  const f = fixture();
  await f.writer.save(initial, { ...initial, active_widgets: { "widget-quota-default": true }, widgets_hidden: true });
  await f.writer.save(initial, { ...initial });
  assert.equal(f.starts.length, 0);
  assert.deepEqual(f.writer.current(), initial);
});
