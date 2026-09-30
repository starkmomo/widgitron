import type {
  SidebarThemeConfig,
  SidebarThemeDefinition,
  SidebarThemeKind,
  SidebarThemePresetId as ConfigSidebarThemePresetId,
} from "../types/config";
import { isMacOS } from "./platform";

export type SidebarThemePresetId = ConfigSidebarThemePresetId;

type SidebarThemeAppearance = Required<
  Pick<
    SidebarThemeDefinition,
    | "background"
    | "header"
    | "quota"
    | "gpu"
    | "deadlines"
    | "arxiv"
    | "background_opacity"
    | "header_opacity"
    | "card_opacity"
    | "blur"
  >
>;

export type ResolvedSidebarTheme = SidebarThemeAppearance & {
  id: string;
  name: string;
  preset: SidebarThemeKind;
};

type SidebarThemePreset = {
  id: SidebarThemePresetId;
  label: string;
  description: string;
  theme: ResolvedSidebarTheme;
};

const MIDNIGHT_THEME: ResolvedSidebarTheme = {
  id: "midnight",
  name: "Night",
  preset: "midnight",
  background: "#050814",
  header: "#080d1d",
  quota: "#06b6d4",
  gpu: "#3b82f6",
  deadlines: "#f59e0b",
  arxiv: "#ec4899",
  background_opacity: isMacOS ? 0.9 : 0.98,
  header_opacity: isMacOS ? 0.94 : 0.98,
  card_opacity: isMacOS ? 0.9 : 0.96,
  blur: isMacOS ? 14 : 0,
};

const LIGHT_THEME: ResolvedSidebarTheme = {
  // A lightly translucent white surface with enough blur to read cleanly over
  // wallpaper, while still remaining visibly different from desktop widgets.
  id: "light",
  name: "Light",
  preset: "light",
  background: "#ffffff",
  header: "#ffffff",
  quota: "#0891b2",
  gpu: "#2563eb",
  deadlines: "#7c3aed",
  arxiv: "#db2777",
  background_opacity: isMacOS ? 0.88 : 0.84,
  header_opacity: isMacOS ? 0.92 : 0.9,
  card_opacity: isMacOS ? 0.88 : 0.76,
  blur: 18,
};

export const SIDEBAR_THEME_PRESETS: SidebarThemePreset[] = [
  {
    id: "midnight",
    label: "Night",
    description: "The focused dark sidebar look.",
    theme: MIDNIGHT_THEME,
  },
  {
    id: "light",
    label: "Light",
    description: "A softly translucent white frosted-glass surface.",
    theme: LIGHT_THEME,
  },
];

export const DEFAULT_SIDEBAR_THEME = MIDNIGHT_THEME;

const builtInThemeIds = new Set<SidebarThemePresetId>(["midnight", "light"]);

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function readColor(value: unknown, fallback: string) {
  return isNonEmptyString(value) ? value.trim() : fallback;
}

function readOpacity(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(1, Math.max(0, value))
    : fallback;
}

function readBlur(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(48, Math.max(0, value))
    : fallback;
}

function cloneTheme(theme: ResolvedSidebarTheme): ResolvedSidebarTheme {
  return { ...theme };
}

function normalizeCustomTheme(theme: SidebarThemeDefinition): ResolvedSidebarTheme {
  const id = theme.id.trim();
  return {
    id,
    name: isNonEmptyString(theme.name) ? theme.name.trim() : "Custom sidebar theme",
    preset: "custom",
    background: readColor(theme.background, MIDNIGHT_THEME.background),
    header: readColor(theme.header, MIDNIGHT_THEME.header),
    quota: readColor(theme.quota, MIDNIGHT_THEME.quota),
    gpu: readColor(theme.gpu, MIDNIGHT_THEME.gpu),
    deadlines: readColor(theme.deadlines, MIDNIGHT_THEME.deadlines),
    arxiv: readColor(theme.arxiv, MIDNIGHT_THEME.arxiv),
    background_opacity: readOpacity(theme.background_opacity, MIDNIGHT_THEME.background_opacity),
    header_opacity: readOpacity(theme.header_opacity, MIDNIGHT_THEME.header_opacity),
    card_opacity: readOpacity(theme.card_opacity, MIDNIGHT_THEME.card_opacity),
    blur: readBlur(theme.blur, MIDNIGHT_THEME.blur),
  };
}

function customThemes(theme?: SidebarThemeConfig): ResolvedSidebarTheme[] {
  const seen = new Set<string>();
  return (theme?.themes || [])
    .filter((candidate) => isNonEmptyString(candidate?.id))
    .filter((candidate) => candidate.id !== "transparent")
    .filter((candidate) => !builtInThemeIds.has(candidate.id as SidebarThemePresetId))
    .filter((candidate) => {
      const id = candidate.id.trim();
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    })
    .map(normalizeCustomTheme);
}

export function sidebarThemePreset(id: SidebarThemePresetId): ResolvedSidebarTheme {
  const theme =
    SIDEBAR_THEME_PRESETS.find((preset) => preset.id === id)?.theme ?? DEFAULT_SIDEBAR_THEME;
  return cloneTheme(theme);
}

export function sidebarThemeOptions(theme?: SidebarThemeConfig): ResolvedSidebarTheme[] {
  return [
    ...SIDEBAR_THEME_PRESETS.map((preset) => cloneTheme(preset.theme)),
    ...customThemes(theme),
  ];
}

export function isBuiltInSidebarTheme(id: string) {
  return builtInThemeIds.has(id as SidebarThemePresetId);
}

export function resolveSidebarTheme(theme?: SidebarThemeConfig): ResolvedSidebarTheme {
  const options = sidebarThemeOptions(theme);
  const activeId = theme?.active_theme_id?.trim();
  if (activeId) {
    const active = options.find((candidate) => candidate.id === activeId);
    if (active) return active;
  }

  // The retired transparent preset is intentionally migrated to Light.
  if (activeId === "transparent" || theme?.preset === "transparent") {
    return sidebarThemePreset("light");
  }
  if (theme?.preset === "custom") {
    return normalizeCustomTheme({
      id: "legacy-sidebar-custom",
      name: "Custom sidebar theme",
      preset: "custom",
      background: theme.background,
      header: theme.header,
      quota: theme.quota,
      gpu: theme.gpu,
      deadlines: theme.deadlines,
      arxiv: theme.arxiv,
      background_opacity: theme.background_opacity,
      header_opacity: theme.header_opacity,
      card_opacity: theme.card_opacity,
      blur: theme.blur,
    });
  }
  return sidebarThemePreset("light");
}

export function selectSidebarTheme(
  theme: SidebarThemeConfig | undefined,
  id: string
): SidebarThemeConfig {
  const selected = sidebarThemeOptions(theme).find((candidate) => candidate.id === id);
  if (!selected) return { ...(theme || {}) };
  return {
    ...(theme || {}),
    active_theme_id: selected.id,
    preset: isBuiltInSidebarTheme(selected.id)
      ? (selected.id as SidebarThemePresetId)
      : "custom",
  };
}

function makeSidebarThemeId() {
  const suffix =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return `sidebar-custom-${suffix}`;
}

function uniqueThemeName(baseName: string, themes: SidebarThemeDefinition[]) {
  const existing = new Set(themes.map((theme) => theme.name.trim().toLocaleLowerCase()));
  const base = `Copy of ${baseName}`;
  if (!existing.has(base.toLocaleLowerCase())) return base;
  let index = 2;
  while (existing.has(`${base} ${index}`.toLocaleLowerCase())) index += 1;
  return `${base} ${index}`;
}

function asCustomTheme(theme: ResolvedSidebarTheme, name: string): SidebarThemeDefinition {
  return {
    id: makeSidebarThemeId(),
    name,
    preset: "custom",
    background: theme.background,
    header: theme.header,
    quota: theme.quota,
    gpu: theme.gpu,
    deadlines: theme.deadlines,
    arxiv: theme.arxiv,
    background_opacity: theme.background_opacity,
    header_opacity: theme.header_opacity,
    card_opacity: theme.card_opacity,
    blur: theme.blur,
  };
}

export function duplicateSidebarTheme(
  theme: SidebarThemeConfig | undefined,
  sourceId?: string
): { config: SidebarThemeConfig; theme: ResolvedSidebarTheme } {
  const source =
    sidebarThemeOptions(theme).find((candidate) => candidate.id === sourceId) ??
    resolveSidebarTheme(theme);
  const existing = [...(theme?.themes || [])];
  const duplicate = asCustomTheme(source, uniqueThemeName(source.name, existing));
  const config: SidebarThemeConfig = {
    ...(theme || {}),
    preset: "custom",
    active_theme_id: duplicate.id,
    themes: [...existing, duplicate],
  };
  return { config, theme: normalizeCustomTheme(duplicate) };
}

export function updateSidebarTheme(
  theme: SidebarThemeConfig | undefined,
  id: string,
  patch: Partial<Omit<SidebarThemeDefinition, "id">>
): SidebarThemeConfig {
  if (isBuiltInSidebarTheme(id)) return { ...(theme || {}) };
  const themes = (theme?.themes || []).map((candidate) =>
    candidate.id === id
      ? {
          ...candidate,
          ...patch,
          id,
          preset: "custom" as const,
        }
      : candidate
  );
  return { ...(theme || {}), preset: "custom", active_theme_id: id, themes };
}

export function removeSidebarTheme(
  theme: SidebarThemeConfig | undefined,
  id: string
): SidebarThemeConfig {
  if (isBuiltInSidebarTheme(id)) return { ...(theme || {}) };
  const themes = (theme?.themes || []).filter((candidate) => candidate.id !== id);
  const activeId =
    theme?.active_theme_id === id
      ? "light"
      : theme?.active_theme_id === "transparent"
        ? "light"
        : theme?.active_theme_id;
  return {
    ...(theme || {}),
    preset: activeId === "light" ? "light" : activeId === "midnight" ? "midnight" : "custom",
    active_theme_id: activeId,
    themes,
  };
}
