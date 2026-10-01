import assert from "node:assert/strict";
import test from "node:test";
import { startWindowSnapshotSync } from "../src/utils/windowSnapshotSync.ts";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

test("a newer theme/module event wins over the pending startup read", async () => {
  type Config = { theme: string; gpu: boolean };
  const initial = deferred<Config>();
  const applied: Config[] = [];
  let emit!: (value: Config) => void;
  const sync = startWindowSnapshotSync({
    listen: async (handler) => { emit = handler; return () => {}; },
    read: () => initial.promise,
    apply: (value) => applied.push(value),
    onError: (error) => { throw error; },
  });
  await Promise.resolve();
  const latest = { theme: "midnight", gpu: false };
  emit(latest);
  assert.deepEqual(applied, [latest]);
  initial.resolve({ theme: "light", gpu: true });
  await sync.ready;
  assert.deepEqual(applied, [latest]);
  sync.stop();
});

test("a reveal event is not replaced by an older collapsed state", async () => {
  const initial = deferred<boolean>();
  const states: boolean[] = [];
  let emit!: (value: boolean) => void;
  const sync = startWindowSnapshotSync({
    listen: async (handler) => { emit = handler; return () => {}; },
    read: () => initial.promise,
    apply: (value) => states.push(value),
    onError: (error) => { throw error; },
  });
  await Promise.resolve();
  emit(true);
  initial.resolve(false);
  await sync.ready;
  assert.deepEqual(states, [true]);
  sync.stop();
});

test("cleanup removes a late listener and ignores subsequent events", async () => {
  const registration = deferred<() => void>();
  let stopped = 0;
  let reads = 0;
  let emit!: (value: number) => void;
  const applied: number[] = [];
  const sync = startWindowSnapshotSync({
    listen: (handler) => { emit = handler; return registration.promise; },
    read: async () => { reads += 1; return 1; },
    apply: (value) => applied.push(value),
    onError: (error) => { throw error; },
  });
  sync.stop();
  registration.resolve(() => { stopped += 1; });
  await sync.ready;
  emit(2);
  assert.equal(stopped, 1);
  assert.equal(reads, 0);
  assert.deepEqual(applied, []);
});

test("a failed initial read does not remove the settings listener", async () => {
  let emit!: (value: string) => void;
  const applied: string[] = [];
  const errors: unknown[] = [];
  const sync = startWindowSnapshotSync({
    listen: async (handler) => { emit = handler; return () => {}; },
    read: async () => { throw new Error("temporary read failure"); },
    apply: (value) => applied.push(value),
    onError: (error) => errors.push(error),
  });
  await sync.ready;
  emit("midnight");
  assert.equal(errors.length, 1);
  assert.deepEqual(applied, ["midnight"]);
  sync.stop();
});
