import { useState, useEffect, useRef } from "react";
import {
  LayoutDashboard,
  Settings,
  Cpu,
  Calendar,
  X,
  Minus,
  Square,
  Activity,
  Lock,
  Unlock,
  Pin,
  PinOff,
  Trophy,
  Copy,
  ExternalLink,
  Trash2,
  RefreshCw,
  Gauge,
  Globe,
  User
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { APP_VERSION } from "./constants";
import { invoke } from "@tauri-apps/api/core";
import { listen, emit } from "@tauri-apps/api/event";
import { enable, disable, isEnabled } from "@tauri-apps/plugin-autostart";
import { WebviewWindow, getAllWebviewWindows } from "@tauri-apps/api/webviewWindow";

import { WidgetTheme, WidgetThemeConfig } from "./types/theme";
import { hexToRgba } from "./utils/color";
import { SidebarLink } from "./components/SidebarLink";
import { WindowButton } from "./components/WindowButton";
import { MasterSwitch } from "./components/MasterSwitch";
import { StatCard } from "./components/StatCard";
import { WidgetPreviewCard } from "./components/WidgetPreviewCard";
import { CopyButton } from "./components/CopyButton";
import { DeadlineCountdown } from "./components/DeadlineCountdown";
import { GPUWidgetContent } from "./widgets/GPUWidgetContent";
import { DeadlineWidgetContent } from "./widgets/DeadlineWidgetContent";
import { ArxivWidgetContent } from "./widgets/ArxivWidgetContent";
import { QuotaWidgetContent } from "./widgets/QuotaWidgetContent";
import { SettingsPanel } from "./settings/SettingsPanel";

const appWindow = getCurrentWindow();

const PROVIDER_LOGOS: Record<string, string> = {
  antigravity: "/icons/antigravity.svg",
  codex: "/icons/codex.svg",
  cursor: "/icons/cursor.svg",
  copilot: "/icons/vscode.svg",
};

const renderProviderIcon = (provider: string, isManual = false) => {
  if (isManual) {
    return <User size={14} className="text-cyan-400 flex-shrink-0" />;
  }
  const logoSrc = PROVIDER_LOGOS[provider];
  if (logoSrc) {
    return (
      <img
        src={logoSrc}
        alt=""
        className="w-3.5 h-3.5 flex-shrink-0 object-contain"
        draggable={false}
      />
    );
  }
  if (provider.includes("openai")) {
    return <Cpu size={14} className="text-emerald-400 flex-shrink-0 animate-pulse" />;
  }
  return <Globe size={14} className="text-amber-400 flex-shrink-0" />;
};

function App() {
  const [activeTab, setActiveTab] = useState("dashboard");
  const [isMaximized, setIsMaximized] = useState(false);
  const [windowLabel, setWindowLabel] = useState("");
  const [isLocked, setIsLocked] = useState(true);
  const [isPinned, setIsPinned] = useState(false);
  const [gpuData, setGpuData] = useState<any[]>([]);
  const [deadlines, setDeadlines] = useState<any[]>([]);
  const [gpuConfig, setGpuConfig] = useState<any>({ servers: [] });
  const [paperConfig, setPaperConfig] = useState<any>({});
  const [arxivConfig, setArxivConfig] = useState<any>({});
  const [arxivPapers, setArxivPapers] = useState<any[]>([]);
  const [arxivSavedPapers, setArxivSavedPapers] = useState<any[]>([]);
  const [arxivDiscardedPapers, setArxivDiscardedPapers] = useState<any[]>([]);
  const [arxivView, setArxivView] = useState<"new" | "saved" | "discarded">("new");
  const [isRefreshingArxiv, setIsRefreshingArxiv] = useState(false);
  const [arxivError, setArxivError] = useState<string | null>(null);
  const [quotaData, setQuotaData] = useState<any[]>([]);
  const [quotaConfig, setQuotaConfig] = useState<any>({ items: [] });
  const [isRefreshingQuota, setIsRefreshingQuota] = useState(false);

  const handleRefreshArxiv = async () => {
    if (isRefreshingArxiv) return;
    setIsRefreshingArxiv(true);
    setArxivError(null);
    try {
      const papers = await invoke<any[]>("refresh_arxiv");
      setArxivPapers(papers);
    } catch (e) {
      console.error("Failed to refresh Arxiv:", e);
      setArxivError(String(e));
    } finally {
      setIsRefreshingArxiv(false);
    }
  };

  const [appConfig, setAppConfig] = useState<any>(() => {
    try {
      const saved = localStorage.getItem("widgitron-theme") || "dark";
      return { theme: saved };
    } catch (e) {
      return { theme: "dark" };
    }
  });
  const [isAutostart, setIsAutostart] = useState(false);
  const [activeWidgets, setActiveWidgets] = useState<string[]>([]);
  const [themeConfig, setThemeConfig] = useState<WidgetThemeConfig>({ themes: [], assignments: {} });
  const [currentTheme, setCurrentTheme] = useState<WidgetTheme | null>(null);
  const pendingToggles = useRef<Set<string>>(new Set());

  useEffect(() => {
    const win = appWindow;
    setWindowLabel(win.label);

    let interval: any;
    let unlisteners: (() => void)[] = [];
    let active = true;

    const init = async () => {
      try {
        console.log("Initializing window:", win.label);
        const gc = await invoke("get_gpu_config");
        if (!active) return;
        const pc = await invoke("get_paper_config");
        if (!active) return;
        const arc = await invoke("get_arxiv_config");
        if (!active) return;
        const ac = (await invoke("get_app_config")) as any;
        if (!active) return;
        const initialDeadlines: any = await invoke("get_deadlines");
        if (!active) return;
        const initialGpuData: any = await invoke("get_gpu_data");
        if (!active) return;
        const initialArxiv: any = await invoke("get_arxiv_papers");
        if (!active) return;
        const qc = await invoke("get_quota_config");
        if (!active) return;
        const initialQuotas = await invoke("get_quota_data");
        if (!active) return;
        const tc: WidgetThemeConfig = await invoke("get_theme_config");
        if (!active) return;

        setGpuConfig(gc);
        setPaperConfig(pc);
        setArxivConfig(arc);
        setAppConfig(ac);
        if (ac.theme) localStorage.setItem("widgitron-theme", ac.theme);
        setDeadlines(initialDeadlines);
        setGpuData(initialGpuData);
        setArxivPapers(initialArxiv);
        setQuotaConfig(qc);
        setQuotaData(initialQuotas as any[]);
        setIsAutostart(await isEnabled());
        if (!active) return;
        setThemeConfig(tc);

        const label = win.label;
        if (label.startsWith("widget-")) {
          const tid = tc.assignments?.[label];
          let defaultId = "theme-gpu-default";
          if (label.includes("deadlines")) defaultId = "theme-deadline-default";
          if (label.includes("arxiv")) defaultId = "theme-arxiv-default";
          if (label.includes("quota")) defaultId = "theme-quota-default";

          const theme = tc.themes.find((t) => t.id === tid) || tc.themes.find((t) => t.id === defaultId);
          setCurrentTheme(theme || null);

          let pinned = false;
          if (ac.always_on_top?.[label] !== undefined) {
            pinned = ac.always_on_top[label];
          }

          setIsPinned(pinned);

          // Wait a bit for the window to be ready before Win32 manipulations
          setTimeout(async () => {
            if (!active) return;
            if (pinned) {
              await win.setAlwaysOnTop(true);
              await invoke("set_desktop_mode", { label, enabled: false });
            } else {
              await win.setAlwaysOnTop(false);
              await invoke("set_desktop_mode", { label, enabled: true });
            }
          }, 500);
        }

        const windows = await getAllWebviewWindows();
        if (!active) return;
        const initialActive = [];
        for (const w of windows) {
          if (w.label.startsWith("widget-") && (await w.isVisible())) {
            initialActive.push(w.label);
          }
        }
        if (!active) return;
        setActiveWidgets(initialActive);

        interval = setInterval(async () => {
          try {
            const wins = await getAllWebviewWindows();
            if (!active) return;
            const activeW = [];
            for (const w of wins) {
              if (w.label.startsWith("widget-") && (await w.isVisible())) {
                activeW.push(w.label);
              }
            }
            if (!active) return;
            setActiveWidgets(activeW);
          } catch (e) {
            console.error("Failed to query active windows in interval", e);
          }
        }, 1000);

        const u1 = await win.onResized(async () => {
          try {
            const maximized = await win.isMaximized();
            if (!active) return;
            setIsMaximized(maximized);
          } catch (e) {
            console.error(e);
          }
        });
        if (!active) {
          u1();
        } else {
          unlisteners.push(() => u1());
        }

        const u2 = await listen<any>("gpu_update", (event) => {
          if (!active) return;
          const item = event.payload;
          setGpuData((prev) => {
            const index = prev.findIndex((s) => s.host === item.host);
            if (index === -1) return [...prev, item];
            const next = [...prev];
            next[index] = item;
            return next;
          });
        });
        if (!active) {
          u2();
        } else {
          unlisteners.push(() => u2());
        }

        const u3 = await listen<any[]>("paper_update", (event) => {
          if (!active) return;
          setDeadlines(event.payload);
        });
        if (!active) {
          u3();
        } else {
          unlisteners.push(() => u3());
        }

        const u4 = await listen("gpu_clear", () => {
          if (!active) return;
          setGpuData([]);
        });
        if (!active) {
          u4();
        } else {
          unlisteners.push(() => u4());
        }

        const u5 = await listen("theme_update", (event: any) => {
          if (!active) return;
          const config = event.payload as WidgetThemeConfig;
          setThemeConfig(config);
          if (label.startsWith("widget-")) {
            const tid = config.assignments?.[label];
            const defaultId = label.includes("gpu")
              ? "theme-gpu-default"
              : label.includes("deadlines")
              ? "theme-deadline-default"
              : label.includes("arxiv")
              ? "theme-arxiv-default"
              : "theme-quota-default";
            const theme = config.themes.find((t) => t.id === tid) || config.themes.find((t) => t.id === defaultId);
            setCurrentTheme(theme || null);
          }
        });
        if (!active) {
          u5();
        } else {
          unlisteners.push(() => u5());
        }

        const u6 = await listen<any[]>("arxiv_update", (event) => {
          if (!active) return;
          setArxivPapers(event.payload);
        });
        if (!active) {
          u6();
        } else {
          unlisteners.push(() => u6());
        }

        const u8 = await listen("arxiv_saved_update", async () => {
          try {
            const saved = await invoke<any[]>("get_arxiv_saved_papers");
            if (!active) return;
            setArxivSavedPapers(saved);
          } catch (e) {
            console.error(e);
          }
        });
        if (!active) {
          u8();
        } else {
          unlisteners.push(() => u8());
        }

        const u9 = await listen("arxiv_discarded_update", async () => {
          try {
            const discarded = await invoke<any[]>("get_arxiv_discarded_papers");
            if (!active) return;
            setArxivDiscardedPapers(discarded);
          } catch (e) {
            console.error(e);
          }
        });
        if (!active) {
          u9();
        } else {
          unlisteners.push(() => u9());
        }

        const u10 = await listen<any[]>("quota_update", (event) => {
          if (!active) return;
          setQuotaData(event.payload);
        });
        if (!active) {
          u10();
        } else {
          unlisteners.push(() => u10());
        }

        // Initial fetch
        invoke<any>("get_arxiv_config").then((res) => {
          if (active) setArxivConfig(res);
        }).catch(console.error);
        invoke<any[]>("get_arxiv_saved_papers").then((res) => {
          if (active) setArxivSavedPapers(res);
        }).catch(console.error);
        invoke<any[]>("get_arxiv_discarded_papers").then((res) => {
          if (active) setArxivDiscardedPapers(res);
        }).catch(console.error);
        invoke<any[]>("get_arxiv_papers").then((res) => {
          if (active) setArxivPapers(res);
        }).catch(console.error);
      } catch (e) {
        console.error("Init failed", e);
      }
    };

    if (win.label === "tray-menu") {
      win.onFocusChanged(async (event) => {
        if (!active) return;
        if (!event.payload) {
          try {
            if (await win.isVisible()) {
              setTimeout(() => {
                win.hide().catch(console.error);
              }, 10);
            }
          } catch (err) {
            console.error("Error checking tray-menu visibility on focus change:", err);
          }
        }
      }).then((u) => {
        if (!active) {
          u();
        } else {
          unlisteners.push(() => u());
        }
      }).catch(console.error);
      init();
    } else {
      init();
    }

    return () => {
      active = false;
      if (interval) clearInterval(interval);
      unlisteners.forEach((f) => f());
    };
  }, []);

  const saveGpuConfig = async (newConfig: any) => {
    try {
      await invoke("save_gpu_config", { config: newConfig });
      setGpuConfig(newConfig);
      await emit("gpu_config_update", newConfig);
    } catch (e) {
      console.error("Save failed", e);
    }
  };

  const savePaperConfig = async (newConfig: any) => {
    try {
      await invoke("save_paper_config", { config: newConfig });
      setPaperConfig(newConfig);
      await emit("paper_config_update", newConfig);
    } catch (e) {
      console.error("Save failed", e);
    }
  };

  const togglePinConference = async (title: string) => {
    const nextPinned = (paperConfig.pinned_titles || []).includes(title)
      ? paperConfig.pinned_titles.filter((t: string) => t !== title)
      : [...(paperConfig.pinned_titles || []), title];
    const nextConfig = { ...paperConfig, pinned_titles: nextPinned };
    await savePaperConfig(nextConfig);
  };

  const onSaveApp = async (config: any) => {
    setAppConfig(config);
    if (config.theme) localStorage.setItem("widgitron-theme", config.theme);
    await invoke("save_app_config", { config });
  };

  const saveArxivConfig = async (newConfig: any) => {
    try {
      await invoke("save_arxiv_config", { config: newConfig });
      setArxivConfig(newConfig);
      await emit("arxiv_config_update", newConfig);
    } catch (e) {
      console.error("Save Arxiv config failed", e);
    }
  };

  const saveQuotaConfig = (newConfig: any) => {
    // Update UI state immediately for instant responsiveness
    setQuotaConfig(newConfig);

    const newItems: any[] = newConfig?.items || [];
    const cachedMap = new Map(quotaData.map((q: any) => [q.id, q]));
    const merged = newItems.map((item: any) => {
      const cached = cachedMap.get(item.id);
      if (cached && cached.provider === item.provider) {
        // Keep cached display data, update config fields
        return {
          ...cached,
          name: item.name,
          max_quota: item.max_quota,
          unit: item.unit,
          api_key: item.api_key,
          api_url: item.api_url,
          json_path: item.json_path
        };
      }
      // New item or provider changed: placeholder until next fetch
      return {
        ...item,
        current_value: null,
        error_msg: null,
        last_update: null,
        account_label: null,
        primary_name: null,
        primary_reset: null,
        secondary_value: null,
        secondary_name: null,
        secondary_reset: null,
        bars: null,
        plan_type: null
      };
    });
    
    setQuotaData(merged);
    emit("quota_update", merged);

    // Notify widgets instantly (e.g. show_account_name toggle)
    emit("quota_config_update", newConfig);
    // Fire-and-forget: save to disk in background
    invoke("save_quota_config", { config: newConfig }).catch((e: any) => {
      console.error("Save quota config failed", e);
    });
  };

  const onSaveThemes = async (config: WidgetThemeConfig) => {
    setThemeConfig(config);
    await invoke("save_theme_config", { config });
    // Emit event to widgets to sync themes
    await emit("theme_update", config);
  };

  const toggleMaximize = async () => {
    try {
      await appWindow.toggleMaximize();
    } catch (e) {
      console.error(e);
    }
  };

  const handleToggleWidget = async (id: string, title: string) => {
    if (pendingToggles.current.has(id)) return;
    pendingToggles.current.add(id);
    
    // We can keep the optimistic update so the UI still feels snappy,
    // but the pending set will prevent rapid fire.
    // Wait, polling interval might revert the UI if the backend hasn't updated yet.
    // Let's do the optimistic update, then wait for invoke, then verify actual state.
    try {
      setActiveWidgets((prev) => (prev.includes(id) ? prev.filter((w) => w !== id) : [...prev, id]));
      await invoke("toggle_widget", { id, title });

      // Optionally double check Window state if we want to be foolproof, 
      // but polling loop will eventually catch it.
    } catch (e) {
      console.error("Toggle failed", e);
    } finally {
      pendingToggles.current.delete(id);
    }
  };

  const toggleLock = async () => {
    const nextLocked = !isLocked;
    setIsLocked(nextLocked);

    // When unlocking, we MUST exit desktop mode to allow movement
    // When locking, if we are NOT pinned, we re-enter desktop mode
    if (windowLabel.startsWith("widget-")) {
      if (!nextLocked) {
        // Unlocking: Exit desktop mode
        await invoke("set_desktop_mode", { label: windowLabel, enabled: false });
      } else {
        // Locking: If not pinned, re-embed
        if (!isPinned) {
          await invoke("set_desktop_mode", { label: windowLabel, enabled: true });
        }
      }
    }
  };

  const togglePin = async (labelToToggle?: string) => {
    try {
      const targetLabel = labelToToggle || windowLabel;
      const currentVal = targetLabel === windowLabel ? isPinned : appConfig.always_on_top?.[targetLabel] || false;
      const next = !currentVal;

      const targetWin = targetLabel === windowLabel ? appWindow : await WebviewWindow.getByLabel(targetLabel);

      if (next) {
        // Turning ON Always on Top: Disable Desktop Mode FIRST, then set top
        await invoke("set_desktop_mode", { label: targetLabel, enabled: false });
        await targetWin?.setAlwaysOnTop(true);
      } else {
        // Turning OFF Always on Top: Enable Desktop Mode (Embedded)
        await targetWin?.setAlwaysOnTop(false);
        await invoke("set_desktop_mode", { label: targetLabel, enabled: true });
      }

      if (targetLabel === windowLabel) {
        setIsPinned(next);
      }

      const nextStates = { ...(appConfig.always_on_top || {}), [targetLabel]: next };
      await onSaveApp({ ...appConfig, always_on_top: nextStates });
    } catch (e) {
      console.error(e);
    }
  };

  const handleClose = async () => {
    console.log("Close clicked, label:", windowLabel);
    try {
      const win = getCurrentWindow();
      if (windowLabel === "main") {
        await win.hide();
      } else if (windowLabel.startsWith("widget-")) {
        await invoke("close_widget", { id: windowLabel });
      } else {
        await win.close();
      }
    } catch (e) {
      console.error("Close failed", e);
    }
  };

  const startDrag = async (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (e.button === 0 && !target.closest('[data-no-drag="true"]')) {
      try {
        console.log("Start dragging");
        await getCurrentWindow().startDragging();
      } catch (e) {
        console.error("Drag failed", e);
      }
    }
  };

  // --- CUSTOM TRAY MENU VIEW ---
  if (windowLabel === "tray-menu") {
    return (
      <div className="h-screen w-screen flex flex-col bg-white border border-slate-200 rounded-lg overflow-hidden shadow-xl p-1 select-none">
        <button
          onClick={() => invoke("show_main")}
          className="w-full flex items-center gap-3 px-3 py-2 rounded-md hover:bg-slate-100 text-slate-700 transition-colors group"
        >
          <LayoutDashboard
            size={14}
            className="text-slate-500 group-hover:text-blue-600 transition-colors"
          />
          <span className="text-[11px] font-bold">Dashboard</span>
        </button>
        <button
          onClick={() => invoke("exit_app")}
          className="w-full flex items-center gap-3 px-3 py-2 rounded-md hover:bg-red-50 text-slate-700 hover:text-red-600 transition-colors group"
        >
          <X size={14} className="text-slate-500 group-hover:text-red-500 transition-colors" />
          <span className="text-[11px] font-bold">Exit</span>
        </button>
      </div>
    );
  }

  // --- DESKTOP WIDGET VIEW ---
  if (windowLabel.startsWith("widget-")) {
    const isGpu = windowLabel.includes("gpu");
    const isDeadline = windowLabel.includes("deadlines");
    const isQuota = windowLabel.includes("quota");

    return (
      <div className="absolute inset-0 flex flex-col group select-none overflow-hidden bg-transparent p-0">
        {/* Floating Controls (Now inside the window, but top-right) */}
        <div className="absolute top-1 right-1 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-300 z-50">
          <button
            data-no-drag="true"
            onClick={toggleLock}
            className="w-7 h-7 flex items-center justify-center rounded-md bg-black/60 border border-white/10 text-white/70 hover:text-white transition-all shadow-lg backdrop-blur-md"
          >
            {isLocked ? <Lock size={12} /> : <Unlock size={12} />}
          </button>
          <button
            data-no-drag="true"
            onClick={() => togglePin()}
            className={`w-7 h-7 flex items-center justify-center rounded-md bg-black/60 border border-white/10 ${
              isPinned ? "text-blue-400" : "text-white/70"
            } hover:text-white transition-all shadow-lg backdrop-blur-md`}
            title={isPinned ? "Unpin (Embed in Desktop)" : "Pin to top"}
          >
            {isPinned ? <Pin size={12} /> : <PinOff size={12} />}
          </button>
          <button
            data-no-drag="true"
            onClick={handleClose}
            className="w-7 h-7 flex items-center justify-center rounded-md bg-red-500/30 border border-red-500/20 text-red-400 hover:bg-red-50 hover:text-white transition-all shadow-lg backdrop-blur-md"
          >
            <X size={12} />
          </button>
        </div>

        {/* The Glass Card (Fills the window, buttons overlap content) */}
        <div
          className={`flex-1 p-5 flex flex-col gap-4 relative overflow-hidden rounded-xl z-10 ${
            isLocked ? "" : "shadow-2xl shadow-black/80"
          }`}
          style={
            windowLabel.startsWith("widget-") && currentTheme
              ? {
                  backgroundColor: hexToRgba(currentTheme.bg_color, currentTheme.bg_opacity),
                  color: currentTheme.text_colors?.find((c) => c.name === "Main Text")
                    ? hexToRgba(
                        currentTheme.text_colors.find((c) => c.name === "Main Text")!.value,
                        currentTheme.text_colors.find((c) => c.name === "Main Text")!.opacity ?? 1.0
                      )
                    : "#ffffff",
                  border: `1px solid ${hexToRgba(
                    currentTheme.text_colors?.find((c) => c.name === "Main Text")?.value || "#ffffff",
                    0.1
                  )}`
                }
              : {}
          }
          onMouseDown={!isLocked ? startDrag : undefined}
          data-tauri-drag-region={!isLocked ? "true" : "false"}
        >
          {isGpu && <GPUWidgetContent />}
          {isDeadline && <DeadlineWidgetContent />}
          {windowLabel.includes("arxiv") && <ArxivWidgetContent />}
          {isQuota && <QuotaWidgetContent />}
        </div>
      </div>
    );
  }

  // --- MAIN CONTROL PANEL VIEW ---
  return (
    <div
      className={`absolute inset-0 flex overflow-hidden ${appConfig.theme === "light" ? "light-theme" : ""} glass ${
        isMaximized ? "rounded-none" : "rounded-xl dashboard-accent-border"
      }`}
    >
      {/* Sidebar */}
      <aside
        className={`w-64 border-r border-white/5 flex flex-col bg-[var(--sidebar-bg)] z-20 select-none`}
        onMouseDown={startDrag}
      >
        <div className="p-6 flex items-center gap-2.5 cursor-default">
          <div className="w-9 h-9 bg-blue-600 rounded-xl flex items-center justify-center shadow-lg shadow-blue-500/40 overflow-hidden pointer-events-none">
            <img src="/logo.png" alt="Widgitron" className="w-full h-full object-cover" />
          </div>
          <div className="pointer-events-none flex flex-col justify-center space-y-1.5">
            <h1 className="font-bold text-base tracking-tight leading-none">Widgitron</h1>
            <span className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold leading-none">
              {APP_VERSION}
            </span>
          </div>
        </div>

        <nav className="flex-1 px-4 pt-2 pb-6 space-y-1.5 overflow-y-auto" data-no-drag="true">
          <SidebarLink
            icon={<LayoutDashboard size={20} />}
            label="Overview"
            active={activeTab === "dashboard"}
            onClick={() => setActiveTab("dashboard")}
            theme={appConfig.theme}
          />
          <SidebarLink
            icon={<Gauge size={20} />}
            label="Quota Monitor"
            active={activeTab === "quota"}
            onClick={() => setActiveTab("quota")}
            theme={appConfig.theme}
          />
          <SidebarLink
            icon={<Cpu size={20} />}
            label="GPU Monitor"
            active={activeTab === "gpu"}
            onClick={() => setActiveTab("gpu")}
            theme={appConfig.theme}
          />
          <SidebarLink
            icon={<Calendar size={20} />}
            label="Paper Deadlines"
            active={activeTab === "deadlines"}
            onClick={() => setActiveTab("deadlines")}
            theme={appConfig.theme}
          />
          <SidebarLink
            icon={<Activity size={20} />}
            label="Arxiv Radar"
            active={activeTab === "arxiv"}
            onClick={() => setActiveTab("arxiv")}
            theme={appConfig.theme}
          />
          <div
            className={`my-4 border-t ${appConfig.theme === "light" ? "border-slate-200" : "border-white/10"}`}
          />
          <SidebarLink
            icon={<Settings size={20} />}
            label="Settings"
            active={activeTab === "settings"}
            onClick={() => setActiveTab("settings")}
            theme={appConfig.theme}
          />
        </nav>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 z-20">
        <header
          className={`h-14 flex items-center justify-between px-6 border-b border-[var(--dashboard-border)] relative bg-[var(--header-bg)] z-50 select-none pointer-events-auto`}
          data-tauri-drag-region="true"
        >
          <div className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500 pointer-events-none">
            {activeTab === "dashboard"
              ? "Overview"
              : activeTab === "gpu"
              ? "GPU Monitor"
              : activeTab === "deadlines"
              ? "Paper Deadlines"
              : activeTab === "arxiv"
              ? "Arxiv Radar"
              : activeTab === "quota"
              ? "Quota Monitor"
              : activeTab}
          </div>
          <div className="flex items-center gap-0.5 z-[60] pointer-events-auto">
            <WindowButton
              icon={<Minus size={16} />}
              onClick={() => appWindow.minimize()}
              theme={appConfig.theme}
            />
            <WindowButton
              icon={isMaximized ? <Copy size={12} /> : <Square size={14} />}
              onClick={toggleMaximize}
              theme={appConfig.theme}
            />
            <WindowButton
              icon={<X size={18} />}
              onClick={handleClose}
              hoverColor="hover:bg-red-500"
              theme={appConfig.theme}
            />
          </div>
        </header>

        <div
          className={`flex-1 overflow-y-auto p-8 custom-scrollbar relative z-0 ${
            appConfig.theme === "light" ? "bg-transparent" : "bg-black/5"
          }`}
          data-no-drag="true"
        >
          <AnimatePresence mode="wait">
            {activeTab === "dashboard" && (
              <motion.div
                key="dashboard"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-8"
              >
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-6">
                  <StatCard
                    label="Total GPUs"
                    value={gpuData.reduce((acc, s) => acc + s.gpu_list.length, 0).toString()}
                    icon={<Cpu className="text-purple-400" />}
                    theme={appConfig.theme}
                  />
                  <StatCard
                    label="Active Deadlines"
                    value={deadlines.length.toString()}
                    icon={<Calendar className="text-emerald-400" />}
                    theme={appConfig.theme}
                  />
                  <StatCard
                    label="Arxiv Radar"
                    value={arxivPapers.length.toString()}
                    icon={<Activity className="text-pink-400" />}
                    theme={appConfig.theme}
                  />
                  <StatCard
                    label="Monitored Agents"
                    value={quotaData.length.toString()}
                    icon={<Gauge className="text-cyan-400" />}
                    theme={appConfig.theme}
                  />
                </div>

                <div className="mt-4">
                  <h2
                    className={`text-xl font-bold tracking-tight mb-6 ${
                      appConfig.theme === "light" ? "text-slate-900" : "text-white"
                    }`}
                  >
                    Quick Launch Widgets
                  </h2>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {appConfig.quota_enabled !== false && (
                      <WidgetPreviewCard
                        title="Quota Monitor Widget"
                        status={activeWidgets.includes("widget-quota-default") ? "Active" : "Ready"}
                        detail="Track AI agent & API limits on your desktop"
                        trend={activeWidgets.includes("widget-quota-default") ? "Hide Widget" : "Show Widget"}
                        color="cyan"
                        theme={appConfig.theme}
                        onLaunch={() => handleToggleWidget("widget-quota-default", "Quota Monitor")}
                      />
                    )}
                    {appConfig.gpu_enabled !== false && (
                      <WidgetPreviewCard
                        title="GPU Monitor Widget"
                        status={activeWidgets.includes("widget-gpu-default") ? "Active" : "Ready"}
                        detail="Floating desktop monitoring for GPU clusters"
                        trend={activeWidgets.includes("widget-gpu-default") ? "Hide Widget" : "Show Widget"}
                        color="blue"
                        theme={appConfig.theme}
                        onLaunch={() => handleToggleWidget("widget-gpu-default", "GPU Monitor")}
                      />
                    )}
                    {appConfig.deadline_enabled !== false && (
                      <WidgetPreviewCard
                        title="Paper Deadlines Widget"
                        status={activeWidgets.includes("widget-deadlines-default") ? "Active" : "Ready"}
                        detail="Track conference deadlines on your desktop"
                        trend={activeWidgets.includes("widget-deadlines-default") ? "Hide Widget" : "Show Widget"}
                        color="purple"
                        theme={appConfig.theme}
                        onLaunch={() => handleToggleWidget("widget-deadlines-default", "Paper Deadlines")}
                      />
                    )}
                    {appConfig.arxiv_enabled !== false && (
                      <WidgetPreviewCard
                        title="Arxiv Radar Widget"
                        status={activeWidgets.includes("widget-arxiv-default") ? "Active" : "Ready"}
                        detail="Swipe to discover latest research papers"
                        trend={activeWidgets.includes("widget-arxiv-default") ? "Hide Widget" : "Show Widget"}
                        color="pink"
                        theme={appConfig.theme}
                        onLaunch={() => handleToggleWidget("widget-arxiv-default", "Arxiv Radar")}
                      />
                    )}
                  </div>
                </div>
              </motion.div>
            )}

            {activeTab === "gpu" && (
              <motion.div
                key="gpu"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
              >
                <div className="flex items-center justify-between mb-8">
                  <h2
                    className={`text-2xl font-bold tracking-tight ${
                      appConfig.theme === "light" ? "text-slate-900" : "text-white"
                    }`}
                  >
                    GPU Monitor Status
                  </h2>
                  <div className="flex items-center gap-3">
                    <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                      {appConfig.gpu_enabled !== false ? "Service Enabled" : "Service Disabled"}
                    </span>
                    <MasterSwitch
                      enabled={appConfig.gpu_enabled !== false}
                      onToggle={async (val) => {
                        try {
                          const next = { ...appConfig, gpu_enabled: val };
                          setAppConfig(next);
                          await invoke("save_app_config", { config: next });
                          if (!val) {
                            setGpuData([]);
                            await invoke("close_widget", { id: "widget-gpu-default" });
                          } else {
                            await invoke("create_widget", { id: "widget-gpu-default", title: "GPU Monitor" });
                          }
                        } catch (e) {
                          console.error("GPU Master Switch failed", e);
                        }
                      }}
                    />
                  </div>
                </div>
                <div className="space-y-6">
                  {gpuData.length === 0 ? (
                    <div className="p-12 text-center bg-black/5 rounded-3xl border border-dashed border-white/10 text-slate-500 font-bold uppercase tracking-widest text-xs">
                      No active data. Configure servers in Settings.
                    </div>
                  ) : (
                    gpuData.map((server, idx) => (
                      <div key={idx} className="glass-card p-6">
                        <div className="flex items-center justify-between mb-6">
                          <div className="flex items-center gap-3">
                            <div
                              className={`w-3 h-3 rounded-full ${
                                server.is_online ? "bg-emerald-500 shadow-[0_0_10px_#10b981]" : "bg-red-500"
                              }`}
                            />
                            <span
                              className={`text-lg font-bold ${
                                appConfig.theme === "light" ? "text-slate-900" : "text-white"
                              }`}
                            >
                              {server.host}
                            </span>
                          </div>
                          <span className="text-xs font-black text-slate-500 uppercase tracking-widest">
                            {server.gpu_list.length} GPUs Detected
                          </span>
                        </div>
                        <div className="space-y-8">
                          {(() => {
                            const groups: Record<string, any[]> = {};
                            server.gpu_list.forEach((gpu: any) => {
                              const gid = gpu.job_id || "SYSTEM";
                              if (!groups[gid]) groups[gid] = [];
                              groups[gid].push(gpu);
                            });

                            return Object.entries(groups).map(([jobId, gpus]) => (
                              <div key={jobId} className="space-y-4">
                                {jobId !== "SYSTEM" && (
                                  <div className="flex items-center gap-2 text-xs font-black text-blue-400 uppercase tracking-[0.2em] mb-2 px-1">
                                    <Activity size={14} /> Job: {jobId}
                                    <CopyButton text={jobId} />
                                  </div>
                                )}
                                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                                  {gpus.map((gpu, gidx) => (
                                    <div
                                      key={gidx}
                                      className={`p-5 rounded-xl border ${
                                        appConfig.theme === "light" ? "bg-slate-50 border-slate-100" : "bg-black/20 border-white/5"
                                      } relative group transition-all hover:bg-black/5`}
                                    >
                                      <div className="flex items-center justify-between mb-4">
                                        <span
                                          className={`text-sm font-bold ${
                                            appConfig.theme === "light" ? "text-slate-900" : "text-white"
                                          }`}
                                        >
                                          {gpu.name}
                                        </span>
                                        <span
                                          className={`text-[10px] font-black ${
                                            gpu.util > 80 ? "text-red-500" : "text-blue-400"
                                          } uppercase tracking-widest`}
                                        >
                                          {gpu.util}%
                                        </span>
                                      </div>

                                      <div className="space-y-4">
                                        <div>
                                          <div className="flex justify-between text-[10px] text-slate-500 font-bold uppercase tracking-tighter mb-1">
                                            <span>Load</span>
                                            <span>{gpu.util}%</span>
                                          </div>
                                          <div
                                            className={`w-full ${
                                              appConfig.theme === "light" ? "bg-slate-200" : "bg-white/5"
                                            } h-1.5 rounded-full overflow-hidden mt-1`}
                                          >
                                            <motion.div
                                              initial={{ width: 0 }}
                                              animate={{ width: `${gpu.util}%` }}
                                              className={`h-full rounded-full ${gpu.util > 80 ? "bg-red-500" : "bg-blue-500"}`}
                                            />
                                          </div>
                                        </div>

                                        <div className="grid grid-cols-2 gap-4">
                                          <div
                                            className={`p-2 rounded-lg ${
                                              appConfig.theme === "light" ? "bg-white" : "bg-white/5"
                                            }`}
                                          >
                                            <div className="text-[10px] text-slate-500 font-bold uppercase tracking-tighter">
                                              Temp
                                            </div>
                                            <div
                                              className={`text-sm font-bold ${
                                                appConfig.theme === "light" ? "text-slate-900" : "text-white"
                                              }`}
                                            >
                                              {gpu.temp}°C
                                            </div>
                                          </div>
                                          <div
                                            className={`p-2 rounded-lg ${
                                              appConfig.theme === "light" ? "bg-white" : "bg-white/5"
                                            }`}
                                          >
                                            <div className="text-[10px] text-slate-500 font-bold uppercase tracking-tighter">
                                              Memory
                                            </div>
                                            <div
                                              className={`text-sm font-bold ${
                                                appConfig.theme === "light" ? "text-slate-900" : "text-white"
                                              }`}
                                            >
                                              {gpu.mem_used}/{gpu.mem_total}MB
                                            </div>
                                          </div>
                                        </div>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            ));
                          })()}
                        </div>
                        {server.error && (
                          <p className="mt-4 text-[10px] text-red-400/60 italic font-medium break-all">
                            {server.error}
                          </p>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </motion.div>
            )}

            {activeTab === "deadlines" && (
              <motion.div
                key="deadlines"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
              >
                <div className="flex items-center justify-between mb-8">
                  <h2
                    className={`text-2xl font-bold tracking-tight ${
                      appConfig.theme === "light" ? "text-slate-900" : "text-white"
                    }`}
                  >
                    Paper Deadlines
                  </h2>
                  <div className="flex items-center gap-3">
                    <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                      {appConfig.deadline_enabled !== false ? "Service Enabled" : "Service Disabled"}
                    </span>
                    <MasterSwitch
                      enabled={appConfig.deadline_enabled !== false}
                      onToggle={async (val) => {
                        try {
                          const next = { ...appConfig, deadline_enabled: val };
                          setAppConfig(next);
                          await invoke("save_app_config", { config: next });
                          if (!val) {
                            setDeadlines([]);
                            await invoke("close_widget", { id: "widget-deadlines-default" });
                          } else {
                            await invoke("create_widget", { id: "widget-deadlines-default", title: "Deadlines" });
                          }
                        } catch (e) {
                          console.error("Deadline Master Switch failed", e);
                        }
                      }}
                    />
                  </div>
                </div>
                <div className="space-y-4">
                  {deadlines.length === 0 ? (
                    <div className="p-12 text-center bg-black/5 rounded-3xl border border-dashed border-white/10 text-slate-500 font-bold uppercase tracking-widest text-xs">
                      No deadlines match your current filters.
                    </div>
                  ) : (
                    deadlines.map((dl, idx) => {
                      const isPinned = (paperConfig.pinned_titles || []).includes(dl.title);
                      return (
                        <div
                          key={idx}
                          className={`border border-[var(--dashboard-border)] rounded-2xl p-6 flex items-center justify-between hover:bg-black/5 transition-all group ${
                            appConfig.theme === "light" ? "bg-white" : "bg-white/5"
                          }`}
                        >
                          <div className="flex items-center gap-6">
                            <div
                              className={`w-16 h-16 rounded-2xl flex flex-col items-center justify-center relative ${
                                appConfig.theme === "light"
                                  ? "bg-purple-100 text-purple-600"
                                  : "bg-gradient-to-br from-purple-500/20 to-pink-500/20 border border-purple-500/20 text-purple-400"
                              }`}
                            >
                              <span className="text-[10px] font-black uppercase tracking-tighter opacity-60">
                                {dl.sub}
                              </span>
                              <Trophy
                                size={20}
                                className={appConfig.theme === "light" ? "text-purple-600" : "text-purple-400"}
                              />
                              <button
                                onClick={() => togglePinConference(dl.title)}
                                className={`absolute -top-2 -right-2 p-1.5 rounded-full shadow-lg transition-all ${
                                  isPinned ? "bg-amber-500 text-white scale-110" : "bg-slate-800 text-slate-500 opacity-0 group-hover:opacity-100"
                                }`}
                              >
                                <Pin size={10} className={isPinned ? "fill-current" : ""} />
                              </button>
                            </div>
                            <div>
                              <h3
                                className={`text-lg font-bold group-hover:text-purple-400 transition-colors flex flex-wrap items-center gap-2 ${
                                  appConfig.theme === "light" ? "text-slate-900" : "text-white"
                                }`}
                              >
                                <span>{dl.title} {dl.year}</span>
                                {dl.ccf && (
                                  <span className={`text-[9px] font-black px-1.5 py-0.5 rounded ${
                                    appConfig.theme === "light" ? "bg-purple-100 text-purple-700" : "bg-purple-500/10 text-purple-400 border border-purple-500/20"
                                  }`}>
                                    {dl.ccf === "N" ? "Non CCF" : `CCF ${dl.ccf}`}
                                  </span>
                                )}
                                {dl.core && (
                                  <span className={`text-[9px] font-black px-1.5 py-0.5 rounded ${
                                    appConfig.theme === "light" ? "bg-blue-100 text-blue-700" : "bg-blue-500/10 text-blue-400 border border-blue-500/20"
                                  }`}>
                                    {dl.core === "N" ? "Non Core" : `Core ${dl.core}`}
                                  </span>
                                )}
                              </h3>
                              <div className="flex items-center gap-3 mt-1">
                                <p className="text-xs text-slate-500 font-medium">{dl.place}</p>
                                <div className="w-1 h-1 rounded-full bg-slate-700" />
                                <div className="text-[10px] font-mono font-bold text-purple-500/80">
                                  <DeadlineCountdown date={dl.deadline_utc} />
                                </div>
                              </div>
                            </div>
                          </div>
                          <div className="text-right">
                            <div
                              className={`text-xl font-black ${
                                appConfig.theme === "light" ? "text-slate-900" : "text-white"
                              }`}
                            >
                              {new Date(dl.deadline_utc).toLocaleDateString()}
                            </div>
                            <div className="text-xs font-bold text-slate-500 uppercase tracking-widest">
                              Deadline (UTC)
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </motion.div>
            )}

            {activeTab === "arxiv" && (
              <motion.div
                key="arxiv"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
              >
                {arxivError && (
                  <div className="mb-6 p-4 rounded-2xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs font-semibold flex items-center justify-between shadow-lg backdrop-blur-md">
                    <span className="flex items-center gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                      ArXiv API Error: {arxivError}
                    </span>
                    <button
                      onClick={() => setArxivError(null)}
                      className="p-1 rounded-lg hover:bg-white/10 text-red-400/60 hover:text-red-400 transition-colors"
                    >
                      <X size={14} />
                    </button>
                  </div>
                )}
                <div className="flex items-center justify-between mb-8">
                  <div className="flex items-center gap-6">
                    <h2
                      className={`text-2xl font-bold tracking-tight ${
                        appConfig.theme === "light" ? "text-slate-900" : "text-white"
                      }`}
                    >
                      Arxiv Radar
                    </h2>
                    <div
                      className={`flex items-center p-1 rounded-xl ${
                        appConfig.theme === "light" ? "bg-slate-100" : "bg-white/5"
                      }`}
                    >
                      <button
                        onClick={() => setArxivView("new")}
                        className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${
                          arxivView === "new"
                            ? appConfig.theme === "light"
                              ? "bg-white text-slate-900 shadow-sm"
                              : "bg-white/10 text-white shadow-lg"
                            : "text-slate-500 hover:text-slate-400"
                        }`}
                      >
                        Latest ({arxivPapers.length})
                      </button>
                      <button
                        onClick={() => setArxivView("saved")}
                        className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${
                          arxivView === "saved"
                            ? appConfig.theme === "light"
                              ? "bg-white text-slate-900 shadow-sm"
                              : "bg-white/10 text-white shadow-lg"
                            : "text-slate-500 hover:text-slate-400"
                        }`}
                      >
                        Saved ({arxivSavedPapers.length})
                      </button>
                      <button
                        onClick={() => setArxivView("discarded")}
                        className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${
                          arxivView === "discarded"
                            ? appConfig.theme === "light"
                              ? "bg-white text-slate-900 shadow-sm"
                              : "bg-white/10 text-white shadow-lg"
                            : "text-slate-500 hover:text-slate-400"
                        }`}
                      >
                        Discarded ({arxivDiscardedPapers.length})
                      </button>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    {appConfig.arxiv_enabled !== false && (
                      <button
                        onClick={handleRefreshArxiv}
                        disabled={isRefreshingArxiv}
                        className={`p-2 rounded-xl border border-[var(--dashboard-border)] ${
                          appConfig.theme === "light"
                            ? "bg-white hover:bg-slate-50 text-slate-700 shadow-sm"
                            : "bg-white/5 hover:bg-white/10 text-white/80 hover:text-white"
                        } disabled:opacity-50 transition-all flex items-center justify-center`}
                        title="Refresh papers"
                      >
                        <RefreshCw size={14} className={isRefreshingArxiv ? "animate-spin" : ""} />
                      </button>
                    )}
                    <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                      {appConfig.arxiv_enabled !== false ? "Service Enabled" : "Service Disabled"}
                    </span>
                    <MasterSwitch
                      enabled={appConfig.arxiv_enabled !== false}
                      onToggle={async (val) => {
                        try {
                          const next = { ...appConfig, arxiv_enabled: val };
                          setAppConfig(next);
                          await invoke("save_app_config", { config: next });
                          if (!val) {
                            setArxivPapers([]);
                            await invoke("close_widget", { id: "widget-arxiv-default" });
                          } else {
                            await invoke("create_widget", { id: "widget-arxiv-default", title: "Arxiv Radar" });
                          }
                        } catch (e) {
                          console.error("Arxiv Master Switch failed", e);
                        }
                      }}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {(arxivView === "new" ? arxivPapers : arxivView === "saved" ? arxivSavedPapers : arxivDiscardedPapers)
                    .length === 0 ? (
                    <div className="col-span-full p-12 text-center bg-black/5 rounded-3xl border border-dashed border-white/10 text-slate-500 font-bold uppercase tracking-widest text-xs">
                      {arxivView === "new"
                        ? "No new papers. Adjust keywords in Settings or wait for update."
                        : arxivView === "saved"
                        ? "No saved papers yet. Swipe right on the widget to save!"
                        : "No discarded papers. Swipe left on the widget to discard."}
                    </div>
                  ) : (
                    (arxivView === "new" ? arxivPapers : arxivView === "saved" ? arxivSavedPapers : arxivDiscardedPapers).map(
                      (paper, idx) => (
                        <div
                          key={idx}
                          className={`border border-[var(--dashboard-border)] rounded-2xl p-6 flex flex-col gap-4 hover:bg-black/5 transition-all group ${
                            appConfig.theme === "light" ? "bg-white" : "bg-white/5"
                          }`}
                        >
                          <div className="flex-1">
                            <h3
                              className={`text-sm font-bold line-clamp-2 mb-2 ${
                                appConfig.theme === "light" ? "text-slate-900" : "text-white"
                              }`}
                            >
                              {paper.title}
                            </h3>
                            <p className="text-[10px] text-slate-500 line-clamp-6 leading-relaxed">
                              {paper.summary}
                            </p>
                          </div>
                          <div className="flex items-center justify-between mt-2 pt-4 border-t border-white/5">
                            <div className="flex flex-wrap gap-1">
                              <span className="text-[9px] font-medium text-blue-400 bg-blue-400/10 px-2 py-0.5 rounded-full">
                                {paper.authors.length > 0 ? (
                                  <>
                                    {paper.authors[0]}
                                    {paper.authors.length > 1 ? " et al." : ""}
                                  </>
                                ) : (
                                  "Unknown Author"
                                )}
                              </span>
                            </div>
                            <div className="flex items-center gap-2">
                              {arxivView === "saved" && (
                                <button
                                  onClick={() => invoke("remove_arxiv_saved_paper", { id: paper.id })}
                                  className="p-2 rounded-xl bg-red-500/10 text-red-400 hover:bg-red-50 hover:text-white transition-all"
                                  title="Remove from saved"
                                >
                                  <Trash2 size={14} />
                                </button>
                              )}
                              {arxivView === "discarded" && (
                                <button
                                  onClick={() => invoke("remove_arxiv_discarded_paper", { id: paper.id })}
                                  className="p-2 rounded-xl bg-red-500/10 text-red-400 hover:bg-red-50 hover:text-white transition-all"
                                  title="Delete permanently"
                                >
                                  <Trash2 size={14} />
                                </button>
                              )}
                              <button
                                onClick={() => invoke("open_link", { url: paper.link })}
                                className="p-2 rounded-xl bg-white/5 text-slate-400 hover:text-white transition-colors"
                              >
                                <ExternalLink size={14} />
                              </button>
                            </div>
                          </div>
                        </div>
                      )
                    )
                  )}
                </div>
              </motion.div>
            )}

            {activeTab === "quota" && (
              <motion.div
                key="quota"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
              >
                <div className="flex items-center justify-between mb-8">
                  <h2
                    className={`text-2xl font-bold tracking-tight ${
                      appConfig.theme === "light" ? "text-slate-900" : "text-white"
                    }`}
                  >
                    Agent & API Quotas
                  </h2>
                  <div className="flex items-center gap-3">
                    <button
                      onClick={async () => {
                        setIsRefreshingQuota(true);
                        try {
                          await invoke("refresh_quota");
                        } catch (e) {
                          console.error(e);
                        } finally {
                          setIsRefreshingQuota(false);
                        }
                      }}
                      disabled={isRefreshingQuota}
                      className={`p-2 rounded-xl border border-[var(--dashboard-border)] ${
                        appConfig.theme === "light"
                          ? "bg-white hover:bg-slate-50 text-slate-700 shadow-sm"
                          : "bg-white/5 hover:bg-white/10 text-white/80 hover:text-white"
                      } disabled:opacity-50 transition-all flex items-center justify-center`}
                      title="Refresh quotas"
                    >
                      <RefreshCw size={14} className={isRefreshingQuota ? "animate-spin" : ""} />
                    </button>
                    <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                      {appConfig.quota_enabled !== false ? "Service Enabled" : "Service Disabled"}
                    </span>
                    <MasterSwitch
                      enabled={appConfig.quota_enabled !== false}
                      onToggle={async (val) => {
                        try {
                          const next = { ...appConfig, quota_enabled: val };
                          setAppConfig(next);
                          await invoke("save_app_config", { config: next });
                          if (!val) {
                            setQuotaData([]);
                            await invoke("close_widget", { id: "widget-quota-default" });
                          } else {
                            await invoke("create_widget", { id: "widget-quota-default", title: "Quota Monitor" });
                          }
                        } catch (e) {
                          console.error("Quota Master Switch failed", e);
                        }
                      }}
                    />
                  </div>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {quotaData.length === 0 ? (
                    <div className="col-span-full p-12 text-center bg-black/5 rounded-3xl border border-dashed border-white/10 text-slate-500 font-bold uppercase tracking-widest text-xs">
                      No agents configured. Go to Settings to add one.
                    </div>
                  ) : (
                    quotaData.map((q) => {
                      const hasMax = q.max_quota !== undefined && q.max_quota !== null && q.max_quota > 0;
                      const current = q.current_value ?? 0;
                      const max = q.max_quota ?? 100;
                      const percent = hasMax ? Math.min(100, Math.max(0, (current / max) * 100)) : 100;
                      
                      let barColor = "bg-cyan-500";
                      let textColor = "text-cyan-400";
                      if (hasMax) {
                        if (percent < 15) {
                          barColor = "bg-red-500";
                          textColor = "text-red-400";
                        } else if (percent < 40) {
                          barColor = "bg-amber-500";
                          textColor = "text-amber-400";
                        } else {
                          barColor = "bg-emerald-500";
                          textColor = "text-emerald-400";
                        }
                      }

                      const usesQuotaBarLayout =
                        q.provider === "codex" ||
                        q.provider === "cursor" ||
                        q.provider === "antigravity" ||
                        q.provider === "copilot";

                      const isMultiBar =
                        usesQuotaBarLayout &&
                        ((q.bars && q.bars.length > 0) ||
                          q.provider === "copilot" ||
                          (q.secondary_value !== undefined && q.secondary_value !== null) ||
                          (q.tertiary_value !== undefined && q.tertiary_value !== null));

                      const bars =
                        q.bars && q.bars.length > 0
                          ? q.bars.map((bar: any) => ({
                              val: bar.value,
                              name: bar.name,
                              reset: bar.reset,
                            }))
                          : [
                              { val: q.current_value ?? 0, name: q.primary_name || "Usage", reset: q.primary_reset },
                              ...(q.secondary_value !== undefined && q.secondary_value !== null
                                ? [{ val: q.secondary_value, name: q.secondary_name || "", reset: q.secondary_reset }]
                                : []),
                              ...(q.tertiary_value !== undefined && q.tertiary_value !== null
                                ? [{ val: q.tertiary_value, name: q.tertiary_name || "", reset: q.tertiary_reset }]
                                : []),
                            ];

                      const showBarReset = q.provider === "codex" || q.provider === "antigravity";
                      const isManual = q.provider === "manual";

                      return (
                        <div
                          key={q.id}
                          className={`glass-card p-6 border border-[var(--dashboard-border)] rounded-2xl relative overflow-hidden group ${
                            appConfig.theme === "light" ? "bg-white" : "bg-white/5"
                          }`}
                        >
                          <div className="relative z-10 flex flex-col gap-4">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2 min-w-0">
                                {renderProviderIcon(q.provider, isManual)}
                                <h3 className={`text-sm font-bold truncate ${appConfig.theme === "light" ? "text-slate-900" : "text-white"}`}>
                                  {q.name}{quotaConfig?.show_account_name && q.account_label ? ` (${q.account_label})` : ""}
                                </h3>
                                {(quotaConfig?.show_plan_type !== false) && q.plan_type && (
                                  <span className={`text-[8px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded border border-white/5 flex-shrink-0 ${
                                    appConfig.theme === "light" ? "bg-slate-100 text-slate-500" : "bg-white/5 text-slate-400"
                                  }`}>
                                    {q.plan_type}
                                  </span>
                                )}
                              </div>
                              {!isMultiBar && (
                                <span className={`text-sm font-black ${textColor}`}>
                                  {current.toFixed(current % 1 === 0 ? 0 : 2)}
                                  {q.unit ? ` ${q.unit}` : ""}
                                  {hasMax && q.unit !== "%" && ` / ${max}`}
                                </span>
                              )}
                            </div>

                            {isMultiBar ? (
                              <div className="space-y-3">
                                {bars.map((bar: any, i: number) => {
                                  const pct = bar.val;
                                  let colorClass = "bg-emerald-500";
                                  let textClass = "text-emerald-400";
                                  if (pct < 15) {
                                    colorClass = "bg-red-500";
                                    textClass = "text-red-400";
                                  } else if (pct < 40) {
                                    colorClass = "bg-amber-500";
                                    textClass = "text-amber-400";
                                  }
                                  return (
                                    <div key={i} className="space-y-1">
                                      <div className="flex justify-between items-center text-[11px] font-bold">
                                        <span className="text-slate-400 flex items-center gap-1.5 min-w-0">
                                          <span className="truncate">{bar.name}</span>
                                          {showBarReset && bar.reset && (
                                            <span className="text-[10px] opacity-50 font-normal whitespace-nowrap">
                                              ({bar.reset})
                                            </span>
                                          )}
                                        </span>
                                        <span className={`tabular-nums font-black ${textClass}`}>
                                          {pct.toFixed(0)}%
                                        </span>
                                      </div>
                                      <div className="w-full h-1.5 bg-black/20 rounded-full overflow-hidden border border-white/5">
                                        <div
                                          className={`h-full rounded-full transition-all duration-500 ${colorClass}`}
                                          style={{ width: `${pct}%` }}
                                        />
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            ) : (
                              hasMax && (
                                <div className="space-y-1.5">
                                  <div className="w-full h-1.5 bg-black/20 rounded-full overflow-hidden border border-white/5">
                                    <div
                                      className={`h-full rounded-full transition-all duration-500 ${barColor}`}
                                      style={{ width: `${percent}%` }}
                                    />
                                  </div>
                                  <div className="flex justify-between text-[10px] text-slate-500">
                                    <span>{percent.toFixed(0)}% remaining</span>
                                    <span>{max - current >= 0 ? (max - current).toFixed(1) : 0} used</span>
                                  </div>
                                </div>
                              )
                            )}

                            <div className="flex justify-between items-center text-[10px] text-slate-500/60 pt-2 border-t border-white/5 mt-1">
                              <span>Last Update: {q.last_update ? q.last_update.split(" ")[1] || q.last_update : "Never"}</span>
                              {q.primary_reset && (q.provider === "cursor" || q.provider === "copilot" || !isMultiBar) && (
                                <span>Reset: {q.primary_reset}</span>
                              )}
                            </div>
                            
                            {q.error_msg && (
                              <div className="mt-2 text-xs text-red-400 bg-red-500/5 p-3 rounded-xl border border-red-500/10 italic">
                                {q.error_msg}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </motion.div>
            )}

            {activeTab === "settings" && (
              <SettingsPanel
                gpuConfig={gpuConfig}
                paperConfig={paperConfig}
                arxivConfig={arxivConfig}
                appConfig={appConfig}
                quotaConfig={quotaConfig}
                themeConfig={themeConfig}
                onSaveGpu={saveGpuConfig}
                onSavePaper={savePaperConfig}
                onSaveArxiv={saveArxivConfig}
                onSaveQuota={saveQuotaConfig}
                onSaveApp={onSaveApp}
                onSaveThemes={onSaveThemes}
                isAutostart={isAutostart}
                onToggleAutostart={async () => {
                  if (isAutostart) await disable();
                  else await enable();
                  setIsAutostart(await isEnabled());
                }}
                activeWidgets={activeWidgets}
              />
            )}
          </AnimatePresence>
        </div>
      </main>
    </div>
  );
}

export default App;
