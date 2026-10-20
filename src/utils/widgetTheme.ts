import type { WidgetTheme, WidgetThemeConfig } from "../types/theme";
import type { DashboardTheme } from "../types/config";
import { isMacOS, isWindows } from "./platform";

export type WidgetThemeKind = "gpu" | "deadline" | "arxiv" | "quota";
export const FOLLOW_DASHBOARD_THEME_ID = "@follow-dashboard";

export const DEFAULT_THEME_IDS: Record<WidgetThemeKind, string> = {
  gpu: isMacOS ? "theme-gpu-light" : "theme-gpu-transparent",
  deadline: isMacOS ? "theme-deadline-light" : "theme-deadline-transparent",
  arxiv: isMacOS ? "theme-arxiv-light" : "theme-arxiv-transparent",
  quota: isMacOS ? "theme-quota-light" : "theme-quota-transparent",
};

const SIDEBAR_THEME_IDS: Record<WidgetThemeKind, string> = {
  gpu: "theme-gpu-default",
  deadline: "theme-deadline-default",
  arxiv: "theme-arxiv-default",
  quota: "theme-quota-default",
};

function lightGlassPrimaryColors(theme: WidgetTheme, kind: WidgetThemeKind) {
  const accents = { gpu: "#1d4ed8", deadline: "#6d28d9", arxiv: "#be185d", quota: "#0e7490" };
  const colors: Record<string, string> = {
    Accent: accents[kind], Highlight: "#92400e", Success: "#047857", Warning: "#92400e", Danger: "#b91c1c",
  };
  return theme.primary_colors.map(color => colors[color.name]
    ? { ...color, value: colors[color.name], opacity: 1 } : color);
}

function lightGlassTextColor(role: "Main Text" | "Sub Text", kind: WidgetThemeKind) {
  if (kind === "arxiv") return role === "Main Text" ? "#0f172a" : "#334155";
  return role === "Main Text" ? "#0b1220" : "#1e293b";
}

export const PRESET_THEME_IDS: Record<WidgetThemeKind, readonly string[]> = {
  gpu: ["theme-gpu-default", "theme-gpu-light", "theme-gpu-transparent", "theme-gpu-glass"],
  deadline: ["theme-deadline-default", "theme-deadline-light", "theme-deadline-transparent", "theme-deadline-glass"],
  arxiv: ["theme-arxiv-default", "theme-arxiv-light", "theme-arxiv-transparent", "theme-arxiv-glass"],
  quota: ["theme-quota-default", "theme-quota-light", "theme-quota-transparent", "theme-quota-glass"],
};

export function widgetThemeKindFromLabel(label: string): WidgetThemeKind {
  if (label.includes("gpu")) return "gpu";
  if (label.includes("deadlines")) return "deadline";
  if (label.includes("arxiv")) return "arxiv";
  return "quota";
}

export function defaultThemeIdForWidgetLabel(label: string): string {
  return DEFAULT_THEME_IDS[widgetThemeKindFromLabel(label)];
}

export function isPresetThemeForWidget(themeId: string, widgetId: string): boolean {
  const kind = widgetThemeKindFromLabel(widgetId);
  return PRESET_THEME_IDS[kind].includes(themeId);
}

export function resolveWidgetTheme(
  config: WidgetThemeConfig,
  windowLabel: string,
  kind?: WidgetThemeKind,
  options?: { sidebarLight?: boolean; sidebarGlass?: boolean; dashboardTheme?: DashboardTheme }
): WidgetTheme | null {
  if (windowLabel === "sidebar" && kind) {
    const base = config.themes.find((theme) => theme.id === SIDEBAR_THEME_IDS[kind]);
    if (!base) return null;
    if (!options?.sidebarLight && !options?.sidebarGlass) return base;
    const lightGlass = (isWindows || isMacOS) && options?.sidebarGlass && options.sidebarLight;
    const brightGlassText = options?.sidebarGlass && !lightGlass;
    return {
      ...base,
      primary_colors: lightGlass
        ? lightGlassPrimaryColors(base, kind) : base.primary_colors,
      text_colors: base.text_colors.map((color) =>
        color.name === "Main Text"
          ? { ...color, value: brightGlassText ? "#ffffff" : lightGlass ? lightGlassTextColor("Main Text", kind) : "#0f172a", opacity: 1 }
          : color.name === "Sub Text"
            ? { ...color, value: brightGlassText ? "#f1f5f9" : lightGlass ? lightGlassTextColor("Sub Text", kind) : "#475569", opacity: 1 }
            : color
      ),
    };
  }
  const defaultId =
    kind ? DEFAULT_THEME_IDS[kind] : defaultThemeIdForWidgetLabel(windowLabel);
  const themeId = config.assignments?.[windowLabel];
  const resolvedId = themeId === FOLLOW_DASHBOARD_THEME_ID
    ? `theme-${kind ?? widgetThemeKindFromLabel(windowLabel)}-${options?.dashboardTheme === "light" ? "light" : "default"}`
    : themeId;
  const theme =
    config.themes.find((t) => t.id === resolvedId) || config.themes.find((t) => t.id === defaultId);
  if (theme?.material === "native-glass" && theme.is_default) {
    const widgetKind = kind ?? widgetThemeKindFromLabel(windowLabel);
    return {
      ...theme,
      // Mac glass keeps the whole window nearly clear; bright foregrounds
      // and local content scrims provide contrast on light and dark wallpaper.
      // Custom themes retain their chosen palette.
      bg_color: isWindows ? "#f3f3f3" : isMacOS ? "#18181b" : "#0f172a",
      bg_opacity: isWindows ? 0.04 : isMacOS ? 0.02 : 0.10,
      primary_colors: isWindows ? lightGlassPrimaryColors(theme, widgetKind) : theme.primary_colors,
      text_colors: theme.text_colors.map(color => {
        // Secondary labels must stay opaque too: desktop colors already show
        // through the material, so fading the glyphs compounds the contrast loss.
        if (color.name === "Main Text") {
          return { ...color, value: isWindows ? lightGlassTextColor("Main Text", widgetKind) : "#ffffff", opacity: 1 };
        }
        if (color.name === "Sub Text") {
          return { ...color, value: isWindows ? lightGlassTextColor("Sub Text", widgetKind) : isMacOS ? "#f4f4f5" : "#f1f5f9", opacity: 1 };
        }
        return color;
      }),
    };
  }
  return theme || null;
}
