import assert from "node:assert/strict";
import test from "node:test";
import type { WidgetTheme } from "../src/types/theme.ts";

// These tests run in their own Node worker, emulating WebView2's platform.
Object.defineProperty(globalThis, "navigator", {
  value: { userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" }, configurable: true,
});
const { resolveWidgetTheme } = await import("../src/utils/widgetTheme.ts");
const { resolveSidebarTheme, sidebarThemeOptions } = await import("../src/utils/sidebarTheme.ts");
const { widgetCardStyle, resolveGlassCardBackground } = await import("../src/utils/glassCardBackground.ts");
const { widgetKeywordSurface } = await import("../src/utils/widgetOverlaySurface.ts");
const { copyFloatingTheme, floatingAppearanceMode, assignFloatingPreset } = await import("../src/utils/floatingAppearance.ts");

const glass: WidgetTheme = {
  id: "theme-quota-glass", name: "Quota Glass", is_default: true,
  bg_color: "#ffffff", bg_opacity: 0.05, material: "native-glass",
  text_colors: [{ name: "Main Text", value: "#ffffff" }, { name: "Sub Text", value: "#ffffff" }],
  primary_colors: [],
};

test("Windows native glass matches the thin Mac tint, bright text and dark cards", () => {
  const theme = resolveWidgetTheme({ themes: [glass], assignments: { "widget-quota-default": glass.id } }, "widget-quota-default", "quota")!;
  assert.equal(theme.bg_color, "#18181b");
  assert.equal(theme.bg_opacity, 0.02);
  assert.equal(theme.text_colors[0].value, "#ffffff");
  assert.equal(theme.text_colors[1].value, "#ffffff");
  assert.equal(theme.text_colors[1].opacity, 1);
  assert.equal(widgetCardStyle(theme), undefined);
  assert.deepEqual(resolveGlassCardBackground(theme), { color: "#000000", opacity: 0.12 });
  assert.equal(widgetKeywordSurface(theme, false).backgroundColor, "rgba(0, 0, 0, 0.12)");
});

test("Windows sidebar glass keeps white text without stacking dark module backgrounds", () => {
  const sidebar = resolveSidebarTheme({ active_theme_id: "glass" });
  assert.equal(sidebar.name, "Glass");
  assert.equal(sidebar.material, "native-glass");
  assert.equal(sidebarThemeOptions().filter(theme => theme.material === "native-liquid-glass").length, 0);
  assert.equal(resolveSidebarTheme({ active_theme_id: "liquid" }).material, "native-glass");
  assert.equal(sidebar.background, "#18181b");
  assert.equal(sidebar.background_opacity, 0.02);
  assert.equal(sidebar.card_opacity, 0);
  const theme = resolveWidgetTheme({ themes: [{ ...glass, id: "theme-quota-default" }], assignments: {} }, "sidebar", "quota", { sidebarLight: false, sidebarGlass: true })!;
  assert.equal(theme.text_colors[0].value, "#ffffff");
  assert.equal(theme.text_colors[1].value, "#ffffff");
});

test("every Windows glass widget gets opaque white text, including legacy black arXiv text", () => {
  for (const kind of ["quota", "gpu", "deadline", "arxiv"] as const) {
    const label = `widget-${kind === "deadline" ? "deadlines" : kind}-default`;
    const oldGlass = { ...glass, id: `theme-${kind}-glass`, text_colors: [
      { name: "Main Text", value: "#000000", opacity: 0.6 },
      { name: "Sub Text", value: "#64748b", opacity: 0.4 },
    ] };
    const config = { themes: [oldGlass], assignments: { [label]: oldGlass.id } };
    const theme = resolveWidgetTheme(config, label, kind)!;
    assert.deepEqual(theme.text_colors, [
      { name: "Main Text", value: "#ffffff", opacity: 1 },
      { name: "Sub Text", value: "#ffffff", opacity: 1 },
    ]);
    assert.equal(theme.bg_opacity, 0.02);
    assert.deepEqual(resolveGlassCardBackground(theme), { color: "#000000", opacity: 0.12 });
  }
});

test("custom glass themes keep their chosen colors and opacity", () => {
  const custom = { ...glass, id: "my-glass", is_default: false, bg_color: "#123456", bg_opacity: 0.42 };
  const theme = resolveWidgetTheme({ themes: [custom], assignments: { "widget-quota-default": custom.id } }, "widget-quota-default", "quota");
  assert.deepEqual(theme, custom);
  assert.deepEqual(widgetCardStyle({ ...custom, card_background: { color: "#123456", opacity: 0 } }), {
    backgroundColor: "rgba(18, 52, 86, 0)",
  });
});

test("Windows Glass keeps its existing preset ID and copy behavior", () => {
  const config = assignFloatingPreset({ themes: [glass], assignments: {} }, "widget-quota-default", "glass");
  assert.equal(config.assignments["widget-quota-default"], "theme-quota-glass");
  assert.equal(floatingAppearanceMode(config, "widget-quota-default"), "glass");
  const copy = copyFloatingTheme(config, "widget-quota-default", "light", glass.id)!;
  assert.equal(copy.theme.material, "native-glass");
  assert.equal(copy.theme.bg_color, glass.bg_color);
  assert.equal(copy.theme.bg_opacity, glass.bg_opacity);
  assert.deepEqual(copy.theme.text_colors, glass.text_colors);
});
