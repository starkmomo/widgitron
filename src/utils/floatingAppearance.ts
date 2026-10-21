import type { DashboardTheme } from "../types/config";
import type { WidgetTheme, WidgetThemeConfig } from "../types/theme";
import { defaultThemeIdForWidgetLabel, FOLLOW_DASHBOARD_THEME_ID, resolveWidgetTheme, widgetThemeKindFromLabel } from "./widgetTheme";
import { canonicalGlassPresetId } from "./glassMaterial";
import { isMacOS } from "./platform";

export type FloatingAppearanceMode = "follow" | "light" | "dark" | "transparent" | "glass" | "custom";
export type FloatingPreset = Exclude<FloatingAppearanceMode, "custom">;

export function floatingPresetId(widgetId: string, mode: FloatingPreset): string {
  if (mode === "follow") return FOLLOW_DASHBOARD_THEME_ID;
  return `theme-${widgetThemeKindFromLabel(widgetId)}-${mode === "dark" ? "default" : mode}`;
}

export function floatingAppearanceMode(config: WidgetThemeConfig, widgetId: string): FloatingAppearanceMode {
  const id = canonicalGlassPresetId(config.assignments[widgetId] || defaultThemeIdForWidgetLabel(widgetId));
  for (const mode of ["follow", "light", "dark", "transparent", "glass"] as const) {
    if (id === floatingPresetId(widgetId, mode)) return mode;
  }
  return config.themes.some(theme => theme.id === id && !theme.is_default) ? "custom"
    : defaultThemeIdForWidgetLabel(widgetId).endsWith("-light") ? "light" : "transparent";
}

export function assignFloatingPreset(config: WidgetThemeConfig, widgetId: string, mode: FloatingPreset): WidgetThemeConfig {
  return { ...config, assignments: { ...config.assignments, [widgetId]: floatingPresetId(widgetId, mode) } };
}

// Editing a preset or a theme shared with another window creates a private
// version for this window. Existing custom themes and other assignments survive.
export function editableFloatingTheme(config: WidgetThemeConfig, widgetId: string, dashboardTheme: DashboardTheme): {
  config: WidgetThemeConfig; theme: WidgetTheme;
} | null {
  const active = resolveWidgetTheme(config, widgetId, undefined, { dashboardTheme });
  if (!active) return null;
  const shared = Object.entries(config.assignments).some(([other, id]) => other !== widgetId && id === active.id);
  if (!active.is_default && active.widget_scope === widgetId && !shared) return { config, theme: active };
  return copyFloatingTheme(config, widgetId, dashboardTheme);
}

export function copyFloatingTheme(config: WidgetThemeConfig, widgetId: string, dashboardTheme: DashboardTheme,
  sourceId?: string, baseName?: string): { config: WidgetThemeConfig; theme: WidgetTheme } | null {
  const source = sourceId ? config.themes.find(theme => theme.id === sourceId) : undefined;
  const active = sourceId
    ? source && isMacOS
      ? resolveWidgetTheme({ ...config, assignments: { ...config.assignments, [widgetId]: sourceId } }, widgetId, undefined, { dashboardTheme }) : source
    : resolveWidgetTheme(config, widgetId, undefined, { dashboardTheme });
  if (!active) return null;
  const base = baseName ?? `${widgetThemeKindFromLabel(widgetId)} custom`;
  const names = new Set(config.themes.map(theme => theme.name.trim().toLocaleLowerCase()));
  let name = base;
  for (let index = 2; names.has(name.toLocaleLowerCase()); index++) name = `${base} ${index}`;
  const suffix = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const theme: WidgetTheme = {
    ...active, id: `theme-${suffix}`, name,
    is_default: false, widget_scope: widgetId,
    text_colors: active.text_colors.map(color => ({ ...color })),
    primary_colors: active.primary_colors.map(color => ({ ...color })),
    card_background: active.card_background ? { ...active.card_background } : undefined,
  };
  return { theme, config: { ...config, themes: [...config.themes, theme],
    assignments: { ...config.assignments, [widgetId]: theme.id } } };
}

export function deleteFloatingTheme(config: WidgetThemeConfig, themeId: string): WidgetThemeConfig {
  if (!config.themes.some(theme => theme.id === themeId && !theme.is_default)) return config;
  return { ...config, themes: config.themes.filter(theme => theme.id !== themeId),
    assignments: Object.fromEntries(Object.entries(config.assignments).map(([widget, id]) =>
      [widget, id === themeId ? FOLLOW_DASHBOARD_THEME_ID : id])) };
}
