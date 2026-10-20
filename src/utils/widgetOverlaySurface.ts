import type { WidgetTheme } from "../types/theme";
import { hexToRgba } from "./color";
import { resolveWidgetCardBackground } from "./glassCardBackground";

/** Shared popup material for keyword menus and full-abstract dialogs. */
export function widgetOverlaySurface(theme: WidgetTheme, light: boolean) {
  const glass = theme.material === "native-glass";
  const translucent = glass || theme.bg_opacity < 0.5;
  return {
    glass, translucent,
    backgroundColor: glass
      ? hexToRgba(theme.bg_color, Math.min(1, Math.max(0.30, theme.bg_opacity + 0.12)))
      : hexToRgba(light ? "#ffffff" : theme.bg_color,
        translucent ? Math.min(1, Math.max(0.65, theme.bg_opacity + 0.12)) : 1),
    backdropFilter: translucent ? "blur(24px) saturate(125%)" : undefined,
    color: light ? "#334155" : "#f1f5f9",
    borderColor: light ? "rgba(100, 116, 139, 0.28)" : "rgba(148, 163, 184, 0.24)",
  };
}

/** Keyword controls share the content card's configurable tint. */
export function widgetKeywordSurface(theme: WidgetTheme, light: boolean) {
  const surface = widgetOverlaySurface(theme, light);
  const card = resolveWidgetCardBackground(theme);
  const translucent = surface.glass || card.opacity < 1;
  return {
    ...surface,
    translucent,
    backgroundColor: hexToRgba(card.color, card.opacity),
    backdropFilter: translucent ? "blur(24px) saturate(125%)" : undefined,
  };
}
