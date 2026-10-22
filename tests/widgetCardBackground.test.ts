import assert from "node:assert/strict";
import test from "node:test";
import { resolveWidgetCardBackground, widgetCardStyle } from "../src/utils/glassCardBackground.ts";
import { copyFloatingTheme } from "../src/utils/floatingAppearance.ts";
import { widgetKeywordSurface } from "../src/utils/widgetOverlaySurface.ts";
import type { WidgetTheme } from "../src/types/theme.ts";

const light: WidgetTheme = {
  id: "theme-quota-light", name: "Light", is_default: true,
  bg_color: "#ffffff", bg_opacity: 1, text_colors: [], primary_colors: [],
};

test("ordinary theme previews and controls match the existing light and dark card fills", () => {
  assert.deepEqual(resolveWidgetCardBackground(light), { color: "#0f172a", opacity: 0.035 });
  assert.deepEqual(resolveWidgetCardBackground({ ...light, bg_color: "#18181b" }), { color: "#ffffff", opacity: 0.05 });
  assert.deepEqual(resolveWidgetCardBackground({ ...light, bg_opacity: 0 }), { color: "#ffffff", opacity: 0.05 });
  assert.equal(widgetCardStyle(light), undefined);
});

test("ordinary custom card backgrounds survive copying and persistence, including zero opacity", () => {
  const custom = { ...light, id: "custom-light", is_default: false, card_background: { color: "#123456", opacity: 0 } };
  const copied = copyFloatingTheme({ themes: [custom], assignments: {} }, "widget-quota-default", "light", custom.id)!;
  const restored = JSON.parse(JSON.stringify(copied.theme)) as WidgetTheme;
  assert.deepEqual(resolveWidgetCardBackground(restored), custom.card_background);
  assert.deepEqual(widgetCardStyle(restored), { backgroundColor: "rgba(18, 52, 86, 0)" });
  copied.theme.card_background!.opacity = 0.8;
  assert.equal(custom.card_background.opacity, 0);
});

test("keyword dropdowns track card edits independently of window background", () => {
  const custom = { ...light, card_background: { color: "#123456", opacity: 0.37 } };
  for (const material of [undefined, "native-glass"] as const) {
    const theme = { ...custom, material };
    assert.equal(widgetKeywordSurface(theme, true).backgroundColor, widgetCardStyle(theme)?.backgroundColor);
    assert.equal(widgetKeywordSurface({ ...theme, bg_color: "#ffeeaa", bg_opacity: 0.9 }, true).backgroundColor,
      "rgba(18, 52, 86, 0.37)");
    assert.equal(widgetKeywordSurface({ ...theme, card_background: { color: "#abcdef", opacity: 0 } }, true).backgroundColor,
      "rgba(171, 205, 239, 0)");
  }
});

test("fully opaque keyword menus can omit the background blur", () => {
  const surface = widgetKeywordSurface({ ...light, card_background: { color: "#ffffff", opacity: 1 } }, true);
  assert.equal(surface.translucent, false);
  assert.equal(surface.backdropFilter, undefined);
});
