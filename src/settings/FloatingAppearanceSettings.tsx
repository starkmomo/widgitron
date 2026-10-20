import { useEffect, useRef, useState } from "react";
import { Bookmark, Check, ChevronDown, Copy, EyeOff, Plus, Palette, Trash2 } from "lucide-react";
import type { DashboardTheme } from "../types/config";
import type { WidgetTheme, WidgetThemeConfig } from "../types/theme";
import { MODULE_NAVIGATION } from "../utils/moduleNavigation";
import { serviceWidgetMeta } from "../utils/widgetLifecycle";
import { hexToRgba, isLightColor } from "../utils/color";
import { resolveWidgetTheme, type WidgetThemeKind } from "../utils/widgetTheme";
import { assignFloatingPreset, copyFloatingTheme, deleteFloatingTheme, editableFloatingTheme, floatingAppearanceMode, type FloatingPreset } from "../utils/floatingAppearance";
import { ConfirmDialog } from "../components/ConfirmDialog";
import type { UiLanguage } from "../utils/localization";
import { isMacOS, isWindows, supportsFloatingGlass } from "../utils/platform";
import { widgetCardStyle, resolveWidgetCardBackground } from "../utils/glassCardBackground";

const PRESETS: { mode: FloatingPreset; label: string }[] = [
  { mode: "follow", label: "Follow main" }, { mode: "light", label: "Light" },
  { mode: "dark", label: "Dark" }, { mode: "transparent", label: "Transparent" },
  { mode: "glass", label: "Glass" },
];
const WIDGET_LABELS: Record<string, string> = { quota: "Quota", gpu: "GPU", deadlines: "Conference", arxiv: "arXiv" };
const colorValue = (theme: WidgetTheme, role: string, fallback: string, primary = false) => {
  const color = (primary ? theme.primary_colors : theme.text_colors).find(item => item.name === role);
  return color ? hexToRgba(color.value, color.opacity ?? 1) : fallback;
};

// Approximate the native backdrop tint over the preview's reference scene.
// A CSS preview cannot sample the real desktop behind the application window.
const previewBackground = (theme: WidgetTheme) => hexToRgba(theme.bg_color,
  theme.material === "native-glass" && !isWindows
    ? 1 - (1 - theme.bg_opacity) * (isMacOS ? 0.88 : 0.78)
    : theme.bg_opacity);

function WidgetPreview({ theme, kind, label }: { theme: WidgetTheme; kind: WidgetThemeKind; label: string }) {
  const glass = theme.material === "native-glass";
  const main = colorValue(theme, "Main Text", "#fff");
  const sub = colorValue(theme, "Sub Text", "#94a3b8");
  const accent = colorValue(theme, "Accent", "#3b82f6", true);
  const highlight = colorValue(theme, "Highlight", accent, true);
  const success = colorValue(theme, "Success", accent, true);
  const cardBackground = resolveWidgetCardBackground(theme);
  const lightSurface = (theme.bg_opacity >= 0.5 || glass) && isLightColor(theme.bg_color);
  return <div data-widget-kind={kind} data-floating-surface={lightSurface ? "light" : undefined}
    className={`relative h-44 overflow-hidden rounded-xl border p-3 shadow-lg ${glass ? "glass-surface glass-preview border-transparent" : "border-slate-300/20"}`} style={{
    background: previewBackground(theme), color: main,
  }}>
    <div className="relative z-10 flex h-full min-h-0 flex-col">
    <div className="widget-header mb-2 flex shrink-0 items-center gap-2 text-xs font-bold"><span className="h-2 w-2 rounded-full" style={{ background: accent }} /><span>{label}</span></div>
    <div data-widget-surface="preview" style={{
      backgroundColor: hexToRgba(cardBackground.color, cardBackground.opacity),
      borderColor: lightSurface ? "rgba(100, 116, 139, 0.22)" : "rgba(255, 255, 255, 0.1)",
      ...widgetCardStyle(theme),
    }} className={`min-h-0 overflow-y-auto rounded-xl border p-2 ${kind === "arxiv" ? "arxiv-widget" : ""}`}>
    {kind === "quota" && <div className="space-y-2 text-[11px]">
      <div data-widget-text="title" className="font-semibold" data-no-localize>Codex</div>
      <div className="flex items-center justify-between"><span style={{ color: sub }}>7-day limit</span><span style={{ color: success }}>72%</span></div>
      <div className="h-1.5 rounded-full bg-slate-400/20"><div className="h-full w-[72%] rounded-full" style={{ background: success }} /></div>
    </div>}
    {kind === "gpu" && <div className="space-y-2 text-[11px]">
      <div data-widget-text="title" className="flex justify-between font-semibold"><span data-no-localize>localhost</span><span style={{ color: success }}>1 GPU</span></div>
      <div style={{ color: sub }} data-no-localize>CPU 24% · RAM 12 / 32 GB</div>
      <div className="flex items-center gap-3"><span style={{ color: sub }} data-no-localize>GPU 0</span><div className="h-1.5 flex-1 rounded-full bg-slate-400/20"><div className="h-full w-[46%] rounded-full" style={{ background: accent }} /></div><span style={{ color: accent }}>46%</span></div>
    </div>}
    {kind === "deadline" && <div className="space-y-2 text-[11px]">
      <div data-widget-text="title" className="flex items-center justify-between font-semibold"><span data-no-localize>CVPR 2027</span><span style={{ color: accent }}>AI</span></div>
      <div style={{ color: sub }} data-no-localize>Abstract submission</div>
      <div className="font-mono text-base font-bold" style={{ color: highlight }} data-no-localize>12d 08h 32m</div>
    </div>}
    {kind === "arxiv" && <div className="space-y-2 text-[11px]">
      <div className="arxiv-paper-title text-sm font-semibold leading-snug" data-no-localize>Learning to See, Hear and Reason</div>
      <div className="arxiv-abstract-preview leading-relaxed" style={{ color: sub }}>An example paper abstract for previewing text and accent colors.</div>
      <div aria-hidden="true" className="flex gap-2" style={{ color: sub }}>
        <span className="arxiv-reading-action inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5"><Bookmark size={12} /><span>Bookmark</span></span>
        <span className="arxiv-reading-action inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5"><EyeOff size={12} /><span>Ignore</span></span>
      </div>
    </div>}
    </div>
    </div>
  </div>;
}

export function ColorControl({ label, value, opacity, onColor, onOpacity }: {
  label: string; value: string; opacity: number; onColor: (value: string) => void; onOpacity: (value: number) => void;
}) {
  return <div role="group" aria-label={label} className="space-y-3 rounded-xl border border-[var(--dashboard-border)] p-3">
    <div className="flex items-center gap-2">
      <input type="color" value={value} onChange={event => onColor(event.target.value)} aria-label={label}
        className="h-6 w-6 shrink-0 cursor-pointer overflow-hidden rounded-md border border-slate-400/30 bg-transparent p-0 [&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:border-none" />
      <span className="min-w-0 flex-1 text-xs font-medium">{label}</span>
      <span className="text-[10px] tabular-nums text-slate-500">{Math.round(opacity * 100)}%</span>
    </div>
    <input type="range" min="0" max="100" step="1" value={Math.round(opacity * 100)}
      onChange={event => onOpacity(Number(event.target.value) / 100)} aria-label={`${label} opacity`}
      className="h-1.5 w-full cursor-pointer accent-blue-600" />
  </div>;
}

export function FloatingAppearanceSettings({ themeConfig, dashboardTheme, language, onSaveThemes }: {
  themeConfig: WidgetThemeConfig; dashboardTheme: DashboardTheme; language: UiLanguage; onSaveThemes: (config: WidgetThemeConfig) => Promise<void>;
}) {
  const [selected, setSelected] = useState("quota");
  const [customize, setCustomize] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const config = useRef(themeConfig);
  config.current = themeConfig;
  const mounted = useRef(false);
  const revision = useRef(0);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (saveState !== "saved") return;
    const timeout = window.setTimeout(() => setSaveState("idle"), 2500);
    return () => window.clearTimeout(timeout);
  }, [saveState]);
  const module = MODULE_NAVIGATION.find(item => item.section === selected) ?? MODULE_NAVIGATION[0];
  const widgetId = serviceWidgetMeta(module.field).id;
  const kind: WidgetThemeKind = selected === "deadlines" ? "deadline" : selected as WidgetThemeKind;
  const activeTheme = resolveWidgetTheme(themeConfig, widgetId, undefined, { dashboardTheme });
  const cardBackground = activeTheme ? resolveWidgetCardBackground(activeTheme) : { color: "#ffffff", opacity: 0.05 };
  const mode = floatingAppearanceMode(themeConfig, widgetId);
  const isLight = dashboardTheme === "light";
  const presets = PRESETS.filter(preset => preset.mode !== "glass" || supportsFloatingGlass);
  const customs = themeConfig.themes.filter(theme => !theme.is_default &&
    (!theme.widget_scope || theme.widget_scope === widgetId || theme.id === activeTheme?.id));

  const save = async (next: WidgetThemeConfig) => {
    const current = ++revision.current;
    config.current = next;
    setSaveState("saving");
    try {
      await onSaveThemes(next);
      if (mounted.current && current === revision.current) setSaveState("saved");
    } catch (error) {
      console.error("Could not save floating appearance", error);
      if (mounted.current && current === revision.current) setSaveState("error");
    }
  };
  const update = (patch: (theme: WidgetTheme) => WidgetTheme) => {
    const editable = editableFloatingTheme(config.current, widgetId, dashboardTheme);
    if (!editable) return;
    void save({ ...editable.config, themes: editable.config.themes.map(theme =>
      theme.id === editable.theme.id ? patch(editable.theme) : theme) });
  };
  const updateColor = (group: "text_colors" | "primary_colors", index: number, patch: { value?: string; opacity?: number }) =>
    update(theme => ({ ...theme, [group]: theme[group].map((color, position) => position === index ? { ...color, ...patch } : color) }));
  const createTheme = (source?: WidgetTheme) => {
    const name = source ? `${source.name} (${language === "zh-CN" ? "副本" : "Copy"})`
      : language === "zh-CN" ? "自定义主题" : "Custom theme";
    const copied = copyFloatingTheme(config.current, widgetId, dashboardTheme, source?.id, name);
    if (copied) { void save(copied.config); setCustomize(true); }
  };

  return <section className="space-y-6">
    <div className="space-y-1.5">
      <h2 className={`text-xs font-black tracking-wider ${isLight ? "text-slate-500" : "text-slate-400"}`}>Floating appearance</h2>
      <p className="text-xs text-slate-500">Customize the four independent floating windows.</p>
    </div>
    <div className={`space-y-6 rounded-2xl border border-[var(--dashboard-border)] p-5 ${isLight ? "bg-white" : "bg-white/5"}`}>
      <div role="group" aria-label="Choose floating window" className="grid grid-cols-4 gap-1 rounded-xl bg-slate-400/10 p-1">
        {MODULE_NAVIGATION.map(item => <button key={item.section} type="button" aria-pressed={selected === item.section}
          onClick={() => { setSelected(item.section); setCustomize(false); setDeleteId(null); }}
          className={`flex min-w-0 items-center justify-center gap-1.5 rounded-lg px-2 py-2.5 text-[11px] font-semibold transition-colors ${
            selected === item.section ? isLight ? "bg-white text-blue-600 shadow-sm" : "bg-slate-700 text-blue-300" : "text-slate-500 hover:text-blue-500"
          }`}><item.Icon size={14} className="shrink-0" /><span className="truncate">{WIDGET_LABELS[item.section]}</span></button>)}
      </div>
      <div role="radiogroup" aria-label="Floating appearance presets" className={`grid gap-2 ${supportsFloatingGlass ? "grid-cols-5" : "grid-cols-4"}`}>
        {presets.map((preset, index) => {
          const preview = resolveWidgetTheme(assignFloatingPreset(themeConfig, widgetId, preset.mode), widgetId, undefined, { dashboardTheme });
          return <button key={preset.mode} type="button" role="radio" aria-checked={mode === preset.mode}
            tabIndex={mode === preset.mode || mode === "custom" && index === 0 ? 0 : -1}
            onKeyDown={event => {
              const offset = ["ArrowRight", "ArrowDown"].includes(event.key) ? 1
                : ["ArrowLeft", "ArrowUp"].includes(event.key) ? -1 : 0;
              if (!offset) return;
              event.preventDefault();
              const next = (index + offset + presets.length) % presets.length;
              (event.currentTarget.parentElement?.children[next] as HTMLButtonElement | undefined)?.focus();
              void save(assignFloatingPreset(config.current, widgetId, presets[next].mode));
            }}
            onClick={() => { setDeleteId(null); void save(assignFloatingPreset(config.current, widgetId, preset.mode)); }}
            className={`min-w-0 space-y-2 rounded-xl border p-2.5 text-left text-[11px] font-semibold transition-colors ${
              mode === preset.mode ? "border-blue-500 bg-blue-500/5 ring-1 ring-blue-500" : "border-[var(--dashboard-border)] hover:border-blue-400"
            }`}>
            <div aria-hidden="true" className="floating-preview-scene h-9 rounded-md border border-slate-400/20 p-1.5">
              {preview && <div className={`relative h-full overflow-hidden rounded-sm px-1.5 py-1 ${preview.material === "native-glass" ? "glass-surface glass-preview [--glass-radius:4px]" : ""}`} style={{ background: previewBackground(preview) }}>
                <div className="h-1 w-2/3 rounded-full" style={{ background: colorValue(preview, "Main Text", "#fff") }} />
                <div className="mt-1 h-1 w-1/3 rounded-full" style={{ background: colorValue(preview, "Accent", "#3b82f6", true) }} />
              </div>}
            </div>
            <div className="flex items-center justify-between gap-1"><span>{preset.label}</span>{mode === preset.mode && <Check size={12} className="shrink-0 text-blue-500" />}</div>
          </button>;
        })}
      </div>
      {activeTheme && <div className="space-y-2">
        <div className="flex justify-between text-[10px] font-medium text-slate-500"><span>Preview</span><span>Example data</span></div>
        <div className="floating-preview-scene relative isolate overflow-hidden rounded-2xl border border-slate-400/20 p-3">
          <div className="mx-auto w-full max-w-sm"><WidgetPreview theme={activeTheme} kind={kind} label={module.label} /></div>
        </div>
      </div>}
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3"><div className="text-[10px] font-semibold text-slate-500">Custom themes</div>
          <button type="button" onClick={() => createTheme()} className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-semibold text-blue-500 hover:bg-blue-500/10"><Plus size={13} /><span>New theme</span></button></div>
        <div className="flex flex-wrap gap-2">{customs.map(theme => <div key={theme.id} className={`inline-flex max-w-full items-center rounded-lg border ${
          activeTheme?.id === theme.id ? "border-blue-500 bg-blue-500/10" : "border-[var(--dashboard-border)]"
        }`}>
          <button type="button" onClick={() => void save({ ...config.current, assignments: { ...config.current.assignments, [widgetId]: theme.id } })}
            aria-pressed={activeTheme?.id === theme.id} className="min-w-0 px-3 py-2 text-xs"><span className="block max-w-52 truncate" data-no-localize>{theme.name}</span></button>
          <button type="button" aria-label="Duplicate theme" title="Duplicate theme" onClick={() => createTheme(theme)} className="p-1.5 text-slate-400 hover:text-blue-500"><Copy size={12} /></button>
          <button type="button" aria-label="Delete custom theme" onClick={() => setDeleteId(deleteId === theme.id ? null : theme.id)} className="mr-1 p-1.5 text-slate-400 hover:text-red-500"><Trash2 size={12} /></button>
        </div>)}</div>
        {deleteId && <ConfirmDialog title="Delete this custom theme?" isLight={isLight} onCancel={() => setDeleteId(null)}
          onConfirm={() => { void save(deleteFloatingTheme(config.current, deleteId)); setDeleteId(null); }}>
          <span className="font-semibold" data-no-localize>{themeConfig.themes.find(theme => theme.id === deleteId)?.name}</span>
          <p className="mt-2">Floating windows using this theme will follow the main interface.</p>
        </ConfirmDialog>}
      </div>
      <div className="border-t border-[var(--dashboard-border)] pt-4">
        <button type="button" aria-expanded={customize} aria-controls="floating-custom-colors" onClick={() => setCustomize(!customize)}
          className="flex items-center gap-2 text-xs font-semibold text-blue-500"><Palette size={15} /><span>Customize</span><ChevronDown size={14} className={customize ? "rotate-180" : ""} /></button>
        {customize && activeTheme && <div id="floating-custom-colors" className="mt-4 space-y-4">
          <label className="block space-y-2 text-xs font-medium"><span>Theme Name</span>
            <input value={activeTheme.is_default ? "" : activeTheme.name} placeholder="Custom theme"
              onChange={event => update(theme => ({ ...theme, name: event.target.value }))}
              className={`w-full rounded-xl border border-[var(--dashboard-border)] px-3 py-2.5 text-xs ${isLight ? "bg-slate-50" : "bg-black/20"}`} />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <ColorControl label="Background" value={activeTheme.bg_color} opacity={activeTheme.bg_opacity}
              onColor={value => update(theme => ({ ...theme, bg_color: value }))} onOpacity={value => update(theme => ({ ...theme, bg_opacity: value }))} />
            <ColorControl label="Card background" value={cardBackground.color} opacity={cardBackground.opacity}
              onColor={color => update(theme => ({ ...theme, card_background: { ...resolveWidgetCardBackground(theme), color } }))}
              onOpacity={opacity => update(theme => ({ ...theme, card_background: { ...resolveWidgetCardBackground(theme), opacity } }))} />
            {activeTheme.text_colors.map((color, index) => <ColorControl key={color.name} label={color.name} value={color.value} opacity={color.opacity ?? 1}
              onColor={value => updateColor("text_colors", index, { value })} onOpacity={opacity => updateColor("text_colors", index, { opacity })} />)}
            {activeTheme.primary_colors.map((color, index) => <ColorControl key={color.name} label={color.name} value={color.value} opacity={color.opacity ?? 1}
              onColor={value => updateColor("primary_colors", index, { value })} onOpacity={opacity => updateColor("primary_colors", index, { opacity })} />)}
          </div>
        </div>}
      </div>
    </div>
    {saveState !== "idle" && <p role="status" className={`text-xs ${saveState === "error" ? "text-red-500" : "text-slate-500"}`}>
      {saveState === "saving" ? "Saving…" : saveState === "error" ? "Could not save floating appearance. Please try again." : "Appearance saved."}
    </p>}
  </section>;
}
