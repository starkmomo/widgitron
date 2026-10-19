import assert from "node:assert/strict";
import test from "node:test";
import type { WidgetTheme } from "../src/types/theme.ts";

Object.defineProperty(globalThis, "navigator", {
  value: { userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)" }, configurable: true,
});
const { resolveWidgetTheme } = await import("../src/utils/widgetTheme.ts");
const { resolveSidebarTheme } = await import("../src/utils/sidebarTheme.ts");

const glass: WidgetTheme = {
  id: "theme-quota-glass", name: "Quota Glass", is_default: true,
  bg_color: "#ffffff", bg_opacity: 0.05, material: "native-glass",
  text_colors: [{ name: "Main Text", value: "#000000" }, { name: "Sub Text", value: "#000000" }],
  primary_colors: [],
};

test("macOS built-in glass retains its original tint, opacity and text colors", () => {
  const theme = resolveWidgetTheme({ themes: [glass], assignments: { "widget-quota-default": glass.id } }, "widget-quota-default", "quota")!;
  assert.equal(theme.bg_color, "#0f172a");
  assert.equal(theme.bg_opacity, 0.10);
  assert.deepEqual(theme.text_colors, [
    { name: "Main Text", value: "#ffffff", opacity: 1 },
    { name: "Sub Text", value: "#f1f5f9", opacity: 1 },
  ]);
});

test("macOS sidebar glass retains all original material values", () => {
  const theme = resolveSidebarTheme({ active_theme_id: "glass" });
  assert.equal(theme.material, "native-glass");
  assert.equal(theme.background, "#0f172a");
  assert.equal(theme.header, "#0f172a");
  assert.equal(theme.background_opacity, 0.10);
  assert.equal(theme.header_opacity, 0.24);
  assert.equal(theme.card_opacity, 0.30);
  assert.equal(theme.blur, 0);
});

test("macOS keeps its original sidebar glass text even for light custom glass", () => {
  const theme = resolveWidgetTheme({ themes: [{ ...glass, id: "theme-quota-default" }], assignments: {} }, "sidebar", "quota", { sidebarGlass: true, sidebarLight: true })!;
  assert.equal(theme.text_colors[0].value, "#ffffff");
  assert.equal(theme.text_colors[1].value, "#f1f5f9");
});
