import assert from "node:assert/strict";
import test from "node:test";
import type { WidgetTheme } from "../src/types/theme.ts";

// These tests run in their own Node worker, emulating WebView2's platform.
Object.defineProperty(globalThis, "navigator", {
  value: { userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" }, configurable: true,
});
const { resolveWidgetTheme } = await import("../src/utils/widgetTheme.ts");
const { resolveSidebarTheme } = await import("../src/utils/sidebarTheme.ts");
const { widgetCardStyle, resolveGlassCardBackground } = await import("../src/utils/glassCardBackground.ts");
const { widgetKeywordSurface } = await import("../src/utils/widgetOverlaySurface.ts");

const glass: WidgetTheme = {
  id: "theme-quota-glass", name: "Quota Glass", is_default: true,
  bg_color: "#ffffff", bg_opacity: 0.05, material: "native-glass",
  text_colors: [{ name: "Main Text", value: "#ffffff" }, { name: "Sub Text", value: "#ffffff" }],
  primary_colors: [],
};

test("Windows clear glass keeps a light tint and readable dark labels", () => {
  const theme = resolveWidgetTheme({ themes: [glass], assignments: { "widget-quota-default": glass.id } }, "widget-quota-default", "quota")!;
  assert.equal(theme.bg_color, "#f3f3f3");
  assert.equal(theme.bg_opacity, 0.04);
  assert.equal(theme.text_colors[0].value, "#0b1220");
  assert.equal(theme.text_colors[1].opacity, 1);
  assert.equal(widgetCardStyle(theme), undefined);
  assert.deepEqual(resolveGlassCardBackground(theme), { color: "#ffffff", opacity: 0.06 });
  assert.equal(widgetKeywordSurface(theme, true).backgroundColor, "rgba(255, 255, 255, 0.06)");
});

test("Windows sidebar clear glass uses the same transparent palette", () => {
  const sidebar = resolveSidebarTheme({ active_theme_id: "glass" });
  assert.equal(sidebar.background, "#f3f3f3");
  assert.equal(sidebar.background_opacity, 0.04);
  const theme = resolveWidgetTheme({ themes: [{ ...glass, id: "theme-quota-default" }], assignments: {} }, "sidebar", "quota", { sidebarLight: true, sidebarGlass: true })!;
  assert.equal(theme.text_colors[0].value, "#0b1220");
});

test("custom glass themes keep their chosen colors and opacity", () => {
  const custom = { ...glass, id: "my-glass", is_default: false, bg_color: "#123456", bg_opacity: 0.42 };
  const theme = resolveWidgetTheme({ themes: [custom], assignments: { "widget-quota-default": custom.id } }, "widget-quota-default", "quota");
  assert.deepEqual(theme, custom);
  assert.deepEqual(widgetCardStyle({ ...custom, card_background: { color: "#123456", opacity: 0 } }), {
    backgroundColor: "rgba(18, 52, 86, 0)",
  });
});
