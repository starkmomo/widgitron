import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

// Execute the actual effect callbacks without mounting the settings UI or
// starting native services. IPC registration can then be paused at each await.
const source = ts.createSourceFile("SettingsPanel.tsx",
  readFileSync(new URL("../src/settings/SettingsPanel.tsx", import.meta.url), "utf8"),
  ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

function loadEffect(marker: string, globals: Record<string, unknown>): () => () => void {
  let callback: ts.Expression | undefined;
  function visit(node: ts.Node) {
    if (ts.isCallExpression(node) && node.expression.getText(source) === "useEffect"
      && node.arguments[0]?.getText(source).includes(marker)) {
      assert.equal(callback, undefined, `Ambiguous effect: ${marker}`);
      callback = node.arguments[0];
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(callback, `Missing effect: ${marker}`);
  const javascript = ts.transpileModule(`(${callback.getText(source)})`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  return vm.runInNewContext(javascript, globals);
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

const settle = () => new Promise<void>(resolve => setImmediate(resolve));

function serviceGlobals(register: (name: string) => Promise<() => void>, errors: unknown[]) {
  const noop = () => {};
  return {
    activeSection: "general", isLiveDataSection: () => false,
    listenServiceUpdateEvents: () => register("services"),
    listenBackendServiceError: (name: string) => register(name),
    listenGpuDataSync: () => register("gpu-sync"),
    setGpuRefreshError: noop, setDeadlinesRefreshError: noop,
    setPaperBackendError: noop, setArxivRefreshError: noop,
    setArxivBackendError: noop, setLiveGpuData: noop,
    setLiveArxivPapers: noop,
    console: { error: (...args: unknown[]) => errors.push(args) },
  };
}

for (let pendingIndex = 0; pendingIndex < 4; pendingIndex += 1) {
  test(`settings removes registrations that finish after unmount at await ${pendingIndex + 1}`, async () => {
    const registration = deferred<() => void>();
    const registered: string[] = [];
    const removed: string[] = [];
    const errors: unknown[] = [];
    const globals = serviceGlobals(async name => {
      registered.push(name);
      if (registered.length - 1 === pendingIndex) return registration.promise;
      return () => { removed.push(name); };
    }, errors);
    const cleanup = loadEffect("const u1 = await listenServiceUpdateEvents(", globals)();
    await settle();
    cleanup();
    const pendingName = registered[pendingIndex];
    registration.resolve(() => { removed.push(pendingName); });
    await settle();
    assert.equal(registered.length, pendingIndex + 1, "Do not subscribe to more events after unmount");
    assert.deepEqual(removed.sort(), [...registered].sort(), "Every registration must be removed once");
    assert.deepEqual(errors, []);
  });
}

test("failed settings registration releases earlier subscriptions", async () => {
  const removed: string[] = [];
  const errors: unknown[] = [];
  const globals = serviceGlobals(async name => {
    if (name === "arxiv_error") throw new Error("registration failed");
    return () => { removed.push(name); };
  }, errors);
  const cleanup = loadEffect("const u1 = await listenServiceUpdateEvents(", globals)();
  await settle();
  assert.deepEqual(removed.sort(), ["paper_error", "services"]);
  assert.equal(errors.length, 1);
  cleanup();
  assert.equal(removed.length, 2, "Unmount must not remove subscriptions twice");
});

test("OTA progress listener is removed after late registration and ignores unmounted events", async () => {
  const registration = deferred<() => void>();
  let removed = 0;
  let updates = 0;
  let onProgress!: (event: { payload: { state: string; progress: number } }) => void;
  const cleanup = loadEffect('tauriListen("ota_download_progress"', {
    tauriListen: (_name: string, handler: typeof onProgress) => {
      onProgress = handler;
      return registration.promise;
    },
    setDownloadState: () => { updates += 1; },
    setDownloadProgress: () => { updates += 1; },
    setUpdateError: () => { updates += 1; },
    console,
  })();
  onProgress({ payload: { state: "downloading", progress: 25 } });
  assert.equal(updates, 2);
  cleanup();
  registration.resolve(() => { removed += 1; });
  await settle();
  onProgress({ payload: { state: "downloading", progress: 50 } });
  assert.equal(updates, 2);
  assert.equal(removed, 1);
});
