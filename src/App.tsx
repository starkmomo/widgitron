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
  User,
  ChevronDown
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { APP_VERSION } from "./constants";
import { isStaleQuotaWarning, quotaHasDisplayValue, orderQuotaByConfig } from "./utils/quotaDisplay";
import { orderGpuServersByConfig, sortGpuJobGroups } from "./utils/gpuDisplay";
import {
  gpuStatHint as computeGpuStatHint,
  quotaStatHint as computeQuotaStatHint,
  serviceUpdateStatHint,
} from "./utils/statHints";
import { tauriInvoke } from "./utils/tauriInvoke";
import { tauriListen } from "./utils/tauriListen";
import { enable, disable, isEnabled } from "@tauri-apps/plugin-autostart";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";

import { WidgetTheme, WidgetThemeConfig } from "./types/theme";
import { hexToRgba } from "./utils/color";
import { listenBackendServiceError } from "./utils/backendServiceError";
import { listenQuotaMonitorStatus, type QuotaMonitorStatus } from "./utils/quotaMonitorStatus";
import { listenServiceUpdateEvents } from "./utils/serviceUpdateEvents";
import { listenGpuDataSync } from "./utils/gpuDataSync";
import { isLiveDataSection, LIVE_DATA_SECTION, refetchSectionLiveDataForSection, appTabLabel, LIVE_DATA_SECTION_LABELS, type AppTab } from "./utils/sectionLiveData";
import { fetchArxivSavedPapers, fetchArxivDiscardedPapers, loadArxivArchiveLists } from "./utils/arxivArchive";
import { formatArxivKeywordLabel, groupArxivPapersByKeyword } from "./utils/arxivKeywords";
import type { AppConfig, ArxivConfig, ArxivPaper, GpuConfig, GpuInfo, PaperConfig, PaperDeadlineInfo, QuotaBarDisplay, QuotaConfig, QuotaItem, ServerGpuData } from "./types/config";
import type { UpdateInfo } from "./types/tauri";
import { resolveWidgetTheme } from "./utils/widgetTheme";
import { CACHED_LABELS, cachedLabelWhen, gpuRefreshCachedLabel, messageShowsCached } from "./utils/cachedLabels";
import { SidebarLink } from "./components/SidebarLink";
import { WindowButton } from "./components/WindowButton";
import { MasterSwitch } from "./components/MasterSwitch";
import { DashboardServiceToggleError, ToggleErrorBanner } from "./components/SettingsRefreshError";
import { ServiceErrorBanners } from "./components/ServiceErrorBanners";
import { StatCard } from "./components/StatCard";
import { WidgetPreviewCard } from "./components/WidgetPreviewCard";
import { CopyButton } from "./components/CopyButton";
import { DeadlineCountdown } from "./components/DeadlineCountdown";
import { GPUWidgetContent } from "./widgets/GPUWidgetContent";
import { DeadlineWidgetContent } from "./widgets/DeadlineWidgetContent";
import { ArxivWidgetContent } from "./widgets/ArxivWidgetContent";
import { QuotaWidgetContent } from "./widgets/QuotaWidgetContent";
import { SettingsPanel } from "./settings/SettingsPanel";
import {
  applyServiceDisableClears,
  buildServiceDisableHandlers,
  applyWidgetVisibilityChange,
  activeWidgetLabelsFromConfig,
  buildServiceFieldToggleDeps,
  buildServiceToggleCallbacks,
  clearLiveDataSectionErrors,
  createSectionRefreshHandler,
  createSetServiceBusy,
  createMasterServiceToggleHandler,
  formatWidgetToggleError,
  invokeToggleWidget,
  isServiceToggleBusy,
  serviceWidgetMeta,
  SERVICE_FIELD_TO_TAB,
  type ServiceDisableHandlers,
  type ServiceField,
  type ServiceToggleError,
} from "./utils/widgetLifecycle";

const WIDGET_DESKTOP_STAGGER_MS: Record<string, number> = {
  "widget-gpu-default": 400,
  "widget-deadlines-default": 900,
  "widget-arxiv-default": 1400,
  "widget-quota-default": 1900,
};

const appWindow = getCurrentWindow();

const QUICK_LAUNCH_WIDGETS: {
  field: ServiceField;
  color: "cyan" | "blue" | "purple" | "pink";
  detail: string;
}[] = [
  {
    field: "quota_enabled",
    color: "cyan",
    detail: "Track AI agent & API limits on your desktop",
  },
  {
    field: "gpu_enabled",
    color: "blue",
    detail: "Floating desktop monitoring for GPU clusters",
  },
  {
    field: "deadline_enabled",
    color: "purple",
    detail: "Track conference deadlines on your desktop",
  },
  {
    field: "arxiv_enabled",
    color: "pink",
    detail: "Swipe to discover latest research papers",
  },
];

const PROVIDER_LOGOS: Record<string, string> = {
  antigravity: "/icons/antigravity.svg",
  codex: "/icons/codex.svg",
  cursor: "/icons/cursor.svg",
  copilot: "/icons/vscode.svg",
  "qoder-cn": "/icons/qoder-cn.svg",
  pioneer: "/icons/pioneer.svg",
  "claude-code": "/icons/claude-code.svg",
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
  const [activeTab, setActiveTab] = useState<AppTab>("dashboard");
  const [isMaximized, setIsMaximized] = useState(false);
  const [windowLabel, setWindowLabel] = useState("");
  const [isLocked, setIsLocked] = useState(true);
  const [isPinned, setIsPinned] = useState(false);
  const [gpuData, setGpuData] = useState<ServerGpuData[]>([]);
  const [deadlines, setDeadlines] = useState<PaperDeadlineInfo[]>([]);
  const [gpuConfig, setGpuConfig] = useState<GpuConfig>({ servers: [] });
  const [paperConfig, setPaperConfig] = useState<PaperConfig>({});
  const [arxivConfig, setArxivConfig] = useState<ArxivConfig>({});
  const [arxivPapers, setArxivPapers] = useState<ArxivPaper[]>([]);
  const [arxivSavedPapers, setArxivSavedPapers] = useState<ArxivPaper[]>([]);
  const [arxivDiscardedPapers, setArxivDiscardedPapers] = useState<ArxivPaper[]>([]);
  const [arxivView, setArxivView] = useState<"new" | "saved" | "discarded">("new");
  const [collapsedArxivKeywords, setCollapsedArxivKeywords] = useState<Set<string>>(new Set());
  const [isRefreshingArxiv, setIsRefreshingArxiv] = useState(false);
  const [arxivRefreshError, setArxivRefreshError] = useState<string | null>(null);
  const [arxivError, setArxivError] = useState<string | null>(null);
  const [paperError, setPaperError] = useState<string | null>(null);
  const [paperRefreshError, setPaperRefreshError] = useState<string | null>(null);
  const [quotaData, setQuotaData] = useState<QuotaItem[]>([]);
  const [quotaConfig, setQuotaConfig] = useState<QuotaConfig>({ items: [] });
  const [isRefreshingQuota, setIsRefreshingQuota] = useState(false);
  const [isRefreshingDeadlines, setIsRefreshingDeadlines] = useState(false);
  const [isRefreshingGpu, setIsRefreshingGpu] = useState(false);
  const [gpuRefreshError, setGpuRefreshError] = useState<string | null>(null);
  const [quotaRefreshError, setQuotaRefreshError] = useState<string | null>(null);
  const [quotaBackendError, setQuotaBackendError] = useState<string | null>(null);
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [updateCheckError, setUpdateCheckError] = useState<string | null>(null);
  const [quotaMonitorStatus, setQuotaMonitorStatus] = useState<QuotaMonitorStatus | null>(null);

  const configuredGpuHosts = new Set((gpuConfig.servers || []).map((s) => s.host));
  const visibleGpuData = orderGpuServersByConfig(
    gpuData.filter((s) => configuredGpuHosts.has(s.host)),
    gpuConfig.servers
  );

  const visibleQuotaData = orderQuotaByConfig(quotaData, quotaConfig?.items);

  const totalGpus = visibleGpuData.reduce((acc, s) => acc + (s.gpu_list?.length ?? 0), 0);
  const gpuServerCount = visibleGpuData.length;
  const gpuServersOnline = visibleGpuData.filter((s) => s.is_online).length;
  const gpuOfflineCount = gpuServerCount - gpuServersOnline;
  const gpuStaleCount = visibleGpuData.filter((s) => messageShowsCached(s.error)).length;
  const gpuStat = computeGpuStatHint({
    refreshError: gpuRefreshError,
    totalGpus,
    gpuStaleCount,
    gpuServerCount,
    gpuServersOnline,
    gpuOfflineCount,
  });
  const gpuStatHint = gpuStat.hint;
  const gpuStatHintTone = gpuStat.tone;

  const quotaHardErrorCount = visibleQuotaData.filter(
    (q) => q.error_msg && !isStaleQuotaWarning(q.error_msg)
  ).length;
  const quotaStaleCount = visibleQuotaData.filter(
    (q) => isStaleQuotaWarning(q.error_msg) && quotaHasDisplayValue(q)
  ).length;
  const monitoredAgentCount = (quotaConfig?.items?.length ?? visibleQuotaData.length).toString();
  const quotaBackoffActive = (quotaMonitorStatus?.consecutive_failures ?? 0) > 0;
  const quotaStat = computeQuotaStatHint({
    refreshError: quotaRefreshError,
    visibleQuotaCount: visibleQuotaData.length,
    quotaHardErrorCount,
    quotaBackoffActive,
    backoffSecs: quotaMonitorStatus?.backoff_secs ?? 0,
    quotaStaleCount,
  });
  const quotaStatHint = quotaStat.hint;
  const quotaStatHintTone = quotaStat.tone;

  const arxivStat = serviceUpdateStatHint(
    arxivRefreshError,
    arxivError,
    arxivPapers.length > 0
  );
  const arxivStatHint = arxivStat.hint;
  const arxivStatHintTone = arxivStat.tone;

  const paperStat = serviceUpdateStatHint(
    paperRefreshError,
    paperError,
    deadlines.length > 0
  );
  const paperStatHint = paperStat.hint;
  const paperStatHintTone = paperStat.tone;

  const handleRefreshArxiv = createSectionRefreshHandler({
    isRefreshing: isRefreshingArxiv,
    setIsRefreshing: setIsRefreshingArxiv,
    clearError: () => setArxivRefreshError(null),
    setError: setArxivRefreshError,
    section: LIVE_DATA_SECTION.ARXIV,
    onSuccess: (papers) => {
      setArxivPapers(papers as ArxivPaper[]);
    },
    logLabel: "Failed to refresh Arxiv",
  });

  const handleRefreshDeadlines = createSectionRefreshHandler({
    isRefreshing: isRefreshingDeadlines,
    setIsRefreshing: setIsRefreshingDeadlines,
    clearError: () => setPaperRefreshError(null),
    setError: setPaperRefreshError,
    section: LIVE_DATA_SECTION.DEADLINES,
    onSuccess: (items) => {
      setDeadlines(items);
    },
    logLabel: "Failed to refresh deadlines",
  });

  const handleRefreshGpu = createSectionRefreshHandler({
    isRefreshing: isRefreshingGpu,
    setIsRefreshing: setIsRefreshingGpu,
    clearError: () => setGpuRefreshError(null),
    setError: setGpuRefreshError,
    section: LIVE_DATA_SECTION.GPU,
    onSuccess: (data) => setGpuData(data),
    logLabel: "Failed to refresh GPU data",
  });

  const handleRefreshQuota = createSectionRefreshHandler({
    isRefreshing: isRefreshingQuota,
    setIsRefreshing: setIsRefreshingQuota,
    clearError: () => setQuotaRefreshError(null),
    setError: setQuotaRefreshError,
    section: LIVE_DATA_SECTION.QUOTA,
    onSuccess: (refreshed) => setQuotaData(refreshed),
    logLabel: "Failed to refresh quota",
  });

  const [appConfig, setAppConfig] = useState<AppConfig>(() => {
    try {
      const saved = localStorage.getItem("widgitron-theme") || "dark";
      return { theme: saved === "light" ? "light" : "dark" };
    } catch (e) {
      return { theme: "dark" };
    }
  });
  const [isAutostart, setIsAutostart] = useState(false);
  const [activeWidgets, setActiveWidgets] = useState<string[]>([]);
  const [themeConfig, setThemeConfig] = useState<WidgetThemeConfig>({ themes: [], assignments: {} });
  const [currentTheme, setCurrentTheme] = useState<WidgetTheme | null>(null);
  const [pendingToggles, setPendingToggles] = useState<Set<string>>(new Set());
  const [toggleWidgetError, setToggleWidgetError] = useState<string | null>(null);
  const [serviceToggleBusy, setServiceToggleBusy] = useState<Partial<Record<ServiceField, boolean>>>({});
  const [generalServiceRefreshError, setGeneralServiceRefreshError] = useState<ServiceToggleError | null>(null);
  const [serviceToggleErrorDismissed, setServiceToggleErrorDismissed] = useState(false);
  const prevActiveTabRef = useRef(activeTab);

  useEffect(() => {
    const prevTab = prevActiveTabRef.current;
    if (prevTab !== activeTab) {
      if (
        serviceToggleErrorDismissed &&
        generalServiceRefreshError &&
        SERVICE_FIELD_TO_TAB[generalServiceRefreshError.field] === prevTab
      ) {
        setGeneralServiceRefreshError(null);
      }
      if (prevTab === "dashboard") {
        setToggleWidgetError(null);
      }
      if (isLiveDataSection(prevTab)) {
        clearLiveDataSectionErrors(prevTab, {
          gpu: { clearRefresh: () => setGpuRefreshError(null) },
          deadlines: {
            clearRefresh: () => setPaperRefreshError(null),
            clearBackend: () => setPaperError(null),
          },
          arxiv: {
            clearRefresh: () => setArxivRefreshError(null),
            clearBackend: () => setArxivError(null),
          },
          quota: {
            clearRefresh: () => setQuotaRefreshError(null),
            clearBackend: () => setQuotaBackendError(null),
          },
        });
      }
      setServiceToggleErrorDismissed(false);
      prevActiveTabRef.current = activeTab;
    }
  }, [activeTab, serviceToggleErrorDismissed, generalServiceRefreshError]);

  useEffect(() => {
    if (!isLiveDataSection(activeTab)) return;

    const setters = {
      [LIVE_DATA_SECTION.GPU]: setGpuData,
      [LIVE_DATA_SECTION.DEADLINES]: setDeadlines,
      [LIVE_DATA_SECTION.ARXIV]: setArxivPapers,
      [LIVE_DATA_SECTION.QUOTA]: setQuotaData,
    };
    refetchSectionLiveDataForSection(activeTab, setters);
  }, [activeTab]);

  const onActiveWidgetsChanged = (labels: string[]) => {
    setActiveWidgets(labels);
  };

  const serviceDisableHandlers: ServiceDisableHandlers = buildServiceDisableHandlers({
    gpu_enabled: {
      clearData: () => setGpuData([]),
      clearRefreshError: () => setGpuRefreshError(null),
    },
    deadline_enabled: {
      clearData: () => setDeadlines([]),
      clearRefreshError: () => setPaperRefreshError(null),
      clearBackendError: () => setPaperError(null),
    },
    arxiv_enabled: {
      clearData: () => setArxivPapers([]),
      clearRefreshError: () => setArxivRefreshError(null),
      clearBackendError: () => setArxivError(null),
    },
    quota_enabled: {
      clearData: () => setQuotaData([]),
      clearRefreshError: () => setQuotaRefreshError(null),
      clearBackendError: () => setQuotaBackendError(null),
      clearMonitorStatus: () => setQuotaMonitorStatus(null),
    },
  });

  const setServiceBusy = createSetServiceBusy(setServiceToggleBusy);

  const serviceToggleCallbacks = buildServiceToggleCallbacks({
    setServiceBusy,
    onGeneralServiceError: setGeneralServiceRefreshError,
    fields: {
      gpu_enabled: buildServiceFieldToggleDeps(
        () => setGpuRefreshError(null),
        setGpuRefreshError,
        setGpuData
      ),
      deadline_enabled: buildServiceFieldToggleDeps(
        () => setPaperRefreshError(null),
        setPaperRefreshError,
        setDeadlines
      ),
      arxiv_enabled: buildServiceFieldToggleDeps(
        () => setArxivRefreshError(null),
        setArxivRefreshError,
        setArxivPapers
      ),
      quota_enabled: buildServiceFieldToggleDeps(
        () => setQuotaRefreshError(null),
        setQuotaRefreshError,
        setQuotaData
      ),
    },
  });

  const checkServiceToggleBusy = (field: ServiceField) =>
    isServiceToggleBusy(field, serviceToggleBusy);

  useEffect(() => {
    const win = appWindow;
    setWindowLabel(win.label);

    let unlisteners: (() => void)[] = [];
    let active = true;

    const init = async () => {
      try {
        const label = win.label;

        if (label === "tray-menu") {
          return;
        }

        if (label.startsWith("widget-")) {
          const [ac, tc] = await Promise.all([
            tauriInvoke("get_app_config"),
            tauriInvoke("get_theme_config"),
          ]);
          if (!active) return;

          setAppConfig(ac);
          setThemeConfig(tc);
          setCurrentTheme(resolveWidgetTheme(tc, label));

          const pinned = ac.always_on_top?.[label] ?? false;
          setIsPinned(pinned);

          const stagger = WIDGET_DESKTOP_STAGGER_MS[label] ?? 500;
          setTimeout(async () => {
            if (!active) return;
            if (pinned) {
              await win.setAlwaysOnTop(true);
              await tauriInvoke("set_desktop_mode", { label, enabled: false });
            } else {
              await win.setAlwaysOnTop(false);
              await tauriInvoke("set_desktop_mode", { label, enabled: true });
            }
          }, stagger);

          const uTheme = await tauriListen("theme_update", (event) => {
            if (!active) return;
            const config = event.payload;
            setThemeConfig(config);
            setCurrentTheme(resolveWidgetTheme(config, label));
          });
          unlisteners.push(() => uTheme());
          return;
        }

        const [gc, pc, arc, ac, qc, tc, autostartEnabled] = await Promise.all([
          tauriInvoke("get_gpu_config"),
          tauriInvoke("get_paper_config"),
          tauriInvoke("get_arxiv_config"),
          tauriInvoke("get_app_config"),
          tauriInvoke("get_quota_config"),
          tauriInvoke("get_theme_config"),
          isEnabled(),
        ]);

        if (!active) return;

        setGpuConfig(gc);
        setPaperConfig(pc);
        setArxivConfig(arc);
        setAppConfig(ac);
        if (ac.theme) localStorage.setItem("widgitron-theme", ac.theme);
        setQuotaConfig(qc);
        setIsAutostart(autostartEnabled);
        setThemeConfig(tc);

        const sectionSetters = {
          [LIVE_DATA_SECTION.GPU]: setGpuData,
          [LIVE_DATA_SECTION.DEADLINES]: setDeadlines,
          [LIVE_DATA_SECTION.ARXIV]: setArxivPapers,
          [LIVE_DATA_SECTION.QUOTA]: setQuotaData,
        };
        for (const section of [
          LIVE_DATA_SECTION.DEADLINES,
          LIVE_DATA_SECTION.GPU,
          LIVE_DATA_SECTION.ARXIV,
          LIVE_DATA_SECTION.QUOTA,
        ] as const) {
          refetchSectionLiveDataForSection(section, sectionSetters);
        }

        if (win.label === "main") {
          const labelsFromConfig = activeWidgetLabelsFromConfig(ac);
          if (labelsFromConfig !== null) {
            setActiveWidgets(labelsFromConfig);
          } else {
            setActiveWidgets([
              ...(ac.gpu_enabled !== false ? [serviceWidgetMeta("gpu_enabled").id] : []),
              ...(ac.deadline_enabled !== false ? [serviceWidgetMeta("deadline_enabled").id] : []),
              ...(ac.arxiv_enabled !== false ? [serviceWidgetMeta("arxiv_enabled").id] : []),
              ...(ac.quota_enabled !== false ? [serviceWidgetMeta("quota_enabled").id] : []),
            ]);
          }

          const uWidgetVis = await tauriListen(
            "widget_visibility_changed",
            (event) => {
              if (!active) return;
              const { id, visible } = event.payload;
              setActiveWidgets((prev) => applyWidgetVisibilityChange(prev, id, visible));
            }
          );
          unlisteners.push(() => uWidgetVis());
        }

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

        const u2 = await listenServiceUpdateEvents(
          () => active,
          {
            gpu: { clearRefresh: () => setGpuRefreshError(null) },
            paper: {
              clearRefresh: () => setPaperRefreshError(null),
              clearBackend: () => setPaperError(null),
            },
            arxiv: {
              clearRefresh: () => setArxivRefreshError(null),
              clearBackend: () => setArxivError(null),
            },
            quota: {
              clearRefresh: () => setQuotaRefreshError(null),
              clearBackend: () => setQuotaBackendError(null),
            },
          },
          {
            gpuSetter: setGpuData,
            paperSetter: setDeadlines,
            arxivSetter: setArxivPapers,
            quotaSetter: setQuotaData,
          }
        );
        if (!active) {
          u2();
        } else {
          unlisteners.push(u2);
        }

        const u3b = await listenBackendServiceError(
          "paper_error",
          setPaperError,
          () => active
        );
        if (!active) {
          u3b();
        } else {
          unlisteners.push(() => u3b());
        }

        const u4 = await listenGpuDataSync(setGpuData, () => active);
        if (!active) {
          u4();
        } else {
          unlisteners.push(u4);
        }

        const u4c = await tauriListen("quota_config_update", (event) => {
          if (!active) return;
          setQuotaConfig(event.payload);
        });
        if (!active) {
          u4c();
        } else {
          unlisteners.push(() => u4c());
        }

        const u4d = await tauriListen("app_config_update", (event) => {
          if (!active) return;
          const next = event.payload;
          setAppConfig((prev) => {
            applyServiceDisableClears(prev, next, serviceDisableHandlers);
            if (next?.theme) {
              localStorage.setItem("widgitron-theme", next.theme);
            }
            return next;
          });
          if (win.label === "main") {
            const labels = activeWidgetLabelsFromConfig(next);
            if (labels !== null) {
              setActiveWidgets(labels);
            }
          }
        });
        if (!active) {
          u4d();
        } else {
          unlisteners.push(() => u4d());
        }

        const u5 = await tauriListen("theme_update", (event) => {
          if (!active) return;
          const config = event.payload;
          setThemeConfig(config);
          if (win.label.startsWith("widget-")) {
            setCurrentTheme(resolveWidgetTheme(config, win.label));
          }
        });
        if (!active) {
          u5();
        } else {
          unlisteners.push(() => u5());
        }

        const u6b = await listenBackendServiceError(
          "arxiv_error",
          setArxivError,
          () => active
        );
        if (!active) {
          u6b();
        } else {
          unlisteners.push(() => u6b());
        }

        const u8 = await tauriListen("arxiv_saved_update", async () => {
          try {
            const saved = await fetchArxivSavedPapers();
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

        const u9 = await tauriListen("arxiv_discarded_update", async () => {
          try {
            const discarded = await fetchArxivDiscardedPapers();
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


        const u10b = await listenQuotaMonitorStatus(
          setQuotaMonitorStatus,
          setQuotaBackendError,
          () => active
        );
        if (!active) {
          u10b();
        } else {
          unlisteners.push(() => u10b());
        }

        loadArxivArchiveLists(() => active, setArxivSavedPapers, setArxivDiscardedPapers);

        // Check for updates on startup & every 12 hours in background
        const runUpdateCheck = () => {
          tauriInvoke("check_for_updates")
            .then((res) => {
              if (active) {
                setUpdateInfo(res);
                setUpdateCheckError(null);
              }
            })
            .catch((err) => {
              console.error("Failed to check for updates:", err);
              if (active) {
                setUpdateCheckError(String(err));
              }
            });
        };

        const startupOtaDelay = setTimeout(runUpdateCheck, 8000);
        unlisteners.push(() => clearTimeout(startupOtaDelay));

        const updateInterval = setInterval(runUpdateCheck, 12 * 60 * 60 * 1000);
        unlisteners.push(() => clearInterval(updateInterval));
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
      unlisteners.forEach((f) => f());
    };
  }, []);

  const saveGpuConfig = async (newConfig: GpuConfig) => {
    try {
      await tauriInvoke("save_gpu_config", { config: newConfig });
      setGpuConfig(newConfig);
      const hosts = new Set((newConfig.servers || []).map((s) => s.host));
      setGpuData((prev) => prev.filter((s) => hosts.has(s.host)));
    } catch (e) {
      console.error("Save failed", e);
    }
  };

  const savePaperConfig = async (newConfig: PaperConfig) => {
    try {
      await tauriInvoke("save_paper_config", { config: newConfig });
      setPaperConfig(newConfig);
    } catch (e) {
      console.error("Save failed", e);
    }
  };

  const togglePinConference = async (title: string) => {
    const pinned = paperConfig.pinned_titles || [];
    const nextPinned = pinned.includes(title)
      ? pinned.filter((t) => t !== title)
      : [...pinned, title];
    const nextConfig = { ...paperConfig, pinned_titles: nextPinned };
    await savePaperConfig(nextConfig);
  };

  const onSaveApp = async (config: AppConfig) => {
    setAppConfig(config);
    if (config.theme) localStorage.setItem("widgitron-theme", config.theme);
    await tauriInvoke("save_app_config", { config });
  };

  const handleMasterServiceToggle = createMasterServiceToggleHandler({
    appConfig,
    onSaveApp,
    serviceDisableHandlers,
    onActiveWidgetsChanged,
    serviceToggleCallbacks,
    onClearGeneralError: () => setGeneralServiceRefreshError(null),
  });

  const saveArxivConfig = async (newConfig: ArxivConfig) => {
    try {
      await tauriInvoke("save_arxiv_config", { config: newConfig });
      setArxivConfig(newConfig);
    } catch (e) {
      console.error("Save Arxiv config failed", e);
    }
  };


  const activeArxivPapers = arxivView === "new" ? arxivPapers : arxivView === "saved" ? arxivSavedPapers : arxivDiscardedPapers;
  const arxivKeywordGroups = groupArxivPapersByKeyword(arxivPapers, arxivConfig.keywords);
  const toggleArxivKeywordGroup = (keyword: string) => {
    setCollapsedArxivKeywords((prev) => {
      const next = new Set(prev);
      if (next.has(keyword)) {
        next.delete(keyword);
      } else {
        next.add(keyword);
      }
      return next;
    });
  };

  const renderArxivPaperCard = (paper: ArxivPaper, idx: number) => (
    <div
      key={`${paper.id || paper.title}-${idx}`}
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
              onClick={() => tauriInvoke("remove_arxiv_saved_paper", { id: paper.id })}
              className="p-2 rounded-xl bg-red-500/10 text-red-400 hover:bg-red-50 hover:text-white transition-all"
              title="Remove from saved"
            >
              <Trash2 size={14} />
            </button>
          )}
          {arxivView === "discarded" && (
            <button
              onClick={() => tauriInvoke("remove_arxiv_discarded_paper", { id: paper.id })}
              className="p-2 rounded-xl bg-red-500/10 text-red-400 hover:bg-red-50 hover:text-white transition-all"
              title="Delete permanently"
            >
              <Trash2 size={14} />
            </button>
          )}
          <button
            onClick={() => tauriInvoke("open_link", { url: paper.link })}
            className="p-2 rounded-xl bg-white/5 text-slate-400 hover:text-white transition-colors"
            title="Open paper"
          >
            <ExternalLink size={14} />
          </button>
        </div>
      </div>
    </div>
  );
  const saveQuotaConfig = async (newConfig: QuotaConfig) => {
    setQuotaConfig(newConfig);

    try {
      await tauriInvoke("save_quota_config", { config: newConfig });
    } catch (e) {
      console.error("Save quota config failed", e);
    }
  };

  const onSaveThemes = async (config: WidgetThemeConfig) => {
    setThemeConfig(config);
    await tauriInvoke("save_theme_config", { config });
  };

  const toggleMaximize = async () => {
    try {
      await appWindow.toggleMaximize();
    } catch (e) {
      console.error(e);
    }
  };

  const handleToggleWidget = async (id: string, title: string) => {
    if (pendingToggles.has(id)) return;
    setPendingToggles((prev) => new Set(prev).add(id));
    setToggleWidgetError(null);

    try {
      const newVisible = await invokeToggleWidget(id, title);
      setActiveWidgets((prev) => applyWidgetVisibilityChange(prev, id, newVisible));
    } catch (e) {
      const message = String(e);
      console.error("Toggle failed", e);
      setToggleWidgetError(formatWidgetToggleError(message));
    } finally {
      setPendingToggles((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
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
        await tauriInvoke("set_desktop_mode", { label: windowLabel, enabled: false });
      } else {
        // Locking: If not pinned, re-embed
        if (!isPinned) {
          await tauriInvoke("set_desktop_mode", { label: windowLabel, enabled: true });
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
        await tauriInvoke("set_desktop_mode", { label: targetLabel, enabled: false });
        await targetWin?.setAlwaysOnTop(true);
      } else {
        // Turning OFF Always on Top: Enable Desktop Mode (Embedded)
        await targetWin?.setAlwaysOnTop(false);
        await tauriInvoke("set_desktop_mode", { label: targetLabel, enabled: true });
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
        await tauriInvoke("close_widget", { id: windowLabel });
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
          onClick={() => tauriInvoke("show_main")}
          className="w-full flex items-center gap-3 px-3 py-2 rounded-md hover:bg-slate-100 text-slate-700 transition-colors group"
        >
          <LayoutDashboard
            size={14}
            className="text-slate-500 group-hover:text-blue-600 transition-colors"
          />
          <span className="text-[11px] font-bold">Dashboard</span>
        </button>
        <button
          onClick={() => tauriInvoke("exit_app")}
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
            label={LIVE_DATA_SECTION_LABELS.quota}
            active={activeTab === LIVE_DATA_SECTION.QUOTA}
            onClick={() => setActiveTab(LIVE_DATA_SECTION.QUOTA)}
            theme={appConfig.theme}
          />
          <SidebarLink
            icon={<Cpu size={20} />}
            label={LIVE_DATA_SECTION_LABELS.gpu}
            active={activeTab === LIVE_DATA_SECTION.GPU}
            onClick={() => setActiveTab(LIVE_DATA_SECTION.GPU)}
            theme={appConfig.theme}
          />
          <SidebarLink
            icon={<Calendar size={20} />}
            label={LIVE_DATA_SECTION_LABELS.deadlines}
            active={activeTab === LIVE_DATA_SECTION.DEADLINES}
            onClick={() => setActiveTab(LIVE_DATA_SECTION.DEADLINES)}
            theme={appConfig.theme}
          />
          <SidebarLink
            icon={<Activity size={20} />}
            label={LIVE_DATA_SECTION_LABELS.arxiv}
            active={activeTab === LIVE_DATA_SECTION.ARXIV}
            onClick={() => setActiveTab(LIVE_DATA_SECTION.ARXIV)}
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
            badge={updateInfo?.has_update ? (
              <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse shadow-[0_0_8px_#f59e0b]" />
            ) : undefined}
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
            {appTabLabel(activeTab)}
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
          <DashboardServiceToggleError
            activeTab={activeTab}
            error={generalServiceRefreshError}
            theme={appConfig.theme}
            dismissed={serviceToggleErrorDismissed}
            onDismiss={() => setServiceToggleErrorDismissed(true)}
          />
          <AnimatePresence mode="wait">
            {activeTab === "dashboard" && (
              <motion.div
                key="dashboard"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-8"
              >
                <ToggleErrorBanner
                  message={toggleWidgetError}
                  onDismiss={() => setToggleWidgetError(null)}
                  theme={appConfig.theme}
                />
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-6">
                  <StatCard
                    label="Total GPUs"
                    value={totalGpus.toString()}
                    icon={<Cpu className="text-purple-400" />}
                    theme={appConfig.theme}
                    hint={gpuStatHint}
                    hintTone={gpuStatHintTone}
                  />
                  <StatCard
                    label="Active Deadlines"
                    value={deadlines.length.toString()}
                    icon={<Calendar className="text-emerald-400" />}
                    theme={appConfig.theme}
                    hint={paperStatHint}
                    hintTone={paperStatHintTone}
                  />
                  <StatCard
                    label="Arxiv Radar"
                    value={arxivPapers.length.toString()}
                    icon={<Activity className="text-pink-400" />}
                    theme={appConfig.theme}
                    hint={arxivStatHint}
                    hintTone={arxivStatHintTone}
                  />
                  <StatCard
                    label="Monitored Agents"
                    value={monitoredAgentCount}
                    icon={<Gauge className="text-cyan-400" />}
                    theme={appConfig.theme}
                    hint={quotaStatHint}
                    hintTone={quotaStatHintTone}
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
                    {QUICK_LAUNCH_WIDGETS.map(({ field, color, detail }) => {
                      if (appConfig[field] === false) return null;
                      const { id, title } = serviceWidgetMeta(field);
                      return (
                        <WidgetPreviewCard
                          key={id}
                          title={`${title} Widget`}
                          status={activeWidgets.includes(id) ? "Active" : "Ready"}
                          detail={detail}
                          trend={activeWidgets.includes(id) ? "Hide Widget" : "Show Widget"}
                          color={color}
                          theme={appConfig.theme}
                          loading={pendingToggles.has(id)}
                          disabled={pendingToggles.has(id)}
                          onLaunch={() => handleToggleWidget(id, title)}
                        />
                      );
                    })}
                  </div>
                </div>
              </motion.div>
            )}

            {activeTab === LIVE_DATA_SECTION.GPU && (
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
                    {appConfig.gpu_enabled !== false && (
                      <button
                        onClick={handleRefreshGpu}
                        disabled={isRefreshingGpu}
                        className={`p-2 rounded-xl border transition-all ${
                          appConfig.theme === "light"
                            ? "border-slate-200 hover:bg-slate-100 text-slate-600"
                            : "border-white/10 hover:bg-white/5 text-slate-400"
                        }`}
                        title="Restart GPU workers"
                      >
                        <RefreshCw size={14} className={isRefreshingGpu ? "animate-spin" : ""} />
                      </button>
                    )}
                    <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                      {appConfig.gpu_enabled !== false ? "Service Enabled" : "Service Disabled"}
                    </span>
                    <MasterSwitch
                      enabled={appConfig.gpu_enabled !== false}
                      loading={checkServiceToggleBusy("gpu_enabled")}
                      disabled={checkServiceToggleBusy("gpu_enabled")}
                      onToggle={(val) => handleMasterServiceToggle("gpu_enabled", val)}
                    />
                  </div>
                </div>
                <ServiceErrorBanners
                  refreshOnly
                  refreshError={gpuRefreshError}
                  onDismissRefresh={() => setGpuRefreshError(null)}
                  theme={appConfig.theme}
                  refreshCachedLabel={gpuRefreshCachedLabel(visibleGpuData.length > 0)}
                />
                <div className="space-y-6">
                  {visibleGpuData.length === 0 ? (
                    <div className="p-12 text-center bg-black/5 rounded-3xl border border-dashed border-white/10 text-slate-500 font-bold uppercase tracking-widest text-xs">
                      No active data. Configure servers in Settings.
                    </div>
                  ) : (
                    visibleGpuData.map((server, idx) => {
                      const hasCachedGpus =
                        Array.isArray(server.gpu_list) && server.gpu_list.length > 0;
                      const showStaleOffline = !server.is_online && hasCachedGpus;

                      return (
                      <div key={idx} className="glass-card p-6">
                        <div className="flex items-center justify-between mb-6">
                          <div className="flex items-center gap-3">
                            <div
                              className={`w-3 h-3 rounded-full ${
                                server.is_online
                                  ? "bg-emerald-500 shadow-[0_0_10px_#10b981]"
                                  : showStaleOffline
                                  ? "bg-amber-500 shadow-[0_0_10px_#f59e0b]"
                                  : "bg-red-500"
                              }`}
                            />
                            <span
                              className={`text-lg font-bold ${
                                appConfig.theme === "light" ? "text-slate-900" : "text-white"
                              }`}
                            >
                              {server.host}
                            </span>
                            {showStaleOffline && (
                              <span className="text-[10px] font-black uppercase tracking-widest text-amber-400">
                                Offline · cached
                              </span>
                            )}
                          </div>
                          <span className="text-xs font-black text-slate-500 uppercase tracking-widest">
                            {server.gpu_list.length} GPUs Detected
                          </span>
                        </div>
                        <div className="space-y-8">
                          {(() => {
                            const groups: Record<string, GpuInfo[]> = {};
                            server.gpu_list.forEach((gpu) => {
                              const gid = gpu.job_id || "SYSTEM";
                              if (!groups[gid]) groups[gid] = [];
                              groups[gid].push(gpu);
                            });

                            return sortGpuJobGroups(groups).map(([jobId, gpus]) => (
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
                                            <div
                                              className={`h-full rounded-full transition-[width] duration-300 ${gpu.util > 80 ? "bg-red-500" : "bg-blue-500"}`}
                                              style={{ width: `${gpu.util}%` }}
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
                          <p
                            className={`mt-4 text-[10px] italic font-medium break-all ${
                              showStaleOffline ? "text-amber-400/80" : "text-red-400/60"
                            }`}
                          >
                            {server.error}
                          </p>
                        )}
                      </div>
                    );
                    })
                  )}
                </div>
              </motion.div>
            )}

            {activeTab === LIVE_DATA_SECTION.DEADLINES && (
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
                    {appConfig.deadline_enabled !== false && (
                      <button
                        onClick={handleRefreshDeadlines}
                        disabled={isRefreshingDeadlines}
                        className={`p-2 rounded-xl border transition-all ${
                          appConfig.theme === "light"
                            ? "border-slate-200 hover:bg-slate-100 text-slate-600"
                            : "border-white/10 hover:bg-white/5 text-slate-400"
                        }`}
                        title="Refresh Deadlines"
                      >
                        <RefreshCw size={14} className={isRefreshingDeadlines ? "animate-spin" : ""} />
                      </button>
                    )}
                    <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                      {appConfig.deadline_enabled !== false ? "Service Enabled" : "Service Disabled"}
                    </span>
                    <MasterSwitch
                      enabled={appConfig.deadline_enabled !== false}
                      loading={checkServiceToggleBusy("deadline_enabled")}
                      disabled={checkServiceToggleBusy("deadline_enabled")}
                      onToggle={(val) => handleMasterServiceToggle("deadline_enabled", val)}
                    />
                  </div>
                </div>
                <ServiceErrorBanners
                  backendError={paperError}
                  refreshError={paperRefreshError}
                  onDismissBackend={() => setPaperError(null)}
                  onDismissRefresh={() => setPaperRefreshError(null)}
                  theme={appConfig.theme}
                  showBackend={appConfig.deadline_enabled !== false}
                  backendCachedLabel={cachedLabelWhen(
                    deadlines.length > 0,
                    CACHED_LABELS.deadlines.backend
                  )}
                  refreshCachedLabel={cachedLabelWhen(
                    deadlines.length > 0,
                    CACHED_LABELS.deadlines.refresh
                  )}
                />
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

            {activeTab === LIVE_DATA_SECTION.ARXIV && (
              <motion.div
                key="arxiv"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
              >
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
                      loading={checkServiceToggleBusy("arxiv_enabled")}
                      disabled={checkServiceToggleBusy("arxiv_enabled")}
                      onToggle={(val) => handleMasterServiceToggle("arxiv_enabled", val)}
                    />
                  </div>
                </div>
                <ServiceErrorBanners
                  backendError={arxivError}
                  refreshError={arxivRefreshError}
                  onDismissBackend={() => setArxivError(null)}
                  onDismissRefresh={() => setArxivRefreshError(null)}
                  theme={appConfig.theme}
                  showBackend={appConfig.arxiv_enabled !== false}
                  backendCachedLabel={cachedLabelWhen(
                    arxivPapers.length > 0,
                    CACHED_LABELS.arxiv.backend
                  )}
                  refreshCachedLabel={cachedLabelWhen(
                    arxivPapers.length > 0,
                    CACHED_LABELS.arxiv.refresh
                  )}
                />
                {activeArxivPapers.length === 0 ? (
                  <div className="p-12 text-center bg-black/5 rounded-3xl border border-dashed border-white/10 text-slate-500 font-bold uppercase tracking-widest text-xs">
                    {arxivView === "new"
                      ? "No new papers. Adjust keywords in Settings or wait for update."
                      : arxivView === "saved"
                      ? "No saved papers yet. Swipe right on the widget to save!"
                      : "No discarded papers. Swipe left on the widget to discard."}
                  </div>
                ) : arxivView === "new" ? (
                  <div className="space-y-5">
                    {arxivKeywordGroups.map((group) => {
                      const collapsed = collapsedArxivKeywords.has(group.keyword);
                      return (
                        <section
                          key={group.keyword}
                          className={`border border-[var(--dashboard-border)] rounded-2xl overflow-hidden ${
                            appConfig.theme === "light" ? "bg-white" : "bg-white/5"
                          }`}
                        >
                          <button
                            type="button"
                            onClick={() => toggleArxivKeywordGroup(group.keyword)}
                            className={`w-full px-5 py-4 flex items-center justify-between text-left transition-colors ${
                              appConfig.theme === "light" ? "hover:bg-slate-50" : "hover:bg-white/5"
                            }`}
                          >
                            <div className="min-w-0">
                              <h3
                                className={`text-sm font-black truncate ${
                                  appConfig.theme === "light" ? "text-slate-900" : "text-white"
                                }`}
                              >
                                {formatArxivKeywordLabel(group.keyword)}
                              </h3>
                              <div className="mt-1 text-[10px] font-black uppercase tracking-widest text-slate-500">
                                {group.papers.length} papers
                              </div>
                            </div>
                            <ChevronDown
                              size={16}
                              className={`shrink-0 text-slate-500 transition-transform ${collapsed ? "-rotate-90" : ""}`}
                            />
                          </button>
                          {!collapsed && (
                            <div className="p-5 pt-0 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                              {group.papers.map((paper, idx) => renderArxivPaperCard(paper, idx))}
                            </div>
                          )}
                        </section>
                      );
                    })}
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {activeArxivPapers.map((paper, idx) => renderArxivPaperCard(paper, idx))}
                  </div>
                )}
              </motion.div>
            )}

            {activeTab === LIVE_DATA_SECTION.QUOTA && (
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
                    {appConfig.quota_enabled !== false && (
                      <button
                        onClick={handleRefreshQuota}
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
                    )}
                    <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                      {appConfig.quota_enabled !== false ? "Service Enabled" : "Service Disabled"}
                    </span>
                    <MasterSwitch
                      enabled={appConfig.quota_enabled !== false}
                      loading={checkServiceToggleBusy("quota_enabled")}
                      disabled={checkServiceToggleBusy("quota_enabled")}
                      onToggle={(val) => handleMasterServiceToggle("quota_enabled", val)}
                    />
                  </div>
                </div>
                <ServiceErrorBanners
                  backendError={quotaBackendError}
                  refreshError={quotaRefreshError}
                  onDismissBackend={() => setQuotaBackendError(null)}
                  onDismissRefresh={() => setQuotaRefreshError(null)}
                  theme={appConfig.theme}
                  showBackend={appConfig.quota_enabled !== false}
                  backendCachedLabel={cachedLabelWhen(
                    visibleQuotaData.length > 0,
                    CACHED_LABELS.quota.backend
                  )}
                  refreshCachedLabel={cachedLabelWhen(
                    visibleQuotaData.length > 0,
                    CACHED_LABELS.quota.refresh
                  )}
                />
                
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {visibleQuotaData.length === 0 ? (
                    <div className="col-span-full p-12 text-center bg-black/5 rounded-3xl border border-dashed border-white/10 text-slate-500 font-bold uppercase tracking-widest text-xs">
                      No agents configured. Go to Settings to add one.
                    </div>
                  ) : (
                    visibleQuotaData.map((q) => {
                      const hasValue = q.current_value !== null && q.current_value !== undefined;
                      const hasMax = hasValue && q.max_quota !== undefined && q.max_quota !== null && q.max_quota > 0;
                      const current = q.current_value ?? 0;
                      const max = q.max_quota ?? 100;
                      const percent = hasMax ? Math.min(100, Math.max(0, (current / max) * 100)) : 100;
                      
                      let barColor = "bg-cyan-500";
                      let textColor = "text-cyan-400";
                      if (!hasValue) {
                        textColor = appConfig.theme === "light" ? "text-slate-400" : "text-slate-500";
                      } else if (hasMax) {
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
                        q.provider === "copilot" ||
                        q.provider === "pioneer" ||
                        q.provider === "qoder-cn" ||
                        q.provider === "claude-code";

                      const isMultiBar =
                        hasValue &&
                        usesQuotaBarLayout &&
                        ((q.bars && q.bars.length > 0) ||
                          q.provider === "copilot" ||
                          (q.secondary_value !== undefined && q.secondary_value !== null) ||
                          (q.tertiary_value !== undefined && q.tertiary_value !== null));

                      const bars: QuotaBarDisplay[] =
                        q.bars && q.bars.length > 0
                          ? q.bars.map((bar) => ({
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
                                  {hasValue ? (
                                    <>
                                      {q.unit === "%"
                                        ? Math.round(current)
                                        : current.toFixed(current % 1 === 0 ? 0 : 2)}
                                      {q.unit === "%" ? "%" : q.unit ? ` ${q.unit}` : ""}
                                      {hasMax && q.unit !== "%" && ` / ${max}`}
                                    </>
                                  ) : (
                                    "-"
                                  )}
                                </span>
                              )}
                            </div>

                            {isMultiBar ? (
                              <div className="space-y-3">
                                {bars.map((bar, i) => {
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
                              <div className={`mt-2 text-xs italic p-3 rounded-xl border ${
                                isStaleQuotaWarning(q.error_msg) && quotaHasDisplayValue(q)
                                  ? "text-amber-400 bg-amber-500/5 border-amber-500/15"
                                  : "text-red-400 bg-red-500/5 border-red-500/10"
                              }`}>
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
                updateInfo={updateInfo}
                setUpdateInfo={setUpdateInfo}
                updateCheckError={updateCheckError}
                setUpdateCheckError={setUpdateCheckError}
              />
            )}
          </AnimatePresence>
        </div>
      </main>
    </div>
  );
}

export default App;
