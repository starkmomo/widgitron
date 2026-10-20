import assert from "node:assert/strict";
import test from "node:test";
import type { WidgetTheme } from "../src/types/theme.ts";

Object.defineProperty(globalThis, "navigator", {
  value: { userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)" }, configurable: true,
});
const { resolveWidgetTheme } = await import("../src/utils/widgetTheme.ts");
const { resolveSidebarTheme } = await import("../src/utils/sidebarTheme.ts");
const { widgetCardStyle, resolveGlassCardBackground } = await import("../src/utils/glassCardBackground.ts");
const { copyFloatingTheme } = await import("../src/utils/floatingAppearance.ts");

const glass: WidgetTheme = {
  id: "theme-quota-glass", name: "Quota Glass", is_default: true,
  bg_color: "#ffffff", bg_opacity: 0.05, material: "native-glass",
  text_colors: [{ name: "Main Text", value: "#000000" }, { name: "Sub Text", value: "#000000" }],
  primary_colors: [],
};

test("macOS built-in glass uses a thin neutral tint and opaque bright text", () => {
  const theme = resolveWidgetTheme({ themes: [glass], assignments: { "widget-quota-default": glass.id } }, "widget-quota-default", "quota")!;
  assert.equal(theme.bg_color, "#18181b");
  assert.equal(theme.bg_opacity, 0.02);
  assert.deepEqual(theme.text_colors, [
    { name: "Main Text", value: "#ffffff", opacity: 1 },
    { name: "Sub Text", value: "#f4f4f5", opacity: 1 },
  ]);
});

test("macOS sidebar uses the same thin tint without stacking module backgrounds", () => {
  const theme = resolveSidebarTheme({ active_theme_id: "glass" });
  assert.equal(theme.material, "native-glass");
  assert.equal(theme.background, "#18181b");
  assert.equal(theme.header, "#18181b");
  assert.equal(theme.background_opacity, 0.02);
  assert.equal(theme.header_opacity, 0.08);
  assert.equal(theme.card_opacity, 0);
  assert.equal(theme.blur, 0);
});

test("macOS sidebar glass text follows the actual background appearance", () => {
  const theme = resolveWidgetTheme({ themes: [{ ...glass, id: "theme-quota-default" }], assignments: {} }, "sidebar", "quota", { sidebarGlass: true, sidebarLight: true })!;
  assert.equal(theme.text_colors[0].value, "#0b1220");
  assert.equal(theme.text_colors[1].value, "#1e293b");
  const dark = resolveWidgetTheme({ themes: [{ ...glass, id: "theme-quota-default" }], assignments: {} }, "sidebar", "quota", { sidebarGlass: true, sidebarLight: false })!;
  assert.equal(dark.text_colors[0].value, "#ffffff");
  assert.equal(dark.text_colors[1].value, "#f1f5f9");
});

test("macOS custom glass retains its chosen appearance", () => {
  const custom = { ...glass, id: "my-glass", is_default: false, bg_color: "#123456", bg_opacity: 0.42 };
  const resolved = resolveWidgetTheme({ themes: [custom], assignments: { "widget-quota-default": custom.id } }, "widget-quota-default", "quota");
  assert.deepEqual(resolved, custom);
});

test("glass card tint keeps the existing default and honors clear custom cards", () => {
  const theme = resolveWidgetTheme({ themes: [glass], assignments: { "widget-quota-default": glass.id } }, "widget-quota-default", "quota")!;
  assert.deepEqual(resolveGlassCardBackground(theme), { color: "#000000", opacity: 0.12 });
  assert.equal(widgetCardStyle(theme), undefined);
  const custom = { ...theme, card_background: { color: "#c0ffee", opacity: 0 } };
  assert.deepEqual(widgetCardStyle(custom), { backgroundColor: "rgba(192, 255, 238, 0)" });
  assert.deepEqual(widgetCardStyle({ ...custom, material: undefined }), { backgroundColor: "rgba(192, 255, 238, 0)" });
});

test("copying and saving custom glass keeps an independent card color and zero opacity", () => {
  const custom = { ...glass, id: "my-glass", is_default: false, card_background: { color: "#123456", opacity: 0 } };
  const copied = copyFloatingTheme({ themes: [custom], assignments: { "widget-quota-default": custom.id } }, "widget-quota-default", "dark")!;
  const restored = resolveWidgetTheme(JSON.parse(JSON.stringify(copied.config)), "widget-quota-default", "quota")!;
  assert.deepEqual(restored.card_background, custom.card_background);
  copied.theme.card_background!.opacity = 0.5;
  assert.equal(custom.card_background.opacity, 0);
});
