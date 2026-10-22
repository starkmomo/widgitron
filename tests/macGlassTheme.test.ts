import assert from "node:assert/strict";
import test from "node:test";
import type { WidgetTheme } from "../src/types/theme.ts";

Object.defineProperty(globalThis, "navigator", {
  value: { userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)" }, configurable: true,
});
const { resolveWidgetTheme } = await import("../src/utils/widgetTheme.ts");
const { resolveSidebarTheme, sidebarThemeOptions } = await import("../src/utils/sidebarTheme.ts");
const { widgetCardStyle, resolveGlassCardBackground } = await import("../src/utils/glassCardBackground.ts");
const { copyFloatingTheme } = await import("../src/utils/floatingAppearance.ts");
const { assignFloatingPreset, floatingAppearanceMode } = await import("../src/utils/floatingAppearance.ts");
const { duplicateSidebarTheme } = await import("../src/utils/sidebarTheme.ts");

const glass: WidgetTheme = {
  id: "theme-quota-glass", name: "Quota Glass", is_default: true,
  bg_color: "#ffffff", bg_opacity: 0.05, material: "native-glass",
  text_colors: [{ name: "Main Text", value: "#000000" }, { name: "Sub Text", value: "#000000" }],
  primary_colors: [],
};

test("macOS Glass uses Liquid Glass and the separate trial selection remains compatible", () => {
  const liquid: WidgetTheme = { ...glass, id: "theme-quota-liquid", material: "native-liquid-glass" };
  const config = assignFloatingPreset({ themes: [glass, liquid], assignments: {} }, "widget-quota-default", "glass");
  assert.equal(config.assignments["widget-quota-default"], glass.id);
  assert.equal(floatingAppearanceMode(config, "widget-quota-default"), "glass");
  const active = resolveWidgetTheme(config, "widget-quota-default", "quota")!;
  assert.equal(active.material, "native-liquid-glass");
  assert.equal(active.bg_color, "#000000");
  assert.equal(active.bg_opacity, 0.08);
  assert.deepEqual(active.card_background, { color: "#000000", opacity: 0.08 });
  assert.equal(active.text_colors[0].value, "#ffffff");
  const copy = copyFloatingTheme(config, "widget-quota-default", "dark")!;
  assert.equal(copy.theme.material, "native-liquid-glass");
  assert.equal(copy.theme.bg_opacity, 0.08);
  assert.deepEqual(copy.theme.card_background, { color: "#000000", opacity: 0.08 });
  assert.equal(config.themes[0], glass);
  const sidebar = duplicateSidebarTheme({ active_theme_id: "liquid" });
  assert.equal(sidebar.theme.material, "native-liquid-glass");
  assert.equal(sidebar.theme.blur, 0);
  assert.equal(sidebar.theme.card_opacity, 0);
  assert.equal(sidebar.theme.background, "#000000");
  assert.equal(sidebar.theme.background_opacity, active.bg_opacity);
  assert.deepEqual(sidebar.theme.card_background, active.card_background);
  const legacy = { ...config, assignments: { "widget-quota-default": liquid.id } };
  assert.equal(floatingAppearanceMode(legacy, "widget-quota-default"), "glass");
  assert.deepEqual(resolveWidgetTheme(legacy, "widget-quota-default"), active);
  const options = sidebarThemeOptions();
  assert.equal(options.filter(theme => theme.material === "native-liquid-glass").length, 1);
  assert.equal(options.find(theme => theme.id === "glass")!.name, "Liquid Glass");
  assert.equal(resolveSidebarTheme({ active_theme_id: "liquid" }).id, "glass");
});

test("saved custom Liquid Glass keeps its chosen tint instead of preset defaults", () => {
  const custom: WidgetTheme = { ...glass, id: "custom-liquid", is_default: false,
    material: "native-liquid-glass", bg_color: "#345678", bg_opacity: 0.2,
    card_background: { color: "#123456", opacity: 0 } };
  const config = JSON.parse(JSON.stringify({ themes: [custom], assignments: { "widget-quota-default": custom.id } }));
  assert.deepEqual(resolveWidgetTheme(config, "widget-quota-default"), custom);
  const sidebar = resolveSidebarTheme({ active_theme_id: "custom-liquid", themes: [{
    ...custom, preset: "custom", background: custom.bg_color, background_opacity: custom.bg_opacity,
  }] });
  assert.equal(sidebar.background, custom.bg_color);
  assert.equal(sidebar.background_opacity, custom.bg_opacity);
  assert.deepEqual(sidebar.card_background, custom.card_background);
});

test("macOS built-in glass uses the native liquid material with 8 percent black fills", () => {
  const theme = resolveWidgetTheme({ themes: [glass], assignments: { "widget-quota-default": glass.id } }, "widget-quota-default", "quota")!;
  assert.equal(theme.material, "native-liquid-glass");
  assert.equal(theme.bg_color, "#000000");
  assert.equal(theme.bg_opacity, 0.08);
  assert.deepEqual(theme.text_colors, [
    { name: "Main Text", value: "#ffffff", opacity: 1 },
    { name: "Sub Text", value: "#f4f4f5", opacity: 1 },
  ]);
});

test("macOS sidebar uses the same thin tint without stacking module backgrounds", () => {
  const theme = resolveSidebarTheme({ active_theme_id: "glass" });
  assert.equal(theme.material, "native-liquid-glass");
  assert.equal(theme.background, "#000000");
  assert.equal(theme.header, "#000000");
  assert.equal(theme.background_opacity, 0.08);
  assert.equal(theme.header_opacity, 0.06);
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

test("macOS custom glass upgrades its material while keeping chosen colors", () => {
  const custom = { ...glass, id: "my-glass", is_default: false, bg_color: "#123456", bg_opacity: 0.42 };
  const resolved = resolveWidgetTheme({ themes: [custom], assignments: { "widget-quota-default": custom.id } }, "widget-quota-default", "quota");
  assert.deepEqual(resolved, { ...custom, material: "native-liquid-glass" });
});

test("glass card tint keeps the existing default and honors clear custom cards", () => {
  const theme = resolveWidgetTheme({ themes: [glass], assignments: { "widget-quota-default": glass.id } }, "widget-quota-default", "quota")!;
  assert.deepEqual(resolveGlassCardBackground(theme), { color: "#000000", opacity: 0.08 });
  assert.deepEqual(widgetCardStyle(theme), { backgroundColor: "rgba(0, 0, 0, 0.08)" });
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
