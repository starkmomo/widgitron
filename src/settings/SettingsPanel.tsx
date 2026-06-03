import { useState, useEffect, useRef } from "react";
import { Sun, Moon, X, Plus, RotateCcw, Settings, Cpu, Calendar, BookOpen, Coins, Info, GripVertical, ChevronDown } from "lucide-react";
import { motion, AnimatePresence, Reorder, useDragControls } from "framer-motion";
import { invoke } from "@tauri-apps/api/core";
import { WidgetThemeConfig } from "../types/theme";
import { MasterSwitch } from "../components/MasterSwitch";
import { ThemeManagementSection } from "./ThemeManagementSection";

const PROVIDER_LOGOS: Record<string, string> = {
  antigravity: "/icons/antigravity.svg",
  codex: "/icons/codex.svg",
  cursor: "/icons/cursor.svg",
  copilot: "/icons/vscode.svg",
};

const PROVIDER_OPTIONS = [
  { value: "antigravity", label: "Antigravity" },
  { value: "codex", label: "Codex" },
  { value: "cursor", label: "Cursor" },
  { value: "copilot", label: "VS Code Copilot" },
];

const BUILTIN_PROVIDERS = new Set(["antigravity", "codex", "cursor", "copilot"]);

function QuotaItemCard({
  q, appConfig, openProviderId,
  onToggleProvider, onRemove, onUpdateField, onSave, localQuota,
}: {
  q: any; appConfig: any; openProviderId: string | null;
  onToggleProvider: (id: string | null) => void;
  onRemove: (id: string) => void;
  onUpdateField: (id: string, field: string, val: any, save?: boolean) => void;
  onSave: (config: any) => void;
  localQuota: any;
}) {
  const controls = useDragControls();
  const isBuiltin = BUILTIN_PROVIDERS.has(q.provider);
  const isOpen = openProviderId === q.id;
  const selectedProvider = PROVIDER_OPTIONS.find(p => p.value === q.provider) || PROVIDER_OPTIONS[0];
  return (
    <Reorder.Item
      value={q}
      dragListener={false}
      dragControls={controls}
      whileDrag={{ scale: 1.02, opacity: 0.8, zIndex: 99 }}
      className={`border border-[var(--dashboard-border)] rounded-2xl relative group transition-colors ${
        appConfig.theme === "light" ? "bg-white" : "bg-white/5"
      }`}
    >
      <button
        onClick={() => onRemove(q.id)}
        className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-red-500 text-white opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center shadow-lg z-10"
      >
        <X size={12} />
      </button>
      <div className="flex items-center gap-3 p-4">
        <div
          onPointerDown={(e) => { controls.start(e); }}
          className={`flex-shrink-0 p-1.5 rounded-lg cursor-grab active:cursor-grabbing select-none touch-none ${
            appConfig.theme === "light" ? "text-slate-300 hover:text-slate-500 hover:bg-slate-100" : "text-slate-600 hover:text-slate-400 hover:bg-white/5"
          }`}
        >
          <GripVertical size={16} />
        </div>
        <div className="flex-shrink-0 w-8 h-8 rounded-xl border border-[var(--dashboard-border)] flex items-center justify-center overflow-hidden"
          style={{ background: appConfig.theme === "light" ? "#f8fafc" : "rgba(255,255,255,0.03)" }}>
          {PROVIDER_LOGOS[selectedProvider.value] ? (
            <img src={PROVIDER_LOGOS[selectedProvider.value]} alt="" className="w-5 h-5 object-contain" draggable={false} />
          ) : (
            <Cpu size={14} className="text-slate-400" />
          )}
        </div>
        <div className="relative flex-1 min-w-0" onClick={(e) => e.stopPropagation()}>
          <button
            onClick={() => onToggleProvider(isOpen ? null : q.id)}
            className={`w-full flex items-center justify-between gap-2 px-4 py-2.5 rounded-xl text-xs font-bold border transition-all cursor-pointer ${
              appConfig.theme === "light"
                ? "bg-slate-50 border-slate-200 text-slate-900 hover:bg-slate-100"
                : "bg-black/40 border-white/10 text-white hover:bg-black/60"
            }`}
          >
            <span className="truncate">{selectedProvider.label}</span>
            <ChevronDown size={14} className={`flex-shrink-0 transition-transform ${isOpen ? "rotate-180" : ""}`} />
          </button>
          {isOpen && (
            <div className={`absolute z-50 top-full left-0 right-0 mt-1 rounded-xl border shadow-xl overflow-hidden ${
              appConfig.theme === "light" ? "bg-white border-slate-200" : "bg-slate-800 border-white/10"
            }`}>
              {PROVIDER_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => { onUpdateField(q.id, "provider", opt.value, true); onToggleProvider(null); }}
                  className={`w-full flex items-center gap-3 px-4 py-2.5 text-xs font-bold transition-colors cursor-pointer ${
                    q.provider === opt.value
                      ? appConfig.theme === "light" ? "bg-blue-50 text-blue-600" : "bg-blue-500/10 text-blue-400"
                      : appConfig.theme === "light" ? "text-slate-700 hover:bg-slate-50" : "text-slate-200 hover:bg-white/5"
                  }`}
                >
                  {PROVIDER_LOGOS[opt.value] ? (
                    <img src={PROVIDER_LOGOS[opt.value]} alt="" className="w-4 h-4 object-contain flex-shrink-0" draggable={false} />
                  ) : (
                    <Cpu size={14} className="text-slate-400 flex-shrink-0" />
                  )}
                  <span>{opt.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      {!isBuiltin && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 px-4 pb-4">
          <div className="space-y-1.5">
            <label className="text-[10px] font-black uppercase tracking-widest text-slate-500">Monitor Name</label>
            <input type="text" value={q.name || ""} onChange={(e) => onUpdateField(q.id, "name", e.target.value)} onBlur={() => onSave(localQuota)}
              onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
              className={`w-full px-4 py-2 rounded-xl text-xs font-bold border transition-all ${appConfig.theme === "light" ? "bg-slate-50 border-slate-200 text-slate-900 focus:bg-white" : "bg-black/40 border-white/10 text-white focus:bg-black/60"}`}
              placeholder="e.g. My API" />
          </div>
          <div className="space-y-1.5">
            <label className="text-[10px] font-black uppercase tracking-widest text-slate-500">API Key / Token</label>
            <input type="password" value={q.api_key || ""} onChange={(e) => onUpdateField(q.id, "api_key", e.target.value)} onBlur={() => onSave(localQuota)}
              onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
              className={`w-full px-4 py-2 rounded-xl text-xs font-bold border transition-all ${appConfig.theme === "light" ? "bg-slate-50 border-slate-200 text-slate-900 focus:bg-white" : "bg-black/40 border-white/10 text-white focus:bg-black/60"}`}
              placeholder="sk-..." />
          </div>
          <div className="space-y-1.5">
            <label className="text-[10px] font-black uppercase tracking-widest text-slate-500">Max Quota</label>
            <input type="number" value={q.max_quota || 0} onChange={(e) => onUpdateField(q.id, "max_quota", parseFloat(e.target.value) || 0)} onBlur={() => onSave(localQuota)}
              onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
              className={`w-full px-4 py-2 rounded-xl text-xs font-bold border transition-all ${appConfig.theme === "light" ? "bg-slate-50 border-slate-200 text-slate-900 focus:bg-white" : "bg-black/40 border-white/10 text-white focus:bg-black/60"}`}
              placeholder="e.g. 100" />
          </div>
          <div className="space-y-1.5 md:col-span-2">
            <label className="text-[10px] font-black uppercase tracking-widest text-slate-500">API URL</label>
            <input type="text" value={q.api_url || ""} onChange={(e) => onUpdateField(q.id, "api_url", e.target.value)} onBlur={() => onSave(localQuota)}
              onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
              className={`w-full px-4 py-2 rounded-xl text-xs font-bold border transition-all ${appConfig.theme === "light" ? "bg-slate-50 border-slate-200 text-slate-900 focus:bg-white" : "bg-black/40 border-white/10 text-white focus:bg-black/60"}`}
              placeholder="https://..." />
          </div>
          <div className="space-y-1.5">
            <label className="text-[10px] font-black uppercase tracking-widest text-slate-500">Unit</label>
            <input type="text" value={q.unit || ""} onChange={(e) => onUpdateField(q.id, "unit", e.target.value)} onBlur={() => onSave(localQuota)}
              onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
              className={`w-full px-4 py-2 rounded-xl text-xs font-bold border transition-all ${appConfig.theme === "light" ? "bg-slate-50 border-slate-200 text-slate-900 focus:bg-white" : "bg-black/40 border-white/10 text-white focus:bg-black/60"}`}
              placeholder="Credits / Tokens" />
          </div>
        </div>
      )}
    </Reorder.Item>
  );
}

interface SettingsPanelProps {
  gpuConfig: any;
  paperConfig: any;
  arxivConfig: any;
  appConfig: any;
  quotaConfig: any;
  themeConfig: WidgetThemeConfig;
  onSaveGpu: (config: any) => void;
  onSavePaper: (config: any) => void;
  onSaveArxiv: (config: any) => void;
  onSaveQuota: (config: any) => void;
  onSaveApp: (config: any) => void;
  onSaveThemes: (config: WidgetThemeConfig) => void;
  isAutostart: boolean;
  onToggleAutostart: () => void;
  activeWidgets: string[];
}

export function SettingsPanel({
  gpuConfig,
  paperConfig,
  arxivConfig,
  appConfig,
  quotaConfig,
  themeConfig,
  onSaveGpu,
  onSavePaper,
  onSaveArxiv,
  onSaveQuota,
  onSaveApp,
  onSaveThemes,
  isAutostart,
  onToggleAutostart,
  activeWidgets
}: SettingsPanelProps) {
  const [localGpu, setLocalGpu] = useState<any>(gpuConfig);
  const [localPaper, setLocalPaper] = useState<any>(paperConfig);
  const [localArxiv, setLocalArxiv] = useState<any>(arxivConfig);
  const [localQuota, setLocalQuota] = useState<any>(quotaConfig);
  const [activeSection, setActiveSection] = useState<string>("general");
  const [openProviderId, setOpenProviderId] = useState<string | null>(null);

  const tabs = [
    { id: "general", label: "General", icon: Settings },
    { id: "quota", label: "Quota Monitor", icon: Coins },
    { id: "gpu", label: "GPU Monitor", icon: Cpu },
    { id: "deadlines", label: "Paper Deadlines", icon: Calendar },
    { id: "arxiv", label: "Arxiv Radar", icon: BookOpen },
    { id: "about", label: "About", icon: Info }
  ];

  useEffect(() => {
    setLocalGpu(gpuConfig);
  }, [gpuConfig]);

  useEffect(() => {
    setLocalPaper(paperConfig);
  }, [paperConfig]);

  useEffect(() => {
    setLocalArxiv(arxivConfig);
  }, [arxivConfig]);

  // Only sync quotaConfig once on first real load to prevent race conditions
  // where async save triggers prop change that resets localQuota to stale data
  const initialQuotaRef = useRef(quotaConfig);
  const quotaInitialized = useRef(false);
  useEffect(() => {
    if (quotaConfig !== initialQuotaRef.current) {
      if (!quotaInitialized.current) {
        setLocalQuota(quotaConfig);
        quotaInitialized.current = true;
      }
    }
  }, [quotaConfig]);

  // Close provider dropdown when clicking outside
  useEffect(() => {
    if (!openProviderId) return;
    const handleClickOutside = () => setOpenProviderId(null);
    document.addEventListener("click", handleClickOutside);
    return () => document.removeEventListener("click", handleClickOutside);
  }, [openProviderId]);

  const addServer = () => {
    const servers = localGpu?.servers || [];
    const next = { ...localGpu, servers: [...servers, { host: "", user: "root", password: "", port: 22 }] };
    setLocalGpu(next);
    onSaveGpu(next);
  };

  const removeServer = (idx: number) => {
    const servers = localGpu?.servers || [];
    const next = { ...localGpu, servers: servers.filter((_: any, i: number) => i !== idx) };
    setLocalGpu(next);
    onSaveGpu(next);
  };

  const updateServer = (idx: number, field: string, val: any, shouldSave = false) => {
    const next = { ...localGpu };
    const servers = [...(next.servers || [])];
    if (servers[idx]) {
      servers[idx] = { ...servers[idx], [field]: val };
      next.servers = servers;
      setLocalGpu(next);
      if (shouldSave) {
        onSaveGpu(next);
      }
    }
  };

  const addQuotaItem = () => {
    const items = localQuota?.items || [];
    const newItem = {
      id: "quota-" + Date.now(),
      name: "Antigravity",
      provider: "antigravity",
      api_key: "",
      api_url: "",
      json_path: "",
      max_quota: 100,
      unit: "%",
      current_value: 0
    };
    const next = { ...localQuota, items: [...items, newItem] };
    setLocalQuota(next);
    onSaveQuota(next);
  };

  const removeQuotaItem = (id: string) => {
    const items = localQuota?.items || [];
    const next = { ...localQuota, items: items.filter((item: any) => item.id !== id) };
    setLocalQuota(next);
    onSaveQuota(next);
  };

  const updateQuotaItem = (id: string, field: string, val: any, shouldSave = false) => {
    const next = { ...localQuota };
    const items = [...(next.items || [])];
    const idx = items.findIndex((i: any) => i.id === id);
    if (idx !== -1) {
      let updatedItem = { ...items[idx], [field]: val };
      if (field === "provider") {
        const found = PROVIDER_OPTIONS.find(p => p.value === val);
        if (found) updatedItem.name = found.label;
      }
      items[idx] = updatedItem;
      next.items = items;
      setLocalQuota(next);
      if (shouldSave) {
        onSaveQuota(next);
      }
    }
  };

  const handleRestorePosition = async (id: string, title: string) => {
    try {
      await invoke("restore_widget_position", { id, title });
    } catch (e) {
      console.error(`Failed to restore position for ${title}:`, e);
    }
  };


  const renderGeneralSection = () => (
    <section className="space-y-6">
      <div>
        <h2 className={`text-xs font-black uppercase tracking-wider ${appConfig.theme === "light" ? "text-slate-500" : "text-slate-400"}`}>
          General Settings
        </h2>
      </div>
      <div
        className={`p-6 border border-[var(--dashboard-border)] rounded-2xl space-y-6 ${
          appConfig.theme === "light" ? "bg-slate-50" : "bg-white/5"
        }`}
      >
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <div className={`text-xs font-bold ${appConfig.theme === "light" ? "text-slate-900" : "text-white"}`}>
              Dashboard Theme
            </div>
            <p className="text-[10px] text-slate-400">Choose between light and dark mode for the control panel.</p>
          </div>
          <div
            className={`flex p-1 rounded-xl border border-[var(--dashboard-border)] ${
              appConfig.theme === "light" ? "bg-slate-200" : "bg-black/20"
            }`}
          >
            <button
              onClick={() => onSaveApp({ ...appConfig, theme: "light" })}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all ${
                appConfig.theme === "light"
                  ? "bg-white text-slate-900 shadow-xl"
                  : "text-slate-500 hover:text-slate-300"
              }`}
            >
              <Sun size={12} /> Light
            </button>
            <button
              onClick={() => onSaveApp({ ...appConfig, theme: "dark" })}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all ${
                appConfig.theme === "dark"
                  ? "bg-blue-600 text-white shadow-xl shadow-blue-600/20"
                  : "text-slate-500 hover:text-slate-300"
              }`}
            >
              <Moon size={12} /> Dark
            </button>
          </div>
        </div>

        <div className="border-t border-[var(--dashboard-border)] pt-6 flex items-center justify-between">
          <div className="space-y-1">
            <div className={`text-xs font-bold ${appConfig.theme === "light" ? "text-slate-900" : "text-white"}`}>
              Launch at Startup
            </div>
            <p className="text-[10px] text-slate-400">Automatically start Widgitron when you log in to Windows.</p>
          </div>
          <button
            onClick={onToggleAutostart}
            className={`px-4 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all ${
              isAutostart
                ? "bg-emerald-500 text-white shadow-lg shadow-emerald-500/20"
                : "bg-black/40 text-slate-500 border border-white/10"
            }`}
          >
            {isAutostart ? "Enabled" : "Disabled"}
          </button>
        </div>

        <div className="border-t border-[var(--dashboard-border)] pt-6 flex items-center justify-between">
          <div className="space-y-1">
            <div className={`text-xs font-bold ${appConfig.theme === "light" ? "text-slate-900" : "text-white"}`}>
              Hide Dashboard on Startup
            </div>
            <p className="text-[10px] text-slate-400">
              Keep the control panel hidden in the system tray when the app starts.
            </p>
          </div>
          <button
            onClick={() => onSaveApp({ ...appConfig, hide_on_startup: !appConfig.hide_on_startup })}
            className={`px-4 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all ${
              appConfig.hide_on_startup
                ? "bg-blue-600 text-white shadow-lg shadow-blue-600/20"
                : "bg-black/40 text-slate-500 border border-white/10"
            }`}
          >
            {appConfig.hide_on_startup ? "Yes" : "No"}
          </button>
        </div>

        <div className="border-t border-[var(--dashboard-border)] pt-6 flex items-center justify-between">
          <div className="space-y-1">
            <div className={`text-xs font-bold ${appConfig.theme === "light" ? "text-slate-900" : "text-white"}`}>
              App Diagnostic Logs
            </div>
            <p className="text-[10px] text-slate-400">
              Open the log folder to view runtime logs and troubleshoot issues.
            </p>
          </div>
          <button
            onClick={async () => {
              try {
                await invoke("open_log_dir");
              } catch (e) {
                console.error("Failed to open log folder:", e);
              }
            }}
            className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-[10px] font-black uppercase tracking-wider transition-all shadow-lg shadow-blue-600/20"
          >
            Open Log Folder
          </button>
        </div>
      </div>
    </section>
  );

  const renderGpuSection = () => (
    <section className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className={`text-xs font-black uppercase tracking-wider ${appConfig.theme === "light" ? "text-slate-500" : "text-slate-400"}`}>
          GPU Monitor
        </h2>
        <div className="flex items-center gap-3">
          <button
            onClick={() => handleRestorePosition("widget-gpu-default", "GPU Monitor")}
            className={`flex items-center gap-1.5 px-4 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all border ${
              appConfig.theme === "light"
                ? "bg-slate-100 hover:bg-slate-200 text-slate-700 border-slate-200 hover:border-slate-300"
                : "bg-white/5 hover:bg-white/10 text-slate-300 hover:text-white border-white/5"
            }`}
          >
            <RotateCcw size={12} /> Restore Position
          </button>
        </div>
      </div>
      <div className="space-y-4">
        <div
          className={`p-6 border border-[var(--dashboard-border)] rounded-2xl flex items-center justify-between ${
            appConfig.theme === "light" ? "bg-white" : "bg-white/5"
          }`}
        >
          <div className="space-y-1">
            <div className={`text-xs font-bold ${appConfig.theme === "light" ? "text-slate-900" : "text-white"}`}>
              Compact Style
            </div>
            <p className="text-[10px] text-slate-400">
              Show 8 GPUs per row with full progress indicator backgrounds, vertical stacked labels, hiding index numbers.
            </p>
          </div>
          <button
            onClick={() => {
              const currentVal = localGpu?.compact_mode !== false;
              const next = { ...localGpu, compact_mode: !currentVal };
              setLocalGpu(next);
              onSaveGpu(next);
            }}
            className={`px-4 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all ${
              localGpu?.compact_mode !== false
                ? "bg-blue-600 text-white shadow-lg shadow-blue-600/20"
                : "bg-black/40 text-slate-500 border border-white/10"
            }`}
          >
            {localGpu?.compact_mode !== false ? "Enabled" : "Disabled"}
          </button>
        </div>

        {(localGpu?.servers || []).map((s: any, i: number) => (
          <div
            key={i}
            className={`p-6 border border-[var(--dashboard-border)] rounded-2xl grid grid-cols-4 gap-4 relative group ${
              appConfig.theme === "light" ? "bg-white" : "bg-white/5"
            }`}
          >
            <button
              onClick={() => removeServer(i)}
              className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-red-500 text-white opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center shadow-lg"
            >
              <X size={12} />
            </button>
            <div className="space-y-1.5">
              <label className="text-[10px] font-black uppercase tracking-widest text-slate-500">Host / IP</label>
              <input
                type="text"
                value={s.host || ""}
                onChange={(e) => updateServer(i, "host", e.target.value)}
                onBlur={() => onSaveGpu(localGpu)}
                onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                className={`w-full px-4 py-2 rounded-xl text-xs font-bold border transition-all ${
                  appConfig.theme === "light"
                    ? "bg-slate-50 border-slate-200 text-slate-900 focus:bg-white"
                    : "bg-black/40 border-white/10 text-white focus:bg-black/60"
                }`}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-black uppercase tracking-widest text-slate-500">Username</label>
              <input
                type="text"
                value={s.user || ""}
                onChange={(e) => updateServer(i, "user", e.target.value)}
                onBlur={() => onSaveGpu(localGpu)}
                onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                className={`w-full px-4 py-2 rounded-xl text-xs font-bold border transition-all ${
                  appConfig.theme === "light"
                    ? "bg-slate-50 border-slate-200 text-slate-900 focus:bg-white"
                    : "bg-black/40 border-white/10 text-white focus:bg-black/60"
                }`}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-black uppercase tracking-widest text-slate-500">Password</label>
              <input
                type="password"
                value={s.password || ""}
                onChange={(e) => updateServer(i, "password", e.target.value)}
                onBlur={() => onSaveGpu(localGpu)}
                onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                className={`w-full px-4 py-2 rounded-xl text-xs font-bold border transition-all ${
                  appConfig.theme === "light"
                    ? "bg-slate-50 border-slate-200 text-slate-900 focus:bg-white"
                    : "bg-black/40 border-white/10 text-white focus:bg-black/60"
                }`}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-black uppercase tracking-widest text-slate-500">Port</label>
              <input
                type="number"
                value={s.port || 22}
                onChange={(e) => updateServer(i, "port", parseInt(e.target.value))}
                onBlur={() => onSaveGpu(localGpu)}
                onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                className={`w-full px-4 py-2 rounded-xl text-xs font-bold border transition-all ${
                  appConfig.theme === "light"
                    ? "bg-slate-50 border-slate-200 text-slate-900 focus:bg-white"
                    : "bg-black/40 border-white/10 text-white focus:bg-black/60"
                }`}
              />
            </div>
            <div className="col-span-4 flex items-center gap-4 pt-2">
              <button
                onClick={() => updateServer(i, "use_slurm", !s.use_slurm, true)}
                className={`flex items-center gap-2 px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${
                  s.use_slurm
                    ? "bg-amber-500/20 text-amber-400 border border-amber-500/20 shadow-lg shadow-amber-500/10"
                    : "bg-black/40 text-slate-500 border border-white/5 hover:border-white/20"
                }`}
              >
                <div className={`w-2 h-2 rounded-full ${s.use_slurm ? "bg-amber-400 animate-pulse" : "bg-slate-600"}`} />
                Slurm Cluster Mode
              </button>
              {s.use_slurm && (
                <span className="text-[9px] text-amber-500/60 font-medium italic">
                  Enables job-based monitoring via squeue & srun
                </span>
              )}
            </div>
          </div>
        ))}
        <button
          onClick={addServer}
          className={`w-full py-4 border-2 border-dashed rounded-2xl flex items-center justify-center gap-2 font-bold uppercase tracking-widest text-xs transition-all ${
            appConfig.theme === "light"
              ? "border-slate-200 text-slate-500 hover:text-blue-600 hover:border-blue-400 hover:bg-blue-50/30"
              : "border-white/10 text-slate-500 hover:text-white hover:border-white/20 hover:bg-white/5"
          }`}
        >
          <Plus size={16} /> Add New Server
        </button>
      </div>
      <ThemeManagementSection
        themeConfig={themeConfig}
        onSaveThemes={onSaveThemes}
        dashboardTheme={appConfig.theme}
        activeWidgets={activeWidgets}
        widgetId="widget-gpu-default"
      />
    </section>
  );

  const renderDeadlinesSection = () => (
    <section className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className={`text-xs font-black uppercase tracking-wider ${appConfig.theme === "light" ? "text-slate-500" : "text-slate-400"}`}>
          Paper Deadlines
        </h2>
        <button
          onClick={() => handleRestorePosition("widget-deadlines-default", "Paper Deadlines")}
          className={`flex items-center gap-1.5 px-4 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all border ${
            appConfig.theme === "light"
              ? "bg-slate-100 hover:bg-slate-200 text-slate-700 border-slate-200 hover:border-slate-300"
              : "bg-white/5 hover:bg-white/10 text-slate-300 hover:text-white border-white/5"
          }`}
        >
          <RotateCcw size={12} /> Restore Position
        </button>
      </div>
      <div
        className={`p-6 border border-[var(--dashboard-border)] rounded-2xl space-y-6 ${
          appConfig.theme === "light" ? "bg-white" : "bg-white/5"
        }`}
      >
        <div className="grid grid-cols-2 gap-8">
          {/* Left Column: Target CCF Ranks */}
          <div className="space-y-3">
            <label className="text-[10px] font-black uppercase tracking-widest text-slate-500">
              Target CCF Ranks
            </label>
            <div className="flex flex-wrap gap-2">
              {[
                { value: "A", label: "CCF A" },
                { value: "B", label: "CCF B" },
                { value: "C", label: "CCF C" },
                { value: "N", label: "Non CCF" }
              ].map((r) => (
                <button
                  key={r.value}
                  onClick={() => {
                    const ranks = localPaper.filter_by_rank || [];
                    const next = ranks.includes(r.value) ? ranks.filter((i: string) => i !== r.value) : [...ranks, r.value];
                    const nextConfig = { ...localPaper, filter_by_rank: next };
                    setLocalPaper(nextConfig);
                    onSavePaper(nextConfig);
                  }}
                  className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all ${
                    localPaper.filter_by_rank?.includes(r.value)
                      ? "bg-blue-600 text-white shadow-lg shadow-blue-600/20"
                      : appConfig.theme === "light"
                      ? "bg-slate-100 text-slate-500 border border-slate-200"
                      : "bg-black/40 text-slate-500 border border-white/5 hover:border-white/20"
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>
          </div>

          {/* Right Column: Target CORE Ranks */}
          <div className="space-y-3">
            <label className="text-[10px] font-black uppercase tracking-widest text-slate-500">
              Target CORE Ranks
            </label>
            <div className="flex flex-wrap gap-2">
              {[
                { value: "A*", label: "CORE A*" },
                { value: "A", label: "CORE A" },
                { value: "B", label: "CORE B" },
                { value: "C", label: "CORE C" },
                { value: "N", label: "Non CORE" }
              ].map((r) => (
                <button
                  key={r.value}
                  onClick={() => {
                    const ranks = localPaper.filter_by_core || [];
                    const next = ranks.includes(r.value) ? ranks.filter((i: string) => i !== r.value) : [...ranks, r.value];
                    const nextConfig = { ...localPaper, filter_by_core: next };
                    setLocalPaper(nextConfig);
                    onSavePaper(nextConfig);
                  }}
                  className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all ${
                    localPaper.filter_by_core?.includes(r.value)
                      ? "bg-blue-600 text-white shadow-lg shadow-blue-600/20"
                      : appConfig.theme === "light"
                      ? "bg-slate-100 text-slate-500 border border-slate-200"
                      : "bg-black/40 text-slate-500 border border-white/5 hover:border-white/20"
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Bottom Column: Categories */}
        <div className="space-y-3 border-t border-[var(--dashboard-border)] pt-6">
          <label className="text-[10px] font-black uppercase tracking-widest text-slate-500">
            Categories
          </label>
          <div className="flex flex-wrap gap-2">
            {["AI", "CV", "NLP", "HCI", "DM", "Graphics", "Security", "Network", "Systems"].map((cat) => (
              <button
                key={cat}
                onClick={() => {
                  const subs = localPaper.filter_by_sub || [];
                  const next = subs.includes(cat) ? subs.filter((i: string) => i !== cat) : [...subs, cat];
                  const nextConfig = { ...localPaper, filter_by_sub: next };
                  setLocalPaper(nextConfig);
                  onSavePaper(nextConfig);
                }}
                className={`px-3 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-wider transition-all ${
                  localPaper.filter_by_sub?.includes(cat)
                    ? "bg-blue-600 text-white shadow-lg shadow-blue-600/20"
                    : appConfig.theme === "light"
                    ? "bg-slate-100 text-slate-500 border border-slate-200"
                    : "bg-black/40 text-slate-500 border border-white/5 hover:border-white/20"
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>
      </div>
      <ThemeManagementSection
        themeConfig={themeConfig}
        onSaveThemes={onSaveThemes}
        dashboardTheme={appConfig.theme}
        activeWidgets={activeWidgets}
        widgetId="widget-deadlines-default"
      />
    </section>
  );

  const renderArxivSection = () => (
    <section className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className={`text-xs font-black uppercase tracking-wider ${appConfig.theme === "light" ? "text-slate-500" : "text-slate-400"}`}>
          Arxiv Radar
        </h2>
        <div className="flex items-center gap-3">
          <button
            onClick={() => handleRestorePosition("widget-arxiv-default", "Arxiv Radar")}
            className={`flex items-center gap-1.5 px-4 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all border ${
              appConfig.theme === "light"
                ? "bg-slate-100 hover:bg-slate-200 text-slate-700 border-slate-200 hover:border-slate-300"
                : "bg-white/5 hover:bg-white/10 text-slate-300 hover:text-white border-white/5"
            }`}
          >
            <RotateCcw size={12} /> Restore Position
          </button>
        </div>
      </div>
      <div
        className={`p-6 border border-[var(--dashboard-border)] rounded-2xl space-y-6 ${
          appConfig.theme === "light" ? "bg-white" : "bg-white/5"
        }`}
      >
        <div className="grid grid-cols-2 gap-8">
          <div className="space-y-4">
            <div className="space-y-3">
              <label className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                Research Category
              </label>
              <div className="flex flex-wrap gap-2">
                {["cs", "stat", "math", "eess"].map((c) => (
                  <button
                    key={c}
                    onClick={() => {
                      const next = { ...localArxiv, category: c };
                      setLocalArxiv(next);
                      onSaveArxiv(next);
                    }}
                    className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all ${
                      localArxiv.category === c
                        ? "bg-pink-500 text-white shadow-lg shadow-pink-500/20"
                        : appConfig.theme === "light"
                        ? "bg-slate-100 text-slate-500 border border-slate-200"
                        : "bg-black/40 text-slate-500 border border-white/5 hover:border-white/20"
                    }`}
                  >
                    {c.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-3">
              <label className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                Keywords (Comma separated)
              </label>
              <input
                type="text"
                value={(localArxiv.keywords || []).join(", ")}
                onChange={(e) => {
                  const kws = e.target.value
                    .split(",")
                    .map((k) => k.trim())
                    .filter((k) => k);
                  const next = { ...localArxiv, keywords: kws };
                  setLocalArxiv(next);
                }}
                onBlur={() => onSaveArxiv(localArxiv)}
                onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                className={`w-full px-4 py-2.5 rounded-xl text-xs font-bold border transition-all ${
                  appConfig.theme === "light"
                    ? "bg-slate-50 border-slate-200 text-slate-900 focus:bg-white"
                    : "bg-black/40 border-white/10 text-white focus:bg-black/60"
                }`}
                placeholder="e.g. gaussian, vla, llm"
              />
            </div>
          </div>
          <div className="space-y-6">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                  Update Interval (Hours)
                </label>
                <span className="text-[10px] font-black text-pink-500 bg-pink-500/10 px-2 py-0.5 rounded-md">
                  {Math.round((localArxiv.update_interval || 43200) / 3600)}h
                </span>
              </div>
              <input
                type="range"
                min="3600"
                max="86400"
                step="3600"
                value={localArxiv.update_interval || 43200}
                onChange={(e) => {
                  const nextVal = parseInt(e.target.value);
                  const next = { ...localArxiv, update_interval: nextVal };
                  setLocalArxiv(next);
                  onSaveArxiv(next);
                }}
                className="w-full h-1.5 bg-pink-600/20 rounded-lg appearance-none cursor-pointer accent-pink-600"
              />
            </div>
            <div className="flex items-center justify-between p-4 rounded-2xl bg-white/5 border border-white/5">
              <div className="space-y-1">
                <div className={`text-xs font-bold ${appConfig.theme === "light" ? "text-slate-900" : "text-white"}`}>
                  Show Interaction Hints
                </div>
                <div className="text-[10px] text-slate-500">Display swipe instructions at the bottom of cards</div>
              </div>
              <MasterSwitch
                enabled={localArxiv.show_card_hints !== false}
                onToggle={(val) => {
                  const next = { ...localArxiv, show_card_hints: val };
                  setLocalArxiv(next);
                  onSaveArxiv(next);
                }}
              />
            </div>
          </div>
        </div>
      </div>
      <ThemeManagementSection
        themeConfig={themeConfig}
        onSaveThemes={onSaveThemes}
        dashboardTheme={appConfig.theme}
        activeWidgets={activeWidgets}
        widgetId="widget-arxiv-default"
      />
    </section>
  );

  const renderQuotaSection = () => (
    <section className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className={`text-xs font-black uppercase tracking-wider ${appConfig.theme === "light" ? "text-slate-500" : "text-slate-400"}`}>
          Quota Monitor
        </h2>
        <div className="flex items-center gap-3">
          <button
            onClick={() => handleRestorePosition("widget-quota-default", "Quota Monitor")}
            className={`flex items-center gap-1.5 px-4 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all border ${
              appConfig.theme === "light"
                ? "bg-slate-100 hover:bg-slate-200 text-slate-700 border-slate-200 hover:border-slate-300"
                : "bg-white/5 hover:bg-white/10 text-slate-300 hover:text-white border-white/5"
            }`}
          >
            <RotateCcw size={12} /> Restore Position
          </button>
        </div>
      </div>
      <div className="space-y-6">
        {/* Show Account Name Toggle */}
        <div className={`p-4 border border-[var(--dashboard-border)] rounded-2xl flex items-center justify-between ${
          appConfig.theme === "light" ? "bg-white" : "bg-white/5"
        }`}>
          <div className="space-y-1">
            <div className={`text-xs font-bold ${appConfig.theme === "light" ? "text-slate-900" : "text-white"}`}>
              Show Account Name
            </div>
            <div className="text-[10px] text-slate-500">
              Display email or account name in the widget
            </div>
          </div>
          <MasterSwitch
            enabled={localQuota?.show_account_name || false}
            onToggle={(val) => {
              const next = { ...localQuota, show_account_name: val };
              setLocalQuota(next);
              onSaveQuota(next);
            }}
          />
        </div>

        {/* Show Plan Type Toggle */}
        <div className={`p-4 border border-[var(--dashboard-border)] rounded-2xl flex items-center justify-between ${
          appConfig.theme === "light" ? "bg-white" : "bg-white/5"
        }`}>
          <div className="space-y-1">
            <div className={`text-xs font-bold ${appConfig.theme === "light" ? "text-slate-900" : "text-white"}`}>
              Show Plan Type
            </div>
            <div className="text-[10px] text-slate-500">
              Display plan or subscription tier in the widget
            </div>
          </div>
          <MasterSwitch
            enabled={localQuota?.show_plan_type !== false}
            onToggle={(val) => {
              const next = { ...localQuota, show_plan_type: val };
              setLocalQuota(next);
              onSaveQuota(next);
            }}
          />
        </div>

        {/* Quota Items List */}
        <Reorder.Group
          axis="y"
          values={localQuota?.items || []}
          onReorder={(newItems: any[]) => {
            const next = { ...localQuota, items: newItems };
            setLocalQuota(next);
            onSaveQuota(next);
          }}
          className="space-y-3"
        >
          {(localQuota?.items || []).map((q: any) => (
            <QuotaItemCard
              key={q.id}
              q={q}
              appConfig={appConfig}
              openProviderId={openProviderId}
              onToggleProvider={setOpenProviderId}
              onRemove={removeQuotaItem}
              onUpdateField={updateQuotaItem}
              onSave={onSaveQuota}
              localQuota={localQuota}
            />
          ))}
        </Reorder.Group>

        <div className="mt-3">
          <button
            onClick={addQuotaItem}
            className={`w-full py-4 border-2 border-dashed rounded-2xl flex items-center justify-center gap-2 font-bold uppercase tracking-widest text-xs transition-all ${
              appConfig.theme === "light"
                ? "border-slate-200 text-slate-500 hover:text-blue-600 hover:border-blue-400 hover:bg-blue-50/30"
                : "border-white/10 text-slate-500 hover:text-white hover:border-white/20 hover:bg-white/5"
            }`}
          >
            <Plus size={16} /> Add New Quota Monitor
          </button>
        </div>
      </div>
      <ThemeManagementSection
        themeConfig={themeConfig}
        onSaveThemes={onSaveThemes}
        dashboardTheme={appConfig.theme}
        activeWidgets={activeWidgets}
        widgetId="widget-quota-default"
      />
    </section>
  );

  const renderAboutSection = () => (
    <section className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className={`text-xs font-black uppercase tracking-wider ${appConfig.theme === "light" ? "text-slate-500" : "text-slate-400"}`}>
          About
        </h2>
      </div>
      <div
        className={`p-8 border border-[var(--dashboard-border)] rounded-3xl flex flex-col items-center text-center space-y-6 ${
          appConfig.theme === "light" ? "bg-white shadow-xl shadow-slate-200/50" : "bg-white/5 backdrop-blur-xl"
        }`}
      >
        <div className="w-20 h-20 rounded-3xl bg-blue-600 flex items-center justify-center shadow-2xl shadow-blue-600/40 transform -rotate-6 overflow-hidden border-2 border-white/20">
          <img src="/logo.png" alt="Widgitron" className="w-full h-full object-cover" />
        </div>
        <div className="space-y-2">
          <h3
            className={`text-xs font-black uppercase tracking-tighter ${
              appConfig.theme === "light" ? "text-slate-900" : "text-white"
            }`}
          >
            Widgitron
          </h3>
          <div className="flex items-center justify-center gap-2">
            <span className="px-3 py-1 rounded-full bg-blue-500/10 text-blue-500 text-[10px] font-black uppercase tracking-widest border border-blue-500/10">
              v0.2.2 Stable
            </span>
            <span className="px-3 py-1 rounded-full bg-purple-500/10 text-purple-500 text-[10px] font-black uppercase tracking-widest border border-purple-500/10">
              Research Edition
            </span>
          </div>
        </div>
        <p className="text-xs text-slate-500 max-w-md leading-relaxed font-medium">
          Widgitron is a modular desktop widget framework designed for researchers and developers. It is completely free and open-source, available at{" "}
          <a
            href="https://github.com/starkmomo/widgitron"
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-500 hover:text-blue-400 underline transition-colors"
            onClick={async (e) => {
              e.preventDefault();
              await invoke("open_link", { url: "https://github.com/starkmomo/widgitron" });
            }}
          >
            github.com/starkmomo/widgitron
          </a>.
        </p>
        <div className="pt-6 flex items-center gap-8 border-t border-white/5 w-full justify-center">
          <div className="flex flex-col items-center gap-1">
            <span className="text-[10px] text-slate-600 font-bold uppercase tracking-widest">Engine</span>
            <span className={`text-xs font-bold ${appConfig.theme === "light" ? "text-slate-900" : "text-white"}`}>
              Tauri v2 + React
            </span>
          </div>
          <div className="flex flex-col items-center gap-1">
            <span className="text-[10px] text-slate-600 font-bold uppercase tracking-widest">Developer</span>
            <span className={`text-xs font-bold ${appConfig.theme === "light" ? "text-slate-900" : "text-white"}`}>
              Stark (momo)
            </span>
          </div>
        </div>
      </div>
    </section>
  );

  return (
    <div className="flex flex-col md:flex-row gap-8 items-start">
      {/* Settings Sidebar */}
      <div className="w-full md:w-56 flex-shrink-0 flex flex-row md:flex-col gap-1 overflow-x-auto md:overflow-y-auto md:overflow-x-hidden pb-3 md:pb-4 border-b md:border-b-0 md:border-r border-[var(--dashboard-border)] pr-0 md:pr-6 custom-scrollbar md:sticky md:top-0 md:self-start md:max-h-[calc(100vh-3.5rem)] pt-1">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeSection === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveSection(tab.id)}
              className={`flex items-center gap-3 px-4 py-3.5 rounded-2xl text-xs font-black uppercase tracking-wider transition-all relative whitespace-nowrap text-left w-full ${
                isActive
                  ? appConfig.theme === "light"
                    ? "text-blue-600"
                    : "text-blue-400"
                  : appConfig.theme === "light"
                  ? "text-slate-500 hover:text-slate-900"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              {isActive && (
                <motion.div
                  layoutId="active-settings-tab"
                  className={`absolute inset-0 rounded-2xl border ${
                    appConfig.theme === "light"
                      ? "bg-blue-50 border-blue-200/50 shadow-sm"
                      : "bg-white/5 border-white/10 shadow-[inset_0_1px_1px_rgba(255,255,255,0.05)]"
                  }`}
                  transition={{ type: "spring", stiffness: 380, damping: 30 }}
                />
              )}
              <Icon size={16} className="relative z-10 flex-shrink-0" />
              <span className="relative z-10 truncate">{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Settings Content */}
      <div className="flex-1 min-w-0">
        <AnimatePresence mode="wait">
          <motion.div
            key={activeSection}
            initial={{ opacity: 0, x: 10 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -10 }}
            transition={{ duration: 0.15 }}
            className="space-y-8"
          >
            {activeSection === "general" && renderGeneralSection()}
            {activeSection === "quota" && renderQuotaSection()}
            {activeSection === "gpu" && renderGpuSection()}
            {activeSection === "deadlines" && renderDeadlinesSection()}
            {activeSection === "arxiv" && renderArxivSection()}
            {activeSection === "about" && renderAboutSection()}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
