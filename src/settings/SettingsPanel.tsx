import { useState, useEffect, useRef } from "react";
import { Sun, Moon, X, Plus, RotateCcw, RefreshCw, Settings, Cpu, Calendar, BookOpen, Coins, Info, GripVertical, ChevronDown } from "lucide-react";
import { motion, AnimatePresence, Reorder, useDragControls } from "framer-motion";
import { WidgetThemeConfig } from "../types/theme";
import type {
  AppConfig,
  ArxivConfig,
  ArxivPaper,
  GpuConfig,
  PaperConfig,
  PaperDeadlineInfo,
  QuotaConfig,
  QuotaItemConfig,
  ServerConfig,
  ServerGpuData,
} from "../types/config";
import type { UpdateInfo } from "../types/tauri";
import { tauriInvoke } from "../utils/tauriInvoke";
import { tauriListen } from "../utils/tauriListen";
import { MasterSwitch } from "../components/MasterSwitch";
import { ThemeManagementSection } from "./ThemeManagementSection";
import { listenBackendServiceError } from "../utils/backendServiceError";
import { listenServiceUpdateEvents } from "../utils/serviceUpdateEvents";
import { listenGpuDataSync } from "../utils/gpuDataSync";
import {
  isLiveDataSection,
  LIVE_DATA_SECTION,
  refetchSectionLiveDataForSection,
  LIVE_DATA_SECTION_LABELS,
  SETTINGS_SECTION_LABELS,
  type SettingsSection,
} from "../utils/sectionLiveData";
import { CACHED_LABELS, cachedLabelWhen, gpuRefreshCachedLabel } from "../utils/cachedLabels";
import { ServiceErrorBanners } from "../components/ServiceErrorBanners";
import {
  clearLiveDataSectionErrors,
  createSectionRefreshHandler,
  serviceWidgetMeta,
  type ServiceField,
} from "../utils/widgetLifecycle";

const PROVIDER_LOGOS: Record<string, string> = {
  antigravity: "/icons/antigravity.svg",
  codex: "/icons/codex.svg",
  cursor: "/icons/cursor.svg",
  copilot: "/icons/vscode.svg",
  "qoder-cn": "/icons/qoder-cn.svg",
  pioneer: "/icons/pioneer.svg",
  "claude-code": "/icons/claude-code.svg",
};

const PROVIDER_OPTIONS = [
  { value: "antigravity", label: "Antigravity" },
  { value: "codex", label: "Codex" },
  { value: "cursor", label: "Cursor" },
  { value: "copilot", label: "VS Code Copilot" },
  { value: "qoder-cn", label: "Qoder CN" },
  { value: "pioneer", label: "Pioneer AI" },
  { value: "claude-code", label: "Claude Code" },
];

const REMOVED_QUOTA_PROVIDERS = new Set(["minimax-cn", "openai-compatible"]);

type AuthMode = "local" | "api_key";

const PROVIDER_AUTH: Record<
  string,
  { local: boolean; apiKey: boolean; defaultMode: AuthMode }
> = {
  antigravity: { local: true, apiKey: false, defaultMode: "local" },
  codex: { local: true, apiKey: false, defaultMode: "local" },
  cursor: { local: true, apiKey: false, defaultMode: "local" },
  copilot: { local: true, apiKey: false, defaultMode: "local" },
  "qoder-cn": { local: true, apiKey: true, defaultMode: "local" },
  pioneer: { local: false, apiKey: true, defaultMode: "api_key" },
  "claude-code": { local: true, apiKey: true, defaultMode: "local" },
};

function getEffectiveAuthMode(q: { provider: string; auth_mode?: string | null }): AuthMode {
  if (q.auth_mode === "local" || q.auth_mode === "api_key") return q.auth_mode;
  return PROVIDER_AUTH[q.provider]?.defaultMode ?? "local";
}

function apiKeyPlaceholder(provider: string): string {
  if (provider === "claude-code") return "sk-cp-... token";
  if (provider === "qoder-cn") return "pt-... PAT (optional if signed in to Qoder CN IDE)";
  if (provider === "pioneer") return "pio-... from pioneer.ai Settings";
  return "Your API key";
}

function stripUnsupportedQuotaProviders(config: QuotaConfig): QuotaConfig {
  return {
    ...config,
    items: (config?.items || []).filter(
      (item) => !REMOVED_QUOTA_PROVIDERS.has(item.provider)
    ),
  };
}

function AuthModeSwitch({
  mode,
  localEnabled,
  apiKeyEnabled,
  onChange,
  appConfig,
}: {
  mode: AuthMode;
  localEnabled: boolean;
  apiKeyEnabled: boolean;
  onChange: (mode: AuthMode) => void;
  appConfig: AppConfig;
}) {
  const baseBtn = "px-2.5 py-1.5 text-[10px] font-black uppercase tracking-wider transition-all rounded-lg";
  const activeLight = "bg-blue-600 text-white shadow-sm";
  const activeDark = "bg-blue-500 text-white shadow-sm";
  const idleLight = "text-slate-500 hover:text-slate-800 hover:bg-slate-100";
  const idleDark = "text-slate-400 hover:text-white hover:bg-white/10";
  const disabledCls = "opacity-35 cursor-not-allowed";

  return (
    <div
      className={`flex items-center gap-0.5 p-0.5 rounded-xl border flex-shrink-0 ${
        appConfig.theme === "light" ? "bg-slate-100 border-slate-200" : "bg-black/30 border-white/10"
      }`}
    >
      <button
        type="button"
        disabled={!localEnabled}
        onClick={() => localEnabled && onChange("local")}
        className={`${baseBtn} ${
          mode === "local"
            ? appConfig.theme === "light" ? activeLight : activeDark
            : appConfig.theme === "light" ? idleLight : idleDark
        } ${!localEnabled ? disabledCls : "cursor-pointer"}`}
      >
        Local
      </button>
      <button
        type="button"
        disabled={!apiKeyEnabled}
        onClick={() => apiKeyEnabled && onChange("api_key")}
        className={`${baseBtn} ${
          mode === "api_key"
            ? appConfig.theme === "light" ? activeLight : activeDark
            : appConfig.theme === "light" ? idleLight : idleDark
        } ${!apiKeyEnabled ? disabledCls : "cursor-pointer"}`}
      >
        API Key
      </button>
    </div>
  );
}

function QuotaItemCard({
  q, appConfig, openProviderId,
  onToggleProvider, onRemove, onUpdateField, onSave, localQuota,
}: {
  q: QuotaItemConfig;
  appConfig: AppConfig;
  openProviderId: string | null;
  onToggleProvider: (id: string | null) => void;
  onRemove: (id: string) => void;
  onUpdateField: <K extends keyof QuotaItemConfig>(
    id: string,
    field: K,
    val: QuotaItemConfig[K],
    save?: boolean
  ) => void;
  onSave: (config: QuotaConfig) => void;
  localQuota: QuotaConfig;
}) {
  const controls = useDragControls();
  const isOpen = openProviderId === q.id;
  const selectedProvider = PROVIDER_OPTIONS.find(p => p.value === q.provider) || PROVIDER_OPTIONS[0];
  const authCaps = PROVIDER_AUTH[q.provider] ?? { local: true, apiKey: true, defaultMode: "local" as AuthMode };
  const authMode = getEffectiveAuthMode(q);
  const isCustomProvider = !PROVIDER_AUTH[q.provider];

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
                  onClick={() => {
                    onUpdateField(q.id, "provider", opt.value, true);
                    onToggleProvider(null);
                  }}
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
        <AuthModeSwitch
          mode={authMode}
          localEnabled={authCaps.local}
          apiKeyEnabled={authCaps.apiKey}
          onChange={(mode) => onUpdateField(q.id, "auth_mode", mode, true)}
          appConfig={appConfig}
        />
      </div>
      {authMode === "api_key" && authCaps.apiKey && (
        <div className="px-4 pb-4">
          <div className="space-y-1.5">
            <label className="text-[10px] font-black uppercase tracking-widest text-slate-500">API Key</label>
            <input
              type="password"
              value={q.api_key || ""}
              onChange={(e) => onUpdateField(q.id, "api_key", e.target.value)}
              onBlur={() => onSave(localQuota)}
              onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
              className={`w-full px-4 py-2 rounded-xl text-xs font-bold border transition-all ${
                appConfig.theme === "light"
                  ? "bg-slate-50 border-slate-200 text-slate-900 focus:bg-white"
                  : "bg-black/40 border-white/10 text-white focus:bg-black/60"
              }`}
              placeholder={apiKeyPlaceholder(q.provider)}
            />
          </div>
        </div>
      )}
      {/*
        <div className="px-4 pb-4">
          <div
            className={`rounded-xl border px-3 py-2.5 text-[10px] leading-relaxed ${
              agReady
                ? appConfig.theme === "light"
                  ? "bg-emerald-50 border-emerald-200 text-emerald-800"
                  : "bg-emerald-500/5 border-emerald-500/15 text-emerald-300/90"
                : appConfig.theme === "light"
                ? "bg-amber-50 border-amber-200 text-amber-800"
                : "bg-amber-500/5 border-amber-500/15 text-amber-300/90"
            }`}
          >
            {agStatus ? (
              <ul className="space-y-1">
                <li>
                  IDE language server:{" "}
                  <span className="font-bold">
                    {agStatus.language_server_running ? "Running" : "Not detected"}
                  </span>
                </li>
                <li>
                  OAuth tokens:{" "}
                  <span className="font-bold">
                    {agStatus.has_oauth_tokens ? "Found" : "Missing — sign in via Antigravity IDE"}
                  </span>
                </li>
                <li>
                  Cloud fallback:{" "}
                  <span className="font-bold">
                    {agStatus.cloud_auth_ready
                      ? "Ready"
                      : "Needs client_secret in antigravity_oauth.json or env"}
                  </span>
                </li>
                <li className="pt-1 text-[9px] opacity-80 break-all">
                  OAuth config: <code className="font-mono">{agStatus.oauth_config_path}</code>
                </li>
                {agStatus.program_files_install && (
                  <li className="pt-1 text-[9px] opacity-90">
                    Installed under Program Files — configs are stored in AppData, not next to the .exe.
                    Config folder: <code className="font-mono break-all">{agStatus.config_dir}</code>
                  </li>
                )}
                {!agReady && agStatus.has_oauth_tokens && !agStatus.language_server_running && (
                  <li className="pt-2 font-bold">
                    {agStatus.cloud_auth_ready
                      ? "Launch Antigravity IDE to refresh quota via local mode."
                      : "Launch Antigravity IDE (recommended), or add client_secret to antigravity_oauth.json for cloud fallback."}
                  </li>
                )}
              </ul>
            ) : (
              <>
                Local mode reads the running Antigravity IDE. Cloud fallback needs OAuth{" "}
                <code className="font-mono text-[9px]">client_secret</code> in{" "}
                <code className="font-mono text-[9px]">configs/antigravity_oauth.json</code>.
              </>
            )}
          </div>
        </div>
      */}
      {isCustomProvider && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 px-4 pb-4">
          <div className="space-y-1.5 md:col-span-2">
            <label className="text-[10px] font-black uppercase tracking-widest text-slate-500">API URL</label>
            <input type="text" value={q.api_url || ""} onChange={(e) => onUpdateField(q.id, "api_url", e.target.value)} onBlur={() => onSave(localQuota)}
              onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
              className={`w-full px-4 py-2 rounded-xl text-xs font-bold border transition-all ${appConfig.theme === "light" ? "bg-slate-50 border-slate-200 text-slate-900 focus:bg-white" : "bg-black/40 border-white/10 text-white focus:bg-black/60"}`}
              placeholder="https://..." />
          </div>
          <div className="space-y-1.5">
            <label className="text-[10px] font-black uppercase tracking-widest text-slate-500">Max Quota</label>
            <input type="number" value={q.max_quota || 0} onChange={(e) => onUpdateField(q.id, "max_quota", parseFloat(e.target.value) || 0)} onBlur={() => onSave(localQuota)}
              onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
              className={`w-full px-4 py-2 rounded-xl text-xs font-bold border transition-all ${appConfig.theme === "light" ? "bg-slate-50 border-slate-200 text-slate-900 focus:bg-white" : "bg-black/40 border-white/10 text-white focus:bg-black/60"}`}
              placeholder="100" />
          </div>
          <div className="space-y-1.5 md:col-span-3">
            <label className="text-[10px] font-black uppercase tracking-widest text-slate-500">JSON Path</label>
            <input type="text" value={q.json_path || ""} onChange={(e) => onUpdateField(q.id, "json_path", e.target.value)} onBlur={() => onSave(localQuota)}
              onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
              className={`w-full px-4 py-2 rounded-xl text-xs font-bold border transition-all ${appConfig.theme === "light" ? "bg-slate-50 border-slate-200 text-slate-900 focus:bg-white" : "bg-black/40 border-white/10 text-white focus:bg-black/60"}`}
              placeholder="data.remaining" />
          </div>
        </div>
      )}
      {/*
        <div className="px-4 pb-4">
          {liveError ? (
            <div
              className={`rounded-xl border px-3 py-2 text-[10px] leading-relaxed ${
                liveStale
                  ? appConfig.theme === "light"
                    ? "bg-amber-50 border-amber-200 text-amber-900"
                    : "bg-amber-500/10 border-amber-500/20 text-amber-300/90"
                  : appConfig.theme === "light"
                  ? "bg-red-50 border-red-200 text-red-800"
                  : "bg-red-500/10 border-red-500/20 text-red-300/90"
              }`}
            >
              {liveError}
            </div>
          ) : (
            <div className="text-[9px] text-slate-500 font-medium">
              Last update: {liveItem?.last_update || "—"}
              {liveItem?.current_value != null && (
                <span className="ml-2 opacity-80">
                  · {liveItem.current_value}
                  {liveItem.unit ? ` ${liveItem.unit}` : ""}
                </span>
              )}
            </div>
          )}
        </div>
      */}
    </Reorder.Item>
  );
}

const sanitizeGpuConfig = (config: GpuConfig): GpuConfig => {
  const servers = (config.servers || []).map((s: ServerConfig, idx: number) => ({
    ...s,
    id: s.id || `server-${idx}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
  }));
  return { ...config, servers };
};

function GpuServerCard({
  s, idx, appConfig, removeServer, updateServer, localGpu, onSaveGpu
}: {
  s: ServerConfig;
  idx: number;
  appConfig: AppConfig;
  removeServer: (idx: number) => void;
  updateServer: (idx: number, field: keyof ServerConfig, val: ServerConfig[keyof ServerConfig], shouldSave?: boolean) => void;
  localGpu: GpuConfig;
  onSaveGpu: (config: GpuConfig) => void;
}) {
  const controls = useDragControls();
  return (
    <Reorder.Item
      value={s}
      dragListener={false}
      dragControls={controls}
      whileDrag={{ scale: 1.02, opacity: 0.8, zIndex: 99 }}
      className={`p-6 border border-[var(--dashboard-border)] rounded-2xl relative group ${
        appConfig.theme === "light" ? "bg-white" : "bg-white/5"
      }`}
    >
      <button
        onClick={() => removeServer(idx)}
        className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-red-500 text-white opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center shadow-lg z-10"
      >
        <X size={12} />
      </button>
      
      <div className="flex items-center gap-3 mb-4">
        <div
          onPointerDown={(e) => { controls.start(e); }}
          className={`flex-shrink-0 p-1.5 rounded-lg cursor-grab active:cursor-grabbing select-none touch-none ${
            appConfig.theme === "light" ? "text-slate-300 hover:text-slate-500 hover:bg-slate-100" : "text-slate-600 hover:text-slate-400 hover:bg-white/5"
          }`}
        >
          <GripVertical size={16} />
        </div>
        <div className={`text-xs font-bold ${appConfig.theme === "light" ? "text-slate-700" : "text-slate-300"}`}>
          Server #{idx + 1} {s.host ? `(${s.host})` : ""}
        </div>
      </div>

      <div className="grid grid-cols-4 gap-4">
        <div className="space-y-1.5">
          <label className="text-[10px] font-black uppercase tracking-widest text-slate-500">Host / IP</label>
          <input
            type="text"
            value={s.host || ""}
            onChange={(e) => updateServer(idx, "host", e.target.value)}
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
            onChange={(e) => updateServer(idx, "user", e.target.value)}
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
            onChange={(e) => updateServer(idx, "password", e.target.value)}
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
            onChange={(e) => updateServer(idx, "port", parseInt(e.target.value))}
            onBlur={() => onSaveGpu(localGpu)}
            onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
            className={`w-full px-4 py-2 rounded-xl text-xs font-bold border transition-all ${
              appConfig.theme === "light"
                ? "bg-slate-50 border-slate-200 text-slate-900 focus:bg-white"
                : "bg-black/40 border-white/10 text-white focus:bg-black/60"
            }`}
          />
        </div>
        <div className="col-span-4 flex flex-wrap items-center gap-4 pt-2">
          <button
            onClick={() => updateServer(idx, "use_ssh_config", !s.use_ssh_config, true)}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${
              s.use_ssh_config
                ? "bg-blue-500/20 text-blue-400 border border-blue-500/20 shadow-lg shadow-blue-500/10"
                : "bg-black/40 text-slate-500 border border-white/5 hover:border-white/20"
            }`}
          >
            <div className={`w-2 h-2 rounded-full ${s.use_ssh_config ? "bg-blue-400 animate-pulse" : "bg-slate-600"}`} />
            Use ~/.ssh/config
          </button>
          {s.use_ssh_config && (
            <span className="text-[9px] text-blue-500/60 font-medium italic">
              Host can be an SSH config alias; OpenSSH resolved HostName, User, Port and IdentityFile are applied.
            </span>
          )}
          <button
            onClick={() => updateServer(idx, "use_slurm", !s.use_slurm, true)}
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
    </Reorder.Item>
  );
}

interface SettingsPanelProps {
  gpuConfig: GpuConfig;
  paperConfig: PaperConfig;
  arxivConfig: ArxivConfig;
  appConfig: AppConfig;
  quotaConfig: QuotaConfig;
  themeConfig: WidgetThemeConfig;
  onSaveGpu: (config: GpuConfig) => void;
  onSavePaper: (config: PaperConfig) => void;
  onSaveArxiv: (config: ArxivConfig) => void;
  onSaveQuota: (config: QuotaConfig) => void;
  onSaveApp: (config: AppConfig) => void;
  onSaveThemes: (config: WidgetThemeConfig) => void;
  isAutostart: boolean;
  onToggleAutostart: () => void;
  activeWidgets: string[];
  updateInfo: UpdateInfo | null;
  setUpdateInfo: (info: UpdateInfo | null) => void;
  updateCheckError?: string | null;
  setUpdateCheckError?: (err: string | null) => void;
}

const formatArxivKeywordsInput = (keywords?: string[]) => (keywords || []).join(", ");

const parseArxivKeywordsInput = (value: string) =>
  value
    .split(",")
    .map((keyword) => keyword.trim())
    .filter(Boolean);

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
  activeWidgets,
  updateInfo,
  setUpdateInfo,
  updateCheckError,
  setUpdateCheckError,
}: SettingsPanelProps) {
  const [localGpu, setLocalGpu] = useState<GpuConfig>(() => sanitizeGpuConfig(gpuConfig));
  const [localPaper, setLocalPaper] = useState<PaperConfig>(paperConfig);
  const [localArxiv, setLocalArxiv] = useState<ArxivConfig>(arxivConfig);
  const [arxivProxyInput, setArxivProxyInput] = useState(appConfig.arxiv_proxy || "");
  const [arxivKeywordsInput, setArxivKeywordsInput] = useState(() =>
    formatArxivKeywordsInput(arxivConfig.keywords)
  );
  const [localQuota, setLocalQuota] = useState<QuotaConfig>(() =>
    stripUnsupportedQuotaProviders(quotaConfig)
  );
  const [activeSection, setActiveSection] = useState<SettingsSection>("general");
  const [openProviderId, setOpenProviderId] = useState<string | null>(null);
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [downloadState, setDownloadState] = useState<"idle" | "downloading" | "completed" | "error">("idle");
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [configDirPath, setConfigDirPath] = useState("");
  const [liveDeadlines, setLiveDeadlines] = useState<PaperDeadlineInfo[]>([]);
  const [liveArxivPapers, setLiveArxivPapers] = useState<ArxivPaper[]>([]);
  const [liveGpuData, setLiveGpuData] = useState<ServerGpuData[]>([]);
  const [isRefreshingGpu, setIsRefreshingGpu] = useState(false);
  const [isRefreshingDeadlines, setIsRefreshingDeadlines] = useState(false);
  const [isRefreshingArxiv, setIsRefreshingArxiv] = useState(false);
  const [gpuRefreshError, setGpuRefreshError] = useState<string | null>(null);
  const [deadlinesRefreshError, setDeadlinesRefreshError] = useState<string | null>(null);
  const [paperBackendError, setPaperBackendError] = useState<string | null>(null);
  const [arxivRefreshError, setArxivRefreshError] = useState<string | null>(null);
  const [arxivBackendError, setArxivBackendError] = useState<string | null>(null);
  const prevActiveSectionRef = useRef(activeSection);
  const [corruptConfigFiles, setCorruptConfigFiles] = useState<string[]>([]);

  useEffect(() => {
    const prevSection = prevActiveSectionRef.current;
    if (prevSection !== activeSection) {
      if (isLiveDataSection(prevSection)) {
        clearLiveDataSectionErrors(prevSection, {
          gpu: { clearRefresh: () => setGpuRefreshError(null) },
          deadlines: {
            clearRefresh: () => setDeadlinesRefreshError(null),
            clearBackend: () => setPaperBackendError(null),
          },
          arxiv: {
            clearRefresh: () => setArxivRefreshError(null),
            clearBackend: () => setArxivBackendError(null),
          },
        });
      }
      prevActiveSectionRef.current = activeSection;

      if (isLiveDataSection(activeSection)) {
        const setters = {
          [LIVE_DATA_SECTION.GPU]: setLiveGpuData,
          [LIVE_DATA_SECTION.DEADLINES]: setLiveDeadlines,
          [LIVE_DATA_SECTION.ARXIV]: setLiveArxivPapers,
        };
        refetchSectionLiveDataForSection(activeSection, setters);
      }
    }
  }, [activeSection]);

  useEffect(() => {
    let active = true;
    const unsubs: (() => void)[] = [];

    if (isLiveDataSection(activeSection)) {
      const setters = {
        [LIVE_DATA_SECTION.GPU]: (data: ServerGpuData[]) => {
          if (active) setLiveGpuData(data);
        },
        [LIVE_DATA_SECTION.DEADLINES]: (data: PaperDeadlineInfo[]) => {
          if (active) setLiveDeadlines(data);
        },
        [LIVE_DATA_SECTION.ARXIV]: (data: ArxivPaper[]) => {
          if (active) setLiveArxivPapers(data);
        },
      };
      refetchSectionLiveDataForSection(activeSection, setters);
    }

    const setup = async () => {
      const u1 = await listenServiceUpdateEvents(
        () => active,
        {
          gpu: { clearRefresh: () => setGpuRefreshError(null) },
          paper: {
            clearRefresh: () => setDeadlinesRefreshError(null),
            clearBackend: () => setPaperBackendError(null),
          },
          arxiv: {
            clearRefresh: () => setArxivRefreshError(null),
            clearBackend: () => setArxivBackendError(null),
          },
        },
        {
          gpuSetter: setLiveGpuData,
          paperSetter: setLiveDeadlines,
          arxivSetter: setLiveArxivPapers,
        }
      );
      unsubs.push(u1);

      const u1e = await listenBackendServiceError(
        "paper_error",
        setPaperBackendError,
        () => active
      );
      unsubs.push(u1e);

      const u1f = await listenBackendServiceError(
        "arxiv_error",
        setArxivBackendError,
        () => active
      );
      unsubs.push(u1f);

      const u3 = await listenGpuDataSync(setLiveGpuData, () => active);
      unsubs.push(u3);
    };
    setup();

    return () => {
      active = false;
      unsubs.forEach((f) => f());
    };
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    const setup = async () => {
      unlisten = await tauriListen("ota_download_progress", (event) => {
        const { state, progress, error } = event.payload;
        setDownloadState(state);
        setDownloadProgress(progress);
        if (state === "error" && error) {
          setUpdateError(error);
        }
      });
    };
    setup();
    return () => {
      if (unlisten) unlisten();
    };
  }, []);

  useEffect(() => {
    tauriInvoke("get_config_dir_path")
      .then((path) => setConfigDirPath(path))
      .catch(console.error);
    tauriInvoke("get_corrupt_config_files")
      .then((files) => setCorruptConfigFiles(files))
      .catch(console.error);
  }, []);

  const handleCheckUpdate = async () => {
    setIsCheckingUpdate(true);
    setUpdateError(null);
    setUpdateCheckError?.(null);
    try {
      const res = await tauriInvoke("check_for_updates");
      setUpdateInfo(res);
    } catch (err) {
      console.error(err);
      const message = String(err);
      setUpdateError(message);
      setUpdateCheckError?.(message);
    } finally {
      setIsCheckingUpdate(false);
    }
  };

  const handleStartUpdate = async () => {
    if (!updateInfo?.download_url || !updateInfo?.asset_name) {
      setUpdateError("No download link found for Windows installer.");
      return;
    }
    setUpdateError(null);
    setDownloadProgress(0);
    setDownloadState("downloading");
    try {
      await tauriInvoke("download_and_install_update", {
        downloadUrl: updateInfo.download_url,
        assetName: updateInfo.asset_name,
      });
    } catch (err) {
      console.error(err);
      setUpdateError(String(err));
      setDownloadState("error");
    }
  };

  const tabs: { id: SettingsSection; label: string; icon: typeof Settings }[] = [
    { id: "general", label: SETTINGS_SECTION_LABELS.general, icon: Settings },
    { id: LIVE_DATA_SECTION.QUOTA, label: LIVE_DATA_SECTION_LABELS.quota, icon: Coins },
    { id: LIVE_DATA_SECTION.GPU, label: LIVE_DATA_SECTION_LABELS.gpu, icon: Cpu },
    { id: LIVE_DATA_SECTION.DEADLINES, label: LIVE_DATA_SECTION_LABELS.deadlines, icon: Calendar },
    { id: LIVE_DATA_SECTION.ARXIV, label: LIVE_DATA_SECTION_LABELS.arxiv, icon: BookOpen },
    { id: "about", label: SETTINGS_SECTION_LABELS.about, icon: Info },
  ];

  useEffect(() => {
    setArxivProxyInput(appConfig.arxiv_proxy || "");
  }, [appConfig.arxiv_proxy]);
  useEffect(() => {
    setLocalGpu(sanitizeGpuConfig(gpuConfig));
  }, [gpuConfig]);

  useEffect(() => {
    setLocalPaper(paperConfig);
  }, [paperConfig]);

  useEffect(() => {
    setLocalArxiv(arxivConfig);
    setArxivKeywordsInput(formatArxivKeywordsInput(arxivConfig.keywords));
  }, [arxivConfig]);

  // Only sync quotaConfig once on first real load to prevent race conditions
  // where async save triggers prop change that resets localQuota to stale data
  const initialQuotaRef = useRef(quotaConfig);
  const quotaInitialized = useRef(false);
  useEffect(() => {
    if (quotaConfig !== initialQuotaRef.current) {
      if (!quotaInitialized.current) {
        const sanitized = stripUnsupportedQuotaProviders(quotaConfig);
        const normalized: QuotaConfig = {
          ...sanitized,
          items: (sanitized?.items || []).map((item) => ({
            ...item,
            auth_mode:
              item.auth_mode ??
              PROVIDER_AUTH[item.provider]?.defaultMode ??
              "local",
          })),
        };
        setLocalQuota(normalized);
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
    const next = {
      ...localGpu,
      servers: [
        ...servers,
        {
          id: `server-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          host: "",
          user: "",
          password: "",
          use_ssh_config: false
        }
      ]
    };
    setLocalGpu(next);
    onSaveGpu(next);
  };

  const removeServer = (idx: number) => {
    const servers = localGpu?.servers || [];
    const next = { ...localGpu, servers: servers.filter((_, i) => i !== idx) };
    setLocalGpu(next);
    onSaveGpu(next);
  };

  const updateServer = (
    idx: number,
    field: keyof ServerConfig,
    val: ServerConfig[keyof ServerConfig],
    shouldSave = false
  ) => {
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
    const provider = "antigravity";
    const label = PROVIDER_OPTIONS.find((p) => p.value === provider)?.label ?? "Antigravity";
    const newItem: QuotaItemConfig = {
      id: "quota-" + Date.now(),
      name: label,
      provider,
      auth_mode: PROVIDER_AUTH[provider]?.defaultMode ?? "local",
      api_key: "",
      api_url: "",
      json_path: "",
      max_quota: 100,
      unit: "%",
    };
    const next = { ...localQuota, items: [...items, newItem] };
    setLocalQuota(next);
    onSaveQuota(next);
  };

  const removeQuotaItem = (id: string) => {
    const items = localQuota?.items || [];
    const next = { ...localQuota, items: items.filter((item) => item.id !== id) };
    setLocalQuota(next);
    onSaveQuota(next);
  };

  const updateQuotaItem = <K extends keyof QuotaItemConfig>(
    id: string,
    field: K,
    val: QuotaItemConfig[K],
    shouldSave = false
  ) => {
    const next = { ...localQuota };
    const items = [...(next.items || [])];
    const idx = items.findIndex((i) => i.id === id);
    if (idx === -1) return;

    let updatedItem = { ...items[idx], [field]: val } as QuotaItemConfig;
    if (field === "provider" && typeof val === "string") {
      const found = PROVIDER_OPTIONS.find((p) => p.value === val);
      if (found) {
        updatedItem = {
          ...updatedItem,
          name: found.label,
          auth_mode: PROVIDER_AUTH[val]?.defaultMode ?? "local",
          api_key: "",
          api_url: "",
          json_path: "",
          max_quota: updatedItem.max_quota || 100,
          unit: updatedItem.unit || "%",
        };
      }
    }

    items[idx] = updatedItem;
    next.items = items;
    setLocalQuota(next);
    if (shouldSave) {
      onSaveQuota(next);
    }
  };

  const handleRestorePosition = async (field: ServiceField) => {
    const { id, title } = serviceWidgetMeta(field);
    try {
      await tauriInvoke("restore_widget_position", { id, title });
    } catch (e) {
      console.error(`Failed to restore position for ${title}:`, e);
    }
  };

  const sectionRefreshBtnClass = (disabled?: boolean) =>
    `flex items-center gap-1.5 px-4 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all border ${
      appConfig.theme === "light"
        ? "bg-slate-100 hover:bg-slate-200 text-slate-700 border-slate-200 hover:border-slate-300 disabled:opacity-50"
        : "bg-white/5 hover:bg-white/10 text-slate-300 hover:text-white border-white/5 disabled:opacity-50"
    } ${disabled ? "opacity-50 cursor-not-allowed" : ""}`;

  const handleRefreshGpuSettings = createSectionRefreshHandler({
    isRefreshing: isRefreshingGpu,
    setIsRefreshing: setIsRefreshingGpu,
    clearError: () => setGpuRefreshError(null),
    setError: setGpuRefreshError,
    section: LIVE_DATA_SECTION.GPU,
    logLabel: "GPU refresh failed",
  });

  const handleRefreshDeadlinesSettings = createSectionRefreshHandler({
    isRefreshing: isRefreshingDeadlines,
    setIsRefreshing: setIsRefreshingDeadlines,
    clearError: () => setDeadlinesRefreshError(null),
    setError: setDeadlinesRefreshError,
    section: LIVE_DATA_SECTION.DEADLINES,
    onSuccess: (data) => setLiveDeadlines(data),
    logLabel: "Paper deadlines refresh failed",
  });

  const handleRefreshArxivSettings = createSectionRefreshHandler({
    isRefreshing: isRefreshingArxiv,
    setIsRefreshing: setIsRefreshingArxiv,
    clearError: () => setArxivRefreshError(null),
    setError: setArxivRefreshError,
    section: LIVE_DATA_SECTION.ARXIV,
    onSuccess: (data) => setLiveArxivPapers(data),
    logLabel: "Arxiv refresh failed",
  });

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

        <div className="border-t border-[var(--dashboard-border)] pt-6 grid grid-cols-1 md:grid-cols-[1fr_320px] gap-4 items-center">
          <div className="space-y-1">
            <div className={`text-xs font-bold ${appConfig.theme === "light" ? "text-slate-900" : "text-white"}`}>
              Arxiv Proxy
            </div>
            <p className="text-[10px] text-slate-400">
              Optional proxy URL used only when fetching arxiv papers. Leave blank to connect directly.
            </p>
          </div>
          <input
            type="text"
            value={arxivProxyInput}
            onChange={(e) => setArxivProxyInput(e.target.value)}
            onBlur={(e) => onSaveApp({ ...appConfig, arxiv_proxy: e.target.value.trim() })}
            onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
            className={`w-full px-4 py-2 rounded-xl text-xs font-bold border transition-all ${
              appConfig.theme === "light"
                ? "bg-white border-slate-200 text-slate-900 focus:bg-white"
                : "bg-black/40 border-white/10 text-white focus:bg-black/60"
            }`}
            placeholder="http://127.0.0.1:7890"
          />
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
                await tauriInvoke("open_log_dir");
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

  const renderGpuSection = () => {
    const hasCachedGpuData = liveGpuData.some(
      (s) => Array.isArray(s.gpu_list) && s.gpu_list.length > 0
    );

    return (
    <section className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className={`text-xs font-black uppercase tracking-wider ${appConfig.theme === "light" ? "text-slate-500" : "text-slate-400"}`}>
          {LIVE_DATA_SECTION_LABELS.gpu}
        </h2>
        <div className="flex items-center gap-3">
          <button
            onClick={handleRefreshGpuSettings}
            disabled={isRefreshingGpu}
            className={sectionRefreshBtnClass(isRefreshingGpu)}
            title="Refresh all GPU servers"
          >
            <RefreshCw size={12} className={isRefreshingGpu ? "animate-spin" : ""} />
            Refresh All
          </button>
          <button
            onClick={() => handleRestorePosition("gpu_enabled")}
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
      <ServiceErrorBanners
        refreshOnly
        refreshError={gpuRefreshError}
        onDismissRefresh={() => setGpuRefreshError(null)}
        theme={appConfig.theme}
        refreshCachedLabel={gpuRefreshCachedLabel(hasCachedGpuData)}
      />
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

        <Reorder.Group
          axis="y"
          values={localGpu?.servers || []}
          onReorder={(newServers: ServerConfig[]) => {
            const next = { ...localGpu, servers: newServers };
            setLocalGpu(next);
            onSaveGpu(next);
          }}
          className="space-y-3"
        >
          {(localGpu?.servers || []).map((s, i) => (
            <GpuServerCard
              key={s.id}
              s={s}
              idx={i}
              appConfig={appConfig}
              removeServer={removeServer}
              updateServer={updateServer}
              localGpu={localGpu}
              onSaveGpu={onSaveGpu}
            />
          ))}
        </Reorder.Group>
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
        dashboardTheme={appConfig.theme ?? "dark"}
        activeWidgets={activeWidgets}
        widgetId={serviceWidgetMeta("gpu_enabled").id}
      />
    </section>
    );
  };

  const renderDeadlinesSection = () => (
    <section className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className={`text-xs font-black uppercase tracking-wider ${appConfig.theme === "light" ? "text-slate-500" : "text-slate-400"}`}>
          {LIVE_DATA_SECTION_LABELS.deadlines}
        </h2>
        <div className="flex items-center gap-3">
          <button
            onClick={handleRefreshDeadlinesSettings}
            disabled={isRefreshingDeadlines}
            className={sectionRefreshBtnClass(isRefreshingDeadlines)}
            title="Refresh paper deadlines"
          >
            <RefreshCw size={12} className={isRefreshingDeadlines ? "animate-spin" : ""} />
            Refresh All
          </button>
          <button
            onClick={() => handleRestorePosition("deadline_enabled")}
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
      <ServiceErrorBanners
        backendError={paperBackendError}
        refreshError={deadlinesRefreshError}
        onDismissBackend={() => setPaperBackendError(null)}
        onDismissRefresh={() => setDeadlinesRefreshError(null)}
        theme={appConfig.theme}
        showBackend={appConfig.deadline_enabled !== false}
        backendCachedLabel={cachedLabelWhen(
          liveDeadlines.length > 0,
          CACHED_LABELS.deadlines.backend
        )}
        refreshCachedLabel={cachedLabelWhen(
          liveDeadlines.length > 0,
          CACHED_LABELS.deadlines.refresh
        )}
      />
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
        dashboardTheme={appConfig.theme ?? "dark"}
        activeWidgets={activeWidgets}
        widgetId={serviceWidgetMeta("deadline_enabled").id}
      />
    </section>
  );

  const renderArxivSection = () => (
    <section className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className={`text-xs font-black uppercase tracking-wider ${appConfig.theme === "light" ? "text-slate-500" : "text-slate-400"}`}>
          {LIVE_DATA_SECTION_LABELS.arxiv}
        </h2>
        <div className="flex items-center gap-3">
          <button
            onClick={handleRefreshArxivSettings}
            disabled={isRefreshingArxiv}
            className={sectionRefreshBtnClass(isRefreshingArxiv)}
            title="Refresh arxiv papers"
          >
            <RefreshCw size={12} className={isRefreshingArxiv ? "animate-spin" : ""} />
            Refresh All
          </button>
          <button
            onClick={() => handleRestorePosition("arxiv_enabled")}
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
      <ServiceErrorBanners
        backendError={arxivBackendError}
        refreshError={arxivRefreshError}
        onDismissBackend={() => setArxivBackendError(null)}
        onDismissRefresh={() => setArxivRefreshError(null)}
        theme={appConfig.theme}
        showBackend={appConfig.arxiv_enabled !== false}
        backendCachedLabel={cachedLabelWhen(
          liveArxivPapers.length > 0,
          CACHED_LABELS.arxiv.backend
        )}
        refreshCachedLabel={cachedLabelWhen(
          liveArxivPapers.length > 0,
          CACHED_LABELS.arxiv.refresh
        )}
      />
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
                      const next = { ...localArxiv, categories: [c] };
                      setLocalArxiv(next);
                      onSaveArxiv(next);
                    }}
                    className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all ${
                      (localArxiv.categories?.[0] || "cs") === c
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
                value={arxivKeywordsInput}
                onChange={(e) => {
                  const input = e.target.value;
                  const next = { ...localArxiv, keywords: parseArxivKeywordsInput(input) };
                  setArxivKeywordsInput(input);
                  setLocalArxiv(next);
                }}
                onBlur={() => {
                  const next = { ...localArxiv, keywords: parseArxivKeywordsInput(arxivKeywordsInput) };
                  setLocalArxiv(next);
                  setArxivKeywordsInput(formatArxivKeywordsInput(next.keywords));
                  onSaveArxiv(next);
                }}
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
                  {Math.round((localArxiv.update_interval || 3600) / 3600)}h
                </span>
              </div>
              <input
                type="range"
                min="3600"
                max="86400"
                step="3600"
                value={localArxiv.update_interval || 3600}
                onChange={(e) => {
                  const nextVal = parseInt(e.target.value);
                  const next = { ...localArxiv, update_interval: nextVal };
                  setLocalArxiv(next);
                  onSaveArxiv(next);
                }}
                className="w-full h-1.5 bg-pink-600/20 rounded-lg appearance-none cursor-pointer accent-pink-600"
              />
            </div>
            <div className="flex items-center justify-between p-4 rounded-2xl bg-white/5 border border-white/5 gap-4">
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
        dashboardTheme={appConfig.theme ?? "dark"}
        activeWidgets={activeWidgets}
        widgetId={serviceWidgetMeta("arxiv_enabled").id}
      />
    </section>
  );

  const renderQuotaSection = () => {
    return (
    <section className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className={`text-xs font-black uppercase tracking-wider ${appConfig.theme === "light" ? "text-slate-500" : "text-slate-400"}`}>
          {LIVE_DATA_SECTION_LABELS.quota}
        </h2>
        <button
          onClick={() => handleRestorePosition("quota_enabled")}
          className={`flex items-center gap-1.5 px-4 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all border ${
            appConfig.theme === "light"
              ? "bg-slate-100 hover:bg-slate-200 text-slate-700 border-slate-200 hover:border-slate-300"
              : "bg-white/5 hover:bg-white/10 text-slate-300 hover:text-white border-white/5"
          }`}
        >
          <RotateCcw size={12} /> Restore Position
        </button>
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
          onReorder={(newItems: QuotaItemConfig[]) => {
            const next = { ...localQuota, items: newItems };
            setLocalQuota(next);
            onSaveQuota(next);
          }}
          className="space-y-3"
        >
          {(localQuota?.items || []).map((q) => (
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
        dashboardTheme={appConfig.theme ?? "dark"}
        activeWidgets={activeWidgets}
        widgetId={serviceWidgetMeta("quota_enabled").id}
      />
    </section>
    );
  };

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
              v0.2.4 Stable
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
              await tauriInvoke("open_link", { url: "https://github.com/starkmomo/widgitron" });
            }}
          >
            github.com/starkmomo/widgitron
          </a>.
        </p>

        {configDirPath && (
          <div
            className={`w-full max-w-md p-4 border border-[var(--dashboard-border)] rounded-2xl text-left ${
              appConfig.theme === "light" ? "bg-slate-50" : "bg-black/20"
            }`}
          >
            <div className="flex items-center justify-between mb-1">
              <div className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                Config Directory
              </div>
              <button
                onClick={async () => {
                  try {
                    await tauriInvoke("open_config_dir");
                  } catch (e) {
                    console.error("Failed to open config directory:", e);
                  }
                }}
                className="px-3 py-1 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-[9px] font-black uppercase tracking-widest transition-all shadow-lg shadow-blue-600/20"
              >
                Open
              </button>
            </div>
            <code className="text-[10px] break-all text-slate-400 font-mono">{configDirPath}</code>
            {corruptConfigFiles.length > 0 && (
              <div
                className={`mt-3 p-3 rounded-xl border text-[10px] leading-relaxed ${
                  appConfig.theme === "light"
                    ? "bg-amber-50 border-amber-200 text-amber-900"
                    : "bg-amber-500/10 border-amber-500/20 text-amber-300/90"
                }`}
              >
                <div className="font-black uppercase tracking-widest text-[9px] mb-1">
                  Corrupt Config Backups
                </div>
                <p className="mb-2 opacity-90">
                  Some config files could not be parsed and were renamed with a{" "}
                  <code className="font-mono">.corrupt.json</code> suffix. Widgitron is using
                  defaults until you fix or remove them.
                </p>
                <ul className="space-y-1 font-mono text-[9px] break-all">
                  {corruptConfigFiles.map((name) => (
                    <li key={name}>{name}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {/* OTA Update Card */}
        <div className={`w-full max-w-md p-6 border border-[var(--dashboard-border)] rounded-2xl text-left flex flex-col gap-4 ${
          appConfig.theme === "light" ? "bg-slate-50" : "bg-black/20"
        }`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <RotateCcw size={14} className={`text-blue-500 ${isCheckingUpdate ? "animate-spin" : ""}`} />
              <span className={`text-[11px] font-black uppercase tracking-wider ${appConfig.theme === "light" ? "text-slate-600" : "text-slate-400"}`}>
                Software Update
              </span>
            </div>
            {!updateInfo?.has_update && (
              <button
                onClick={handleCheckUpdate}
                disabled={isCheckingUpdate}
                className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-[9px] font-black uppercase tracking-widest transition-all disabled:opacity-50 pointer-events-auto"
              >
                {isCheckingUpdate ? "Checking..." : "Check Now"}
              </button>
            )}
          </div>

          {/* Status display */}
          {(updateError || updateCheckError) && (
            <div className="p-3 bg-red-500/10 border border-red-500/20 text-red-400 text-[10px] rounded-xl font-medium leading-relaxed space-y-1">
              <div>{updateError || updateCheckError}</div>
              <div className="text-[9px] opacity-80">
                Check your network connection or try again later. You can also download updates manually from GitHub Releases.
              </div>
            </div>
          )}

          {!updateError && !updateCheckError && updateInfo && !updateInfo.has_update && !isCheckingUpdate && (
            <div className="text-[10px] text-slate-500 font-medium">
              You are on the latest version ({updateInfo.current_version}).
            </div>
          )}

          {updateInfo?.has_update ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className={`text-xs font-bold ${appConfig.theme === "light" ? "text-slate-900" : "text-white"}`}>
                    Update Available: {updateInfo.latest_version}
                  </div>
                  <div className="text-[10px] text-slate-500">
                    Current version: {updateInfo.current_version}
                  </div>
                </div>
                <span className="px-2.5 py-1 rounded-full bg-amber-500/10 text-amber-500 text-[9px] font-black uppercase tracking-widest border border-amber-500/10 animate-pulse">
                  New
                </span>
              </div>

              {updateInfo.release_notes && (
                <div className={`p-3 rounded-xl max-h-36 overflow-y-auto text-[10px] font-medium leading-relaxed custom-scrollbar border border-[var(--dashboard-border)] ${
                  appConfig.theme === "light" ? "bg-white text-slate-600" : "bg-black/30 text-slate-400"
                }`}>
                  <div className="font-bold mb-1 uppercase tracking-wider text-[9px] text-slate-500">Release Notes:</div>
                  <pre className="whitespace-pre-wrap font-sans font-medium text-[10px] break-all">
                    {updateInfo.release_notes}
                  </pre>
                </div>
              )}

              {downloadState === "idle" && (
                <button
                  onClick={handleStartUpdate}
                  className="w-full py-2.5 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white rounded-xl text-[10px] font-black uppercase tracking-wider transition-all shadow-lg shadow-blue-500/20 text-center"
                >
                  Download and Install Update
                </button>
              )}

              {downloadState === "downloading" && (
                <div className="space-y-2">
                  <div className="flex justify-between text-[10px] text-slate-500 font-bold uppercase tracking-wider">
                    <span>Downloading...</span>
                    <span>{downloadProgress}%</span>
                  </div>
                  <div className="w-full h-1.5 bg-black/20 rounded-full overflow-hidden border border-white/5">
                    <div
                      className="h-full bg-gradient-to-r from-blue-500 to-indigo-500 rounded-full transition-all duration-300"
                      style={{ width: `${downloadProgress}%` }}
                    />
                  </div>
                </div>
              )}

              {downloadState === "completed" && (
                <div className="text-center py-2 text-xs font-bold text-emerald-400 animate-pulse">
                  Download completed. Launching installer...
                </div>
              )}

              {downloadState === "error" && (
                <button
                  onClick={handleStartUpdate}
                  className="w-full py-2.5 bg-red-600 hover:bg-red-500 text-white rounded-xl text-[10px] font-black uppercase tracking-wider transition-all text-center"
                >
                  Retry Download
                </button>
              )}
            </div>
          ) : (
            <div className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">
              {updateInfo ? "Your software is up to date." : "Check to see if updates are available."}
            </div>
          )}
        </div>
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
              {tab.id === "about" && updateInfo?.has_update && (
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse relative z-10 ml-auto flex-shrink-0 shadow-[0_0_6px_#f59e0b]" />
              )}
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
            {activeSection === LIVE_DATA_SECTION.QUOTA && renderQuotaSection()}
            {activeSection === LIVE_DATA_SECTION.GPU && renderGpuSection()}
            {activeSection === LIVE_DATA_SECTION.DEADLINES && renderDeadlinesSection()}
            {activeSection === LIVE_DATA_SECTION.ARXIV && renderArxivSection()}
            {activeSection === "about" && renderAboutSection()}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
