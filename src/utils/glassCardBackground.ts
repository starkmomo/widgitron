import { isGlassMaterial } from "./glassMaterial";
import type { CSSProperties } from "react";
import type { CardBackground, WidgetTheme } from "../types/theme";
import { hexToRgba, isLightColor } from "./color";
import { isMacOS, isWindows } from "./platform";

export function normalizeCardBackground(value: CardBackground | undefined): CardBackground | undefined {
  if (!value || !/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(value.color) || !Number.isFinite(value.opacity)) return undefined;
  return { color: value.color, opacity: Math.max(0, Math.min(1, value.opacity)) };
}

// Old themes keep their platform's existing card tint until explicitly edited.
export function resolveGlassCardBackground(theme: { card_background?: CardBackground; bg_color?: string; background?: string }): CardBackground {
  return normalizeCardBackground(theme.card_background) ?? ((isMacOS || isWindows) && !isLightColor(theme.bg_color ?? theme.background ?? "#18181b")
    ? { color: "#000000", opacity: isMacOS ? 0.08 : 0.12 }
    : { color: "#ffffff", opacity: isWindows ? 0.06 : isMacOS ? 0.04 : 0.05 });
}

export function resolveWidgetCardBackground(theme: Pick<WidgetTheme, "material" | "card_background" | "bg_color" | "bg_opacity">): CardBackground {
  if (isGlassMaterial(theme.material)) return resolveGlassCardBackground(theme);
  return normalizeCardBackground(theme.card_background) ?? (theme.bg_opacity >= 0.5 && isLightColor(theme.bg_color)
    ? { color: "#0f172a", opacity: 0.035 }
    : { color: "#ffffff", opacity: 0.05 });
}

// Inline color also overrides hover fills, so 0% stays clear on hover.
export function widgetCardStyle(theme: Pick<WidgetTheme, "card_background"> | null): CSSProperties | undefined {
  const background = normalizeCardBackground(theme?.card_background);
  return background
    ? { backgroundColor: hexToRgba(background.color, background.opacity) }
    : undefined;
}
