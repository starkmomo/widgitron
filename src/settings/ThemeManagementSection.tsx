import { useState, useEffect } from "react";
import { Copy, Plus, X, Settings } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { WidgetTheme, WidgetThemeConfig } from "../types/theme";
import { hexToRgba } from "../utils/color";

interface ThemeManagementSectionProps {
  themeConfig: WidgetThemeConfig;
  onSaveThemes: (config: WidgetThemeConfig) => void;
  dashboardTheme: string;
  activeWidgets: string[];
  widgetId?: string;
}

export function ThemeManagementSection({
  themeConfig,
  onSaveThemes,
  dashboardTheme,
  activeWidgets,
  widgetId
}: ThemeManagementSectionProps) {
  const [editingThemeId, setEditingThemeId] = useState<string | null>(null);
  const [localThemes, setLocalThemes] = useState<WidgetThemeConfig>(themeConfig);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  useEffect(() => {
    setLocalThemes(themeConfig);
  }, [themeConfig]);

  const themes = localThemes.themes || [];
  const editingTheme = themes.find((t) => t.id === editingThemeId);

  const save = (next: WidgetThemeConfig) => {
    setLocalThemes(next);
    onSaveThemes(next);
  };

  const addTheme = () => {
    const id = `theme-${Date.now()}`;
    const next = {
      ...localThemes,
      themes: [
        ...themes,
        {
          id,
          name: "New Theme",
          is_default: false,
          bg_color: "#0f172a",
          bg_opacity: 0.95,
          text_colors: [
            { name: "Main Text", value: "#ffffff", opacity: 1.0 },
            { name: "Sub Text", value: "#94a3b8", opacity: 0.6 }
          ],
          primary_colors: [{ name: "Accent", value: "#3b82f6", opacity: 1.0 }]
        }
      ]
    };
    save(next);
    setEditingThemeId(id);
  };

  const copyTheme = (theme: WidgetTheme, autoAssignWidgetId?: string) => {
    const id = `theme-copy-${Date.now()}`;
    const newTheme = JSON.parse(JSON.stringify(theme));
    newTheme.id = id;
    newTheme.name = `${theme.name} (Copy)`;
    newTheme.is_default = false;
    // Scope the new theme to the widget it was duplicated from
    if (autoAssignWidgetId) {
      newTheme.widget_scope = autoAssignWidgetId;
    }
    const assignments = autoAssignWidgetId
      ? { ...(localThemes.assignments || {}), [autoAssignWidgetId]: id }
      : localThemes.assignments;
    const next = {
      ...localThemes,
      themes: [...themes, newTheme],
      assignments
    };
    save(next);
    setEditingThemeId(id);
  };

  const deleteTheme = (id: string) => {
    const next = {
      ...localThemes,
      themes: themes.filter((t) => t.id !== id),
      assignments: Object.fromEntries(
        Object.entries(localThemes.assignments || {}).filter(([_, tid]) => tid !== id)
      )
    };
    save(next);
  };

  const updateTheme = (id: string, field: keyof WidgetTheme, val: any) => {
    const next = {
      ...localThemes,
      themes: themes.map((t) => (t.id === id ? { ...t, [field]: val } : t))
    };
    save(next);
  };

  const assignTheme = (widgetId: string, themeId: string) => {
    let finalThemeId = themeId;
    if (!finalThemeId) {
      if (widgetId.includes("gpu")) finalThemeId = "theme-gpu-default";
      else if (widgetId.includes("deadlines")) finalThemeId = "theme-deadline-default";
      else if (widgetId.includes("arxiv")) finalThemeId = "theme-arxiv-default";
      else if (widgetId.includes("quota")) finalThemeId = "theme-quota-default";
    }
    const next = {
      ...localThemes,
      assignments: { ...(localThemes.assignments || {}), [widgetId]: finalThemeId }
    };
    save(next);
  };

  const isLight = dashboardTheme === "light";

  if (widgetId) {
    const defaultThemeId = widgetId.includes("gpu")
      ? "theme-gpu-default"
      : widgetId.includes("deadlines")
      ? "theme-deadline-default"
      : widgetId.includes("arxiv")
      ? "theme-arxiv-default"
      : "theme-quota-default";

    const activeThemeId = localThemes.assignments?.[widgetId] || defaultThemeId;
    const activeTheme = themes.find((t) => t.id === activeThemeId) || themes.find((t) => t.id === defaultThemeId) || themes[0];

    if (!activeTheme) return null;

    const filteredThemes = themes.filter((t) => {
      // Default (preset) themes: only show those matching this widget type
      if (t.is_default) {
        if (widgetId.includes("gpu")) {
          return t.id === "theme-gpu-default" || t.id === "theme-gpu-transparent";
        } else if (widgetId.includes("deadlines")) {
          return t.id === "theme-deadline-default" || t.id === "theme-deadline-transparent";
        } else if (widgetId.includes("arxiv")) {
          return t.id === "theme-arxiv-default" || t.id === "theme-arxiv-transparent";
        } else if (widgetId.includes("quota")) {
          return t.id === "theme-quota-default" || t.id === "theme-quota-transparent";
        }
        return false;
      }
      // Custom themes: only show if scoped to this widget (or legacy themes with no scope)
      if (t.widget_scope && t.widget_scope !== widgetId) return false;
      return true;
    });

    return (
      <div className={`p-6 border border-[var(--dashboard-border)] rounded-2xl space-y-6 ${isLight ? "bg-slate-50" : "bg-white/5"}`}>
        <div className="flex items-center justify-between">
          <h3 className={`text-xs font-black uppercase tracking-wider ${isLight ? "text-slate-500" : "text-slate-400"}`}>Theme & Styling</h3>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {filteredThemes.map((theme) => {
            const isSelected = theme.id === activeTheme.id;
            const isConfirmingDelete = confirmDeleteId === theme.id;
            return (
              <div
                key={theme.id}
                onClick={() => {
                  if (isConfirmingDelete) return;
                  assignTheme(widgetId, theme.id);
                }}
                className={`p-3 rounded-xl border transition-all cursor-pointer relative ${
                  isSelected
                    ? "ring-2 ring-blue-500 border-blue-500 shadow-lg"
                    : isLight
                    ? "bg-white border-slate-200 hover:border-slate-300"
                    : "bg-black/25 border-white/5 hover:border-white/10"
                }`}
              >
                {/* Name row */}
                <div className="flex items-center justify-between mb-2 gap-1">
                  <div className="font-bold text-[11px] truncate flex-1">{theme.name}</div>
                  {theme.is_default && (
                    <span className="text-[8px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded-md bg-blue-500/10 text-blue-400 border border-blue-500/10 whitespace-nowrap flex-shrink-0">
                      Preset
                    </span>
                  )}
                </div>

                {/* Color swatches + action buttons row */}
                <div className="flex items-center gap-1 min-w-0">
                  {/* Swatches */}
                  <div className="flex items-center gap-1 flex-1 min-w-0 overflow-hidden">
                    <div
                      className="w-4 h-4 rounded-md border border-slate-400 dark:border-slate-400 shadow-inner flex-shrink-0"
                      style={{ backgroundColor: hexToRgba(theme.bg_color, theme.bg_opacity) }}
                      title="Background"
                    />
                    <div className="w-[1px] h-3 bg-slate-300/40 dark:bg-white/10 flex-shrink-0" />
                    <div
                      className="w-4 h-4 rounded-md border border-slate-400 dark:border-slate-400 shadow-inner flex-shrink-0"
                      style={{ backgroundColor: hexToRgba(theme.text_colors[0]?.value || "#ffffff", theme.text_colors[0]?.opacity ?? 1) }}
                      title="Main Text"
                    />
                    <div
                      className="w-4 h-4 rounded-md border border-slate-400 dark:border-slate-400 shadow-inner flex-shrink-0"
                      style={{ backgroundColor: hexToRgba(theme.text_colors[1]?.value || "#94a3b8", theme.text_colors[1]?.opacity ?? 0.6) }}
                      title="Sub Text"
                    />
                    {theme.primary_colors.length > 0 && (
                      <>
                        <div className="w-[1px] h-3 bg-slate-300/40 dark:bg-white/10 flex-shrink-0" />
                        <div className="flex -space-x-1 overflow-hidden">
                          {theme.primary_colors.slice(0, 4).map((c, idx) => (
                            <div
                              key={idx}
                              className="w-3 h-3 rounded-full border border-slate-400 dark:border-slate-400 flex-shrink-0"
                              style={{ backgroundColor: hexToRgba(c.value, c.opacity ?? 1) }}
                              title={c.name}
                            />
                          ))}
                        </div>
                      </>
                    )}
                  </div>

                  {/* Action buttons */}
                  {isConfirmingDelete ? (
                    <div className="flex items-center gap-1 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
                      <span className="text-[9px] font-bold text-red-400 whitespace-nowrap">Delete?</span>
                      <button
                        onClick={(e) => { e.stopPropagation(); deleteTheme(theme.id); setConfirmDeleteId(null); }}
                        className="px-1.5 py-0.5 rounded text-[9px] font-black bg-red-500 hover:bg-red-400 text-white transition-all"
                      >Yes</button>
                      <button
                        onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(null); }}
                        className={`px-1.5 py-0.5 rounded text-[9px] font-black transition-all ${
                          isLight ? "bg-slate-200 hover:bg-slate-300 text-slate-700" : "bg-white/10 hover:bg-white/20 text-white"
                        }`}
                      >No</button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button
                        onClick={(e) => { e.stopPropagation(); copyTheme(theme, widgetId); }}
                        className="p-1 rounded bg-blue-600/10 hover:bg-blue-600 text-blue-400 hover:text-white transition-all"
                        title="Duplicate"
                      >
                        <Copy size={10} />
                      </button>
                      {!theme.is_default && (
                        <button
                          onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(theme.id); }}
                          className="p-1 rounded bg-red-500/10 hover:bg-red-500/20 text-red-400 transition-all"
                          title="Delete"
                        >
                          <X size={10} />
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {activeTheme.is_default ? (
          <div className={`p-4 rounded-xl border ${isLight ? "bg-blue-50/50 border-blue-100/50 text-blue-800" : "bg-blue-500/5 border-blue-500/10 text-blue-300"} text-xs font-medium flex flex-col sm:flex-row items-center justify-between gap-3`}>
            <span>This theme is a read-only system preset. Click <strong>Duplicate Theme</strong> to customize colors for this widget.</span>
            <button
              onClick={() => copyTheme(activeTheme, widgetId)}
              className="w-full sm:w-auto px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-black uppercase tracking-widest transition-all whitespace-nowrap shadow-md shadow-blue-600/10"
            >
              Duplicate Theme
            </button>
          </div>
        ) : (
          <div className="space-y-6 pt-4 border-t border-[var(--dashboard-border)]">
            <div className="space-y-1.5">
              <label className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                Theme Name
              </label>
              <input
                type="text"
                value={activeTheme.name}
                onChange={(e) => updateTheme(activeTheme.id, "name", e.target.value)}
                className={`w-full px-4 py-2.5 rounded-xl text-xs font-bold border transition-all ${
                  isLight ? "bg-white border-slate-200 text-slate-900" : "bg-black/40 border-white/10 text-white focus:bg-black/60 focus:outline-none"
                }`}
              />
            </div>
            
            <div className="space-y-4">
              <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 block">
                Color Configuration
              </label>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* Background Color Card */}
                <div
                  className={`flex flex-col gap-2 p-3 rounded-xl border overflow-hidden transition-all ${
                    isLight ? "bg-white border-slate-200" : "bg-black/25 border-white/5"
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <input
                      type="color"
                      value={activeTheme.bg_color}
                      onChange={(e) => updateTheme(activeTheme.id, "bg_color", e.target.value)}
                      className="w-5 h-5 rounded-md border border-slate-400 dark:border-slate-400 cursor-pointer overflow-hidden p-0 [&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:border-none hover:border-blue-500 hover:scale-105 transition-all shadow-inner flex-shrink-0"
                    />
                    <span className={`flex-1 text-[10px] font-bold truncate ${isLight ? "text-slate-900" : "text-white"}`}>
                      Background
                    </span>
                    <div className="flex items-center gap-0.5 bg-black/10 dark:bg-white/5 border border-slate-300 dark:border-white/10 rounded px-1 py-0.5 flex-shrink-0">
                      <input
                        type="number"
                        min="0"
                        max="100"
                        value={Math.round(activeTheme.bg_opacity * 100)}
                        onChange={(e) => {
                          let val = parseInt(e.target.value);
                          if (isNaN(val)) val = 0;
                          val = Math.max(0, Math.min(100, val));
                          updateTheme(activeTheme.id, "bg_opacity", val / 100);
                        }}
                        className={`w-6 text-right bg-transparent border-none text-[9px] font-mono font-bold focus:ring-0 p-0 focus:outline-none appearance-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none [&::-moz-number-spin-box]:hidden ${
                          isLight ? "text-slate-900" : "text-white"
                        }`}
                      />
                      <span className="text-[9px] font-mono font-bold opacity-50">%</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="text-[8px] text-slate-500 font-bold uppercase tracking-wider flex-shrink-0">Opacity</span>
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.01"
                      value={activeTheme.bg_opacity}
                      onChange={(e) => updateTheme(activeTheme.id, "bg_opacity", parseFloat(e.target.value))}
                      className="flex-1 min-w-0 h-3 accent-blue-600 cursor-pointer"
                    />
                  </div>
                </div>

                {/* Text Colors Cards */}
                {activeTheme.text_colors.map((c, i) => (
                  <div
                    key={i}
                    className={`flex flex-col gap-2 p-3 rounded-xl border overflow-hidden transition-all ${
                      isLight ? "bg-white border-slate-200" : "bg-black/25 border-white/5"
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <input
                        type="color"
                        value={c.value}
                        onChange={(e) => {
                          const colors = [...activeTheme.text_colors];
                          colors[i].value = e.target.value;
                          updateTheme(activeTheme.id, "text_colors", colors);
                        }}
                        className="w-5 h-5 rounded-md border border-slate-400 dark:border-slate-400 cursor-pointer overflow-hidden p-0 [&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:border-none hover:border-blue-500 hover:scale-105 transition-all shadow-inner flex-shrink-0"
                      />
                      <span className={`flex-1 text-[10px] font-bold truncate ${isLight ? "text-slate-900" : "text-white"}`}>
                        {c.name}
                      </span>
                      <div className="flex items-center gap-0.5 bg-black/10 dark:bg-white/5 border border-slate-300 dark:border-white/10 rounded px-1 py-0.5 flex-shrink-0">
                        <input
                          type="number"
                          min="0"
                          max="100"
                          value={Math.round((c.opacity ?? 1) * 100)}
                          onChange={(e) => {
                            let val = parseInt(e.target.value);
                            if (isNaN(val)) val = 0;
                            val = Math.max(0, Math.min(100, val));
                            const colors = [...activeTheme.text_colors];
                            colors[i].opacity = val / 100;
                            updateTheme(activeTheme.id, "text_colors", colors);
                          }}
                          className={`w-6 text-right bg-transparent border-none text-[9px] font-mono font-bold focus:ring-0 p-0 focus:outline-none appearance-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none [&::-moz-number-spin-box]:hidden ${
                            isLight ? "text-slate-900" : "text-white"
                          }`}
                        />
                        <span className="text-[9px] font-mono font-bold opacity-50">%</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="text-[8px] text-slate-500 font-bold uppercase tracking-wider flex-shrink-0">Opacity</span>
                      <input
                        type="range"
                        min="0"
                        max="1"
                        step="0.01"
                        value={c.opacity ?? 1}
                        onChange={(e) => {
                          const colors = [...activeTheme.text_colors];
                          colors[i].opacity = parseFloat(e.target.value);
                          updateTheme(activeTheme.id, "text_colors", colors);
                        }}
                        className="flex-1 min-w-0 h-3 accent-blue-600 cursor-pointer"
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                  Primary Colors
                </label>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 max-h-[300px] overflow-y-auto pr-1 custom-scrollbar">
                {activeTheme.primary_colors.map((c, i) => (
                  <div
                    key={i}
                    className={`flex flex-col gap-2 p-3 rounded-xl border overflow-hidden transition-all ${
                      isLight ? "bg-white border-slate-200" : "bg-black/25 border-white/5"
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <input
                        type="color"
                        value={c.value}
                        onChange={(e) => {
                          const colors = [...activeTheme.primary_colors];
                          colors[i].value = e.target.value;
                          updateTheme(activeTheme.id, "primary_colors", colors);
                        }}
                        className="w-5 h-5 rounded-full border border-slate-400 dark:border-slate-400 cursor-pointer overflow-hidden p-0 [&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:border-none hover:border-blue-500 hover:scale-105 transition-all shadow-inner flex-shrink-0"
                      />
                      <span className={`flex-1 text-[10px] font-bold truncate ${isLight ? "text-slate-900" : "text-white"}`}>
                        {c.name}
                      </span>
                      <div className="flex items-center gap-0.5 bg-black/10 dark:bg-white/5 border border-slate-300 dark:border-white/10 rounded px-1 py-0.5 flex-shrink-0">
                        <input
                          type="number"
                          min="0"
                          max="100"
                          value={Math.round((c.opacity ?? 1) * 100)}
                          onChange={(e) => {
                            let val = parseInt(e.target.value);
                            if (isNaN(val)) val = 0;
                            val = Math.max(0, Math.min(100, val));
                            const colors = [...activeTheme.primary_colors];
                            colors[i].opacity = val / 100;
                            updateTheme(activeTheme.id, "primary_colors", colors);
                          }}
                          className={`w-6 text-right bg-transparent border-none text-[9px] font-mono font-bold focus:ring-0 p-0 focus:outline-none appearance-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none [&::-moz-number-spin-box]:hidden ${
                            isLight ? "text-slate-900" : "text-white"
                          }`}
                        />
                        <span className="text-[9px] font-mono font-bold opacity-50">%</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="text-[8px] text-slate-500 font-bold uppercase tracking-wider flex-shrink-0">Opacity</span>
                      <input
                        type="range"
                        min="0"
                        max="1"
                        step="0.01"
                        value={c.opacity ?? 1}
                        onChange={(e) => {
                          const colors = [...activeTheme.primary_colors];
                          colors[i].opacity = parseFloat(e.target.value);
                          updateTheme(activeTheme.id, "primary_colors", colors);
                        }}
                        className="flex-1 min-w-0 h-3 accent-blue-600 cursor-pointer"
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <section>
      <div className="flex items-center justify-between mb-6">
        <h2 className={`text-2xl font-bold ${isLight ? "text-slate-900" : "text-white"}`}>Widget Themes</h2>
        <button
          onClick={addTheme}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-xl text-xs font-black uppercase tracking-widest text-white transition-all flex items-center gap-2"
        >
          <Plus size={14} /> Create Theme
        </button>
      </div>

      <div className={`p-6 border border-[var(--dashboard-border)] rounded-3xl space-y-8 ${isLight ? "bg-slate-50" : "bg-white/5"}`}>
        {/* Theme List */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {themes.map((theme) => {
            const usedBy = Object.entries(localThemes.assignments || {})
              .filter(([_, tid]) => tid === theme.id)
              .map(([wid]) => wid.replace("widget-", "").replace("-default", ""));

            return (
              <div
                key={theme.id}
                className={`p-5 rounded-2xl border transition-all ${
                  editingThemeId === theme.id
                    ? "ring-2 ring-blue-500 border-blue-500"
                    : isLight
                    ? "bg-white border-slate-200"
                    : "bg-black/20 border-white/5"
                }`}
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="font-bold text-sm truncate pr-2">{theme.name}</div>
                  {theme.is_default && (
                    <span className="text-[8px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded-md bg-blue-500/10 text-blue-400 border border-blue-500/10 whitespace-nowrap flex-shrink-0">
                      System Preset
                    </span>
                  )}
                </div>

                  <div className="flex items-center gap-1.5 mb-4">
                    <div
                      className="w-5 h-5 rounded-md border border-slate-400 dark:border-slate-400 shadow-inner flex-shrink-0"
                      style={{ backgroundColor: hexToRgba(theme.bg_color, theme.bg_opacity) }}
                      title="Background Color"
                    />
                    <div className="w-[1px] h-4 bg-slate-300/30 dark:bg-white/10 mx-0.5 flex-shrink-0" />
                    <div
                      className="w-5 h-5 rounded-md border border-slate-400 dark:border-slate-400 shadow-inner flex-shrink-0"
                      style={{
                        backgroundColor: hexToRgba(
                          theme.text_colors[0]?.value || "#ffffff",
                          theme.text_colors[0]?.opacity ?? 1
                        )
                      }}
                      title="Main Text Color"
                    />
                    <div
                      className="w-5 h-5 rounded-md border border-slate-400 dark:border-slate-400 shadow-inner flex-shrink-0"
                      style={{
                        backgroundColor: hexToRgba(
                          theme.text_colors[1]?.value || "#94a3b8",
                          theme.text_colors[1]?.opacity ?? 0.6
                        )
                      }}
                      title="Sub Text Color"
                    />
                    {theme.primary_colors.length > 0 && (
                      <div className="w-[1px] h-4 bg-slate-300/30 dark:bg-white/10 mx-1 flex-shrink-0" />
                    )}
                    <div className="flex -space-x-1 overflow-hidden">
                      {theme.primary_colors.map((c, i) => (
                        <div
                          key={i}
                          className="w-3.5 h-3.5 rounded-full border border-slate-400 dark:border-slate-400 flex-shrink-0"
                          style={{ backgroundColor: hexToRgba(c.value, c.opacity ?? 1) }}
                          title={c.name}
                        />
                      ))}
                    </div>
                  </div>

                <div className="flex items-center gap-2 mb-4 overflow-hidden h-5">
                  {usedBy.length > 0 ? (
                    <div className="flex items-center gap-1.5 overflow-hidden">
                      <span className="text-[10px] text-slate-500 font-bold uppercase truncate font-mono">
                        Used by: {usedBy.join(", ")}
                      </span>
                      {usedBy.some((u) => activeWidgets.includes(`widget-${u}-default`)) && (
                        <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse flex-shrink-0" title="Active" />
                      )}
                    </div>
                  ) : (
                    <span className="text-[10px] text-slate-600 italic">Unassigned</span>
                  )}
                </div>

                {/* Direct Assignment Buttons */}
                <div className="flex items-center gap-1.5 mb-4 p-1.5 bg-black/10 rounded-lg border border-white/5">
                  {["gpu", "deadlines", "arxiv"].map((type) => {
                    const wid = `widget-${type}-default`;
                    const isActive = localThemes.assignments?.[wid] === theme.id;
                    return (
                      <button
                        key={wid}
                        onClick={() => assignTheme(wid, isActive ? "" : theme.id)}
                        className={`flex-1 py-1 rounded-md text-[8px] font-black uppercase tracking-tighter transition-all border ${
                          isActive
                            ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30"
                            : "bg-white/5 text-slate-600 border-transparent hover:border-white/10"
                        }`}
                      >
                        {type}
                      </button>
                    );
                  })}
                </div>

                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => setEditingThemeId(theme.id)}
                    className="flex-1 py-2 rounded-lg bg-blue-600/10 text-blue-400 hover:bg-blue-600 hover:text-white transition-all text-[10px] font-black uppercase tracking-widest"
                  >
                    {theme.is_default ? "Assign" : "Edit"}
                  </button>
                  <button
                    onClick={() => copyTheme(theme)}
                    className="p-2 rounded-lg bg-white/5 hover:bg-white/10 text-slate-400 transition-all"
                  >
                    <Copy size={14} />
                  </button>
                  {!theme.is_default && (
                    <button
                      onClick={() => deleteTheme(theme.id)}
                      className="p-2 rounded-lg bg-red-500/10 hover:bg-red-500 text-red-400 hover:text-white transition-all"
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Editor */}
        <AnimatePresence>
          {editingTheme && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 10 }}
              className={`p-8 rounded-3xl border ${
                isLight ? "bg-white border-slate-200" : "bg-black/60 border-white/10 backdrop-blur-xl"
              } space-y-8 relative`}
            >
              <button
                onClick={() => setEditingThemeId(null)}
                className="absolute top-6 right-6 text-slate-500 hover:text-white transition-colors p-2 rounded-full hover:bg-white/10"
              >
                <X size={20} />
              </button>

              {!editingTheme.is_default ? (
                <div className="grid grid-cols-2 gap-12">
                  <div className="space-y-6">
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                        Theme Name
                      </label>
                      <input
                        type="text"
                        value={editingTheme.name}
                        onChange={(e) => updateTheme(editingTheme.id, "name", e.target.value)}
                        className={`w-full px-4 py-3 rounded-xl text-sm font-bold border transition-all ${
                          isLight ? "bg-slate-50 border-slate-200 text-slate-900" : "bg-black/40 border-white/10 text-white"
                        }`}
                      />
                    </div>

                    <div className="space-y-4">
                      <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 block">
                        Background & Text Colors
                      </label>
                      <div className="flex flex-col gap-4">
                        {/* Background Color Card */}
                        <div
                          className={`flex flex-col gap-3 p-4 rounded-xl border transition-all ${
                            isLight ? "bg-white border-slate-200" : "bg-black/25 border-white/5"
                          }`}
                        >
                          <div className="flex items-center gap-3">
                            <input
                              type="color"
                              value={editingTheme.bg_color}
                              onChange={(e) => updateTheme(editingTheme.id, "bg_color", e.target.value)}
                              className="w-8 h-8 rounded-md border border-slate-400 dark:border-slate-400 cursor-pointer overflow-hidden p-0 [&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:border-none hover:border-blue-500 hover:scale-105 transition-all shadow-inner flex-shrink-0"
                            />
                            <span className={`flex-1 text-xs font-bold ${isLight ? "text-slate-900" : "text-white"}`}>
                              Background Color
                            </span>
                            <div className="flex items-center gap-0.5 bg-black/10 dark:bg-white/5 border border-slate-300 dark:border-white/10 rounded-md px-1.5 py-0.5">
                              <input
                                type="number"
                                min="0"
                                max="100"
                                value={Math.round(editingTheme.bg_opacity * 100)}
                                onChange={(e) => {
                                  let val = parseInt(e.target.value);
                                  if (isNaN(val)) val = 0;
                                  val = Math.max(0, Math.min(100, val));
                                  updateTheme(editingTheme.id, "bg_opacity", val / 100);
                                }}
                                className={`w-7 text-right bg-transparent border-none text-[10px] font-mono font-bold focus:ring-0 p-0 focus:outline-none ${
                                  isLight ? "text-slate-900" : "text-white"
                                }`}
                              />
                              <span className="text-[10px] font-mono font-bold opacity-50">%</span>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-[9px] text-slate-500 font-bold uppercase tracking-wider">Opacity</span>
                            <input
                              type="range"
                              min="0"
                              max="1"
                              step="0.01"
                              value={editingTheme.bg_opacity}
                              onChange={(e) => updateTheme(editingTheme.id, "bg_opacity", parseFloat(e.target.value))}
                              className="flex-1 h-4 accent-blue-600 cursor-pointer"
                            />
                          </div>
                        </div>

                        {/* Text Colors */}
                        {editingTheme.text_colors.map((c, i) => (
                          <div
                            key={i}
                            className={`flex flex-col gap-3 p-4 rounded-xl border transition-all ${
                              isLight ? "bg-white border-slate-200" : "bg-black/25 border-white/5"
                            }`}
                          >
                            <div className="flex items-center gap-3">
                              <input
                                type="color"
                                value={c.value}
                                onChange={(e) => {
                                  const colors = [...editingTheme.text_colors];
                                  colors[i].value = e.target.value;
                                  updateTheme(editingTheme.id, "text_colors", colors);
                                }}
                                className="w-8 h-8 rounded-md border border-slate-400 dark:border-slate-400 cursor-pointer overflow-hidden p-0 [&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:border-none hover:border-blue-500 hover:scale-105 transition-all shadow-inner flex-shrink-0"
                              />
                              <span className={`flex-1 text-xs font-bold ${isLight ? "text-slate-900" : "text-white"}`}>
                                {c.name}
                              </span>
                              <div className="flex items-center gap-0.5 bg-black/10 dark:bg-white/5 border border-slate-300 dark:border-white/10 rounded-md px-1.5 py-0.5">
                                <input
                                  type="number"
                                  min="0"
                                  max="100"
                                  value={Math.round((c.opacity ?? 1) * 100)}
                                  onChange={(e) => {
                                    let val = parseInt(e.target.value);
                                    if (isNaN(val)) val = 0;
                                    val = Math.max(0, Math.min(100, val));
                                    const colors = [...editingTheme.text_colors];
                                    colors[i].opacity = val / 100;
                                    updateTheme(editingTheme.id, "text_colors", colors);
                                  }}
                                  className={`w-7 text-right bg-transparent border-none text-[10px] font-mono font-bold focus:ring-0 p-0 focus:outline-none ${
                                    isLight ? "text-slate-900" : "text-white"
                                  }`}
                                />
                                <span className="text-[10px] font-mono font-bold opacity-50">%</span>
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-[9px] text-slate-500 font-bold uppercase tracking-wider">Opacity</span>
                              <input
                                type="range"
                                min="0"
                                max="1"
                                step="0.01"
                                value={c.opacity ?? 1}
                                onChange={(e) => {
                                  const colors = [...editingTheme.text_colors];
                                  colors[i].opacity = parseFloat(e.target.value);
                                  updateTheme(editingTheme.id, "text_colors", colors);
                                }}
                                className="flex-1 h-4 accent-blue-600 cursor-pointer"
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="space-y-6">
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                        Primary Colors
                      </label>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-h-[320px] overflow-y-auto pr-1 custom-scrollbar">
                      {editingTheme.primary_colors.map((c, i) => (
                        <div
                          key={i}
                          className={`flex flex-col gap-3 p-4 rounded-xl border transition-all ${
                            isLight ? "bg-white border-slate-200" : "bg-black/25 border-white/5"
                          }`}
                        >
                          <div className="flex items-center gap-3">
                            <input
                              type="color"
                              value={c.value}
                              onChange={(e) => {
                                const colors = [...editingTheme.primary_colors];
                                colors[i].value = e.target.value;
                                updateTheme(editingTheme.id, "primary_colors", colors);
                              }}
                              className="w-8 h-8 rounded-full border border-slate-400 dark:border-slate-400 cursor-pointer overflow-hidden p-0 [&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:border-none hover:border-blue-500 hover:scale-105 transition-all shadow-inner flex-shrink-0"
                            />
                            <span className={`flex-1 text-xs font-bold ${isLight ? "text-slate-900" : "text-white"}`}>
                              {c.name}
                            </span>
                            <div className="flex items-center gap-0.5 bg-black/10 dark:bg-white/5 border border-slate-300 dark:border-white/10 rounded-md px-1.5 py-0.5">
                              <input
                                type="number"
                                min="0"
                                max="100"
                                value={Math.round((c.opacity ?? 1) * 100)}
                                onChange={(e) => {
                                  let val = parseInt(e.target.value);
                                  if (isNaN(val)) val = 0;
                                  val = Math.max(0, Math.min(100, val));
                                  const colors = [...editingTheme.primary_colors];
                                  colors[i].opacity = val / 100;
                                  updateTheme(editingTheme.id, "primary_colors", colors);
                                }}
                                className={`w-7 text-right bg-transparent border-none text-[10px] font-mono font-bold focus:ring-0 p-0 focus:outline-none ${
                                  isLight ? "text-slate-900" : "text-white"
                                }`}
                              />
                              <span className="text-[10px] font-mono font-bold opacity-50">%</span>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-[9px] text-slate-500 font-bold uppercase tracking-wider">Opacity</span>
                            <input
                              type="range"
                              min="0"
                              max="1"
                              step="0.01"
                              value={c.opacity ?? 1}
                              onChange={(e) => {
                                const colors = [...editingTheme.primary_colors];
                                colors[i].opacity = parseFloat(e.target.value);
                                updateTheme(editingTheme.id, "primary_colors", colors);
                              }}
                              className="flex-1 h-4 accent-blue-600 cursor-pointer"
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="py-4">
                  <div className="flex items-center gap-4 mb-6">
                    <div className="p-3 rounded-2xl bg-blue-500/10 text-blue-400 border border-blue-500/10">
                      <Settings size={24} />
                    </div>
                    <div>
                      <h3 className="text-lg font-bold">System Preset: {editingTheme.name}</h3>
                      <p className="text-xs text-slate-500">This theme is read-only. You can assign it to widgets below.</p>
                    </div>
                  </div>
                </div>
              )}

              {/* Assignment Section (Unified) */}
              <div className="pt-8 border-t border-white/5">
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 block mb-4">
                  Assign Theme to Widgets
                </label>
                <div className="flex gap-4">
                  {["gpu", "deadlines"].map((type) => {
                    const wid = `widget-${type}-default`;
                    const isActive = localThemes.assignments?.[wid] === editingTheme.id;
                    const name = type.toUpperCase();
                    return (
                      <button
                        key={wid}
                        onClick={() => assignTheme(wid, isActive ? "" : editingTheme.id)}
                        className={`flex-1 flex items-center justify-between px-6 py-4 rounded-2xl transition-all border ${
                          isActive
                            ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                            : "bg-white/5 text-slate-500 border-white/5 hover:border-white/10"
                        }`}
                      >
                        <span className="text-xs font-black uppercase tracking-widest">{name}</span>
                        <div
                          className={`w-2 h-2 rounded-full ${
                            isActive
                              ? "bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.5)] animate-pulse"
                              : "bg-white/10"
                          }`}
                        />
                      </button>
                    );
                  })}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </section>
  );
}
