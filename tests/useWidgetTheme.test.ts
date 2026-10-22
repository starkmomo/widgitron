import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { isGlassMaterial } from "../src/utils/glassMaterial.ts";
import { isLightColor } from "../src/utils/color.ts";
import { resolveSidebarTheme } from "../src/utils/sidebarTheme.ts";
import { resolveWidgetTheme } from "../src/utils/widgetTheme.ts";
import { startWindowSnapshotSync } from "../src/utils/windowSnapshotSync.ts";
import type { WidgetTheme, WidgetThemeConfig } from "../src/types/theme.ts";

// Exercise the real hook with React lifecycle and Tauri IPC boundaries replaced.
// Keeping the actual snapshot coordinator/resolvers catches subscription order
// and stale-response bugs without starting a native WebView.
const hookCode = ts.transpileModule(
  readFileSync(new URL("../src/hooks/useWidgetTheme.ts", import.meta.url), "utf8"),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } },
).outputText;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

const settle = () => new Promise<void>((done) => setImmediate(done));

function themeConfig(color: string): WidgetThemeConfig {
  return {
    themes: [{ id: "theme-quota-default", name: "Quota", is_default: true,
      bg_color: color, bg_opacity: 1,
      text_colors: [{ name: "Main Text", value: "#eeeeee" }, { name: "Sub Text", value: "#aaaaaa" }],
      primary_colors: [] }],
    assignments: { "widget-quota-default": "theme-quota-default" },
  };
}

function mountTheme(label: string, delayedRegistrations: string[] = []) {
  const handlers = new Map<string, (event: { payload: unknown }) => void>();
  const gates = new Map(delayedRegistrations.map((event) => [event, deferred<void>()]));
  const reads = new Map<string, ReturnType<typeof deferred<unknown>>[]>();
  const stopped: string[] = [];
  const rendered: WidgetTheme[] = [];
  let cleanup = () => {};
  const exports: { useWidgetTheme?: (kind: string) => unknown } = {};
  const modules: Record<string, unknown> = {
    react: {
      useState: () => [null, (theme: WidgetTheme) => rendered.push(theme)],
      useEffect: (effect: () => () => void) => { cleanup = effect(); },
    },
    "@tauri-apps/api/window": { getCurrentWindow: () => ({ label }) },
    "../utils/glassMaterial": { isGlassMaterial },
    "../utils/color": { isLightColor },
    "../utils/sidebarTheme": { resolveSidebarTheme },
    "../utils/widgetTheme": { resolveWidgetTheme },
    "../utils/windowSnapshotSync": { startWindowSnapshotSync },
    "../utils/tauriInvoke": {
      tauriInvoke: (command: string) => {
        const pending = deferred<unknown>();
        reads.set(command, [...(reads.get(command) ?? []), pending]);
        return pending.promise;
      },
    },
    "../utils/tauriListen": {
      tauriListen: async (event: string, handler: (event: { payload: unknown }) => void) => {
        if (gates.has(event)) await gates.get(event)!.promise;
        handlers.set(event, handler);
        return () => { stopped.push(event); handlers.delete(event); };
      },
    },
  };
  runInNewContext(hookCode, {
    exports,
    require: (name: string) => {
      assert.ok(name in modules, `Unexpected hook dependency: ${name}`);
      return modules[name];
    },
    console,
  });
  exports.useWidgetTheme!("quota");
  return {
    reads, rendered, handlers, stopped,
    emit: (event: string, payload: unknown) => handlers.get(event)?.({ payload }),
    completeRegistration: (event: string) => gates.get(event)!.resolve(),
    unmount: () => cleanup(),
    resolve: (command: string, value: unknown, index = 0) => reads.get(command)![index].resolve(value),
  };
}

test("theme and app listeners are installed before their reads, and newer events win", async () => {
  const hook = mountTheme("widget-quota-default", ["theme_update", "app_config_update"]);
  assert.equal(hook.reads.size, 0);
  hook.completeRegistration("theme_update");
  hook.completeRegistration("app_config_update");
  await settle();
  assert.equal(hook.reads.get("get_theme_config")?.length, 1);
  assert.equal(hook.reads.get("get_app_config")?.length, 1);
  hook.emit("theme_update", themeConfig("#123456"));
  hook.emit("app_config_update", { theme: "dark" });
  hook.resolve("get_theme_config", themeConfig("#ffffff"));
  hook.resolve("get_app_config", { theme: "light" });
  await settle();
  assert.equal(hook.rendered.at(-1)?.bg_color, "#123456");
  assert.equal(hook.rendered.length, 1);
  hook.unmount();
});

test("an app update during startup preserves the independently loaded theme", async () => {
  const hook = mountTheme("sidebar");
  await settle();
  hook.emit("app_config_update", { sidebar_theme: { active_theme_id: "midnight" } });
  hook.resolve("get_app_config", { sidebar_theme: { active_theme_id: "light" } });
  hook.resolve("get_theme_config", themeConfig("#112233"));
  await settle();
  assert.equal(hook.rendered.at(-1)?.bg_color, "#112233");
  assert.equal(hook.rendered.at(-1)?.text_colors[0].value, "#eeeeee");
  hook.unmount();
});

test("sidebar reveal refreshes app appearance without older reads reverting it", async () => {
  const hook = mountTheme("sidebar");
  await settle();
  hook.resolve("get_theme_config", themeConfig("#112233"));
  hook.resolve("get_app_config", { sidebar_theme: { active_theme_id: "midnight" } });
  await settle();
  hook.emit("sidebar_state_update", { expanded: false });
  assert.equal(hook.reads.get("get_app_config")?.length, 1);
  hook.emit("sidebar_state_update", { expanded: true });
  hook.emit("sidebar_state_update", { expanded: true });
  assert.equal(hook.reads.get("get_app_config")?.length, 3);
  hook.resolve("get_app_config", { sidebar_theme: { active_theme_id: "midnight" } }, 2);
  await settle();
  assert.equal(hook.rendered.at(-1)?.bg_color, "#112233");
  assert.equal(hook.rendered.at(-1)?.text_colors[0].value, "#eeeeee");
  hook.resolve("get_app_config", { sidebar_theme: { active_theme_id: "light" } }, 1);
  await settle();
  assert.equal(hook.rendered.at(-1)?.bg_color, "#112233");
  assert.equal(hook.rendered.at(-1)?.text_colors[0].value, "#eeeeee");
  hook.emit("sidebar_state_update", { expanded: true });
  hook.resolve("get_app_config", { sidebar_theme: { active_theme_id: "light" } }, 3);
  await settle();
  // Light sidebar resolves bright card text from the fresh app snapshot.
  assert.equal(hook.rendered.at(-1)?.bg_color, "#112233");
  assert.equal(hook.rendered.at(-1)?.text_colors[0].value, "#0f172a");
  assert.equal(hook.rendered.length, 3);
  hook.unmount();
});

test("unmount removes all late registrations without starting reads or rendering", async () => {
  const events = ["theme_update", "app_config_update", "sidebar_state_update"];
  const hook = mountTheme("sidebar", events);
  hook.unmount();
  events.forEach(hook.completeRegistration);
  await settle();
  assert.deepEqual([...hook.stopped].sort(), [...events].sort());
  assert.equal(hook.reads.size, 0);
  assert.equal(hook.handlers.size, 0);
  assert.equal(hook.rendered.length, 0);
});
