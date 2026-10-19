import type { WidgetTheme, WidgetThemeConfig } from "../types/theme";
import type { DashboardTheme } from "../types/config";
import { isMacOS } from "./platform";

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
    return {
      ...base,
      text_colors: base.text_colors.map((color) =>
        color.name === "Main Text"
          ? { ...color, value: options?.sidebarGlass ? "#ffffff" : "#0f172a", opacity: 1 }
          : color.name === "Sub Text"
            ? { ...color, value: options?.sidebarGlass ? "#f1f5f9" : "#475569", opacity: 1 }
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
    return {
      ...theme,
      // Glass sits over the desktop, whose brightness is unrelated to the
      // dashboard theme. Use a dark scrim and bright text in either app theme.
      bg_color: "#0f172a",
      bg_opacity: 0.10,
      text_colors: theme.text_colors.map(color => {
        // Secondary labels must stay opaque too: desktop colors already show
        // through the material, so fading the glyphs compounds the contrast loss.
        if (color.name === "Main Text") {
          return { ...color, value: "#ffffff", opacity: 1 };
        }
        if (color.name === "Sub Text") {
          return { ...color, value: "#f1f5f9", opacity: 1 };
        }
        return color;
      }),
    };
  }
  return theme || null;
}
