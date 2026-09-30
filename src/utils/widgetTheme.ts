import { WidgetTheme, WidgetThemeConfig } from "../types/theme";
import { isMacOS } from "./platform";

export type WidgetThemeKind = "gpu" | "deadline" | "arxiv" | "quota";

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
  gpu: ["theme-gpu-default", "theme-gpu-light", "theme-gpu-transparent"],
  deadline: ["theme-deadline-default", "theme-deadline-light", "theme-deadline-transparent"],
  arxiv: ["theme-arxiv-default", "theme-arxiv-light", "theme-arxiv-transparent"],
  quota: ["theme-quota-default", "theme-quota-light", "theme-quota-transparent"],
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
  options?: { sidebarLight?: boolean }
): WidgetTheme | null {
  if (windowLabel === "sidebar" && kind) {
    const base = config.themes.find((theme) => theme.id === SIDEBAR_THEME_IDS[kind]);
    if (!base) return null;
    if (!options?.sidebarLight) return base;
    return {
      ...base,
      text_colors: base.text_colors.map((color) =>
        color.name === "Main Text"
          ? { ...color, value: "#0f172a", opacity: 1 }
          : color.name === "Sub Text"
            ? { ...color, value: "#475569", opacity: 1 }
            : color
      ),
    };
  }
  const defaultId =
    kind ? DEFAULT_THEME_IDS[kind] : defaultThemeIdForWidgetLabel(windowLabel);
  const themeId = config.assignments?.[windowLabel];
  const theme =
    config.themes.find((t) => t.id === themeId) || config.themes.find((t) => t.id === defaultId);
  return theme || null;
}
