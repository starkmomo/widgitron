import { useState, useEffect, useRef, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
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
  Bell,
  Pin,
  PinOff,
  Trophy,
  Copy,
  ExternalLink,
  Trash2,
  RefreshCw,
  Gauge,
  GripVertical,
  Maximize2,
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
import { hexToRgba, isLightColor } from "./utils/color";
import { listenBackendServiceError } from "./utils/backendServiceError";
import { listenQuotaMonitorStatus, type QuotaMonitorStatus } from "./utils/quotaMonitorStatus";
import { listenServiceUpdateEvents } from "./utils/serviceUpdateEvents";
import { listenGpuDataSync } from "./utils/gpuDataSync";
import { isLiveDataSection, LIVE_DATA_SECTION, refetchSectionLiveDataForSection, appTabLabel, LIVE_DATA_SECTION_LABELS, type AppTab } from "./utils/sectionLiveData";
import { fetchArxivSavedPapers, fetchArxivDiscardedPapers, loadArxivArchiveLists } from "./utils/arxivArchive";
import { formatArxivKeywordLabel, groupArxivPapersByKeyword } from "./utils/arxivKeywords";
import type { AppConfig, ArxivConfig, ArxivPaper, GpuConfig, GpuInfo, PaperConfig, PaperDeadlineInfo, QuotaBarDisplay, QuotaConfig, QuotaItem, ServerGpuData } from "./types/config";
import type { SidebarDockState, UpdateInfo } from "./types/tauri";
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
import { deadlineInstanceKey } from "./utils/deadlineKeys";
import { resolveSidebarTheme, type ResolvedSidebarTheme } from "./utils/sidebarTheme";
import {
  compactSidebarTileLayout,
  findSidebarInsertionGuide,
  insertSidebarTileAtGuide,
  reconcileSidebarTileVisibility,
  resolveSidebarTileCollisions,
  resizeSidebarTileRect,
  sidebarRectsOverlap,
  sidebarRowsFromLayout,
  sidebarTileWithinBounds,
  SIDEBAR_TILE_GAP,
  SIDEBAR_TILE_MIN_HEIGHT,
  SIDEBAR_TILE_MIN_WIDTH_RATIO,
  type SidebarCollisionAxis,
  type SidebarInsertionGuide,
  type SidebarSectionKey,
  type SidebarResizeDirection,
  type SidebarTileRect,
} from "./utils/sidebarTileLayout";
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

const DEFAULT_SIDEBAR_ORDER: SidebarSectionKey[] = ["quota", "gpu", "deadlines", "arxiv"];

const LEGACY_SIDEBAR_GRID_COLUMNS = 4;
const LEGACY_SIDEBAR_GRID_GAP = 8;
const LEGACY_SIDEBAR_GRID_ROW_HEIGHT = 72;
const SIDEBAR_WINDOW_RESIZE_GUTTER = 16;
const SIDEBAR_SCROLL_BOTTOM_GAP = 12;

const DEFAULT_SIDEBAR_TILE_LAYOUT: Record<SidebarSectionKey, SidebarTileRect> = {
  quota: { x: 0, y: 0, w: 1, h: 152 },
  gpu: { x: 0, y: 160, w: 1, h: 312 },
  deadlines: { x: 0, y: 480, w: 1, h: 152 },
  arxiv: { x: 0, y: 640, w: 1, h: 312 },
};

type SidebarSectionDefinition = {
  key: SidebarSectionKey;
  title: string;
  accentColor: string;
  content: ReactNode;
};

type NativeResizeDirection =
  | "North"
  | "South"
  | "East"
  | "West";

const SIDEBAR_RESIZE_HANDLES: Array<{
  direction: SidebarResizeDirection;
  className: string;
}> = [
  { direction: "n", className: "top-0 left-2 right-2 h-1.5 cursor-n-resize" },
  { direction: "s", className: "bottom-0 left-2 right-2 h-1.5 cursor-s-resize" },
  { direction: "e", className: "right-0 top-2 bottom-2 w-1.5 cursor-e-resize" },
  { direction: "w", className: "left-0 top-2 bottom-2 w-1.5 cursor-w-resize" },
  { direction: "ne", className: "right-0 top-0 w-2.5 h-2.5 cursor-ne-resize" },
  { direction: "nw", className: "left-0 top-0 w-2.5 h-2.5 cursor-nw-resize" },
  { direction: "sw", className: "left-0 bottom-0 w-2.5 h-2.5 cursor-sw-resize" },
  { direction: "se", className: "right-0 bottom-0 w-5 h-5 cursor-se-resize" },
];

const normalizeSidebarOrder = (order?: string[]): SidebarSectionKey[] => {
  const keys = new Set<SidebarSectionKey>(DEFAULT_SIDEBAR_ORDER);
  const normalized = (order || []).filter((key): key is SidebarSectionKey =>
    keys.has(key as SidebarSectionKey)
  );
  for (const key of DEFAULT_SIDEBAR_ORDER) {
    if (!normalized.includes(key)) normalized.push(key);
  }
  return normalized;
};

const normalizeSidebarTileLayout = (
  layout?: Record<string, Partial<SidebarTileRect>>,
  keys: SidebarSectionKey[] = DEFAULT_SIDEBAR_ORDER
): Record<SidebarSectionKey, SidebarTileRect> => {
  const normalizeRect = (key: SidebarSectionKey): SidebarTileRect => {
    const fallback = DEFAULT_SIDEBAR_TILE_LAYOUT[key];
    const source = layout?.[key];
    const hasLegacyColumns =
      (typeof source?.w === "number" && Number.isFinite(source.w) && source.w > 1) ||
      (typeof source?.x === "number" && Number.isFinite(source.x) && source.x > 1);

    if (source && hasLegacyColumns) {
      const legacyW =
        typeof source.w === "number" && Number.isFinite(source.w)
          ? source.w
          : fallback.w * LEGACY_SIDEBAR_GRID_COLUMNS;
      const legacyH =
        typeof source.h === "number" && Number.isFinite(source.h)
          ? source.h
          : Math.max(
              1,
              Math.round(
                (fallback.h + LEGACY_SIDEBAR_GRID_GAP) /
                  (LEGACY_SIDEBAR_GRID_ROW_HEIGHT + LEGACY_SIDEBAR_GRID_GAP)
              )
            );
      const legacyX =
        typeof source.x === "number" && Number.isFinite(source.x)
          ? source.x
          : fallback.x * LEGACY_SIDEBAR_GRID_COLUMNS;
      const legacyY =
        typeof source.y === "number" && Number.isFinite(source.y)
          ? source.y
          : Math.round(fallback.y / (LEGACY_SIDEBAR_GRID_ROW_HEIGHT + LEGACY_SIDEBAR_GRID_GAP));
      const w = Math.min(
        1,
        Math.max(SIDEBAR_TILE_MIN_WIDTH_RATIO, legacyW / LEGACY_SIDEBAR_GRID_COLUMNS)
      );
      const x = Math.min(1 - w, Math.max(0, legacyX / LEGACY_SIDEBAR_GRID_COLUMNS));
      const y = Math.max(0, legacyY * (LEGACY_SIDEBAR_GRID_ROW_HEIGHT + LEGACY_SIDEBAR_GRID_GAP));
      const h = Math.max(
        SIDEBAR_TILE_MIN_HEIGHT,
        legacyH * LEGACY_SIDEBAR_GRID_ROW_HEIGHT + Math.max(0, legacyH - 1) * LEGACY_SIDEBAR_GRID_GAP
      );
      return { x, y, w, h };
    }

    const w =
      typeof source?.w === "number" && Number.isFinite(source.w)
        ? Math.min(1, Math.max(SIDEBAR_TILE_MIN_WIDTH_RATIO, source.w))
        : fallback.w;
    const h =
      typeof source?.h === "number" && Number.isFinite(source.h)
        ? Math.max(SIDEBAR_TILE_MIN_HEIGHT, source.h)
        : fallback.h;
    const x =
      typeof source?.x === "number" && Number.isFinite(source.x)
        ? Math.min(1 - w, Math.max(0, source.x))
        : fallback.x;
    const y =
      typeof source?.y === "number" && Number.isFinite(source.y)
        ? Math.max(0, source.y)
        : fallback.y;
    return { x, y, w, h };
  };

  const result = {
    quota: normalizeRect("quota"),
    gpu: normalizeRect("gpu"),
    deadlines: normalizeRect("deadlines"),
    arxiv: normalizeRect("arxiv"),
  };

  const visibleKeys = [...new Set(keys)];
  const placed: SidebarSectionKey[] = [];
  for (const key of visibleKeys) {
    let overlapping = placed.filter((otherKey) =>
      sidebarRectsOverlap(result[key], result[otherKey])
    );
    while (overlapping.length > 0) {
      result[key] = {
        ...result[key],
        y: Math.max(
          ...overlapping.map(
            (otherKey) => result[otherKey].y + result[otherKey].h + SIDEBAR_TILE_GAP
          )
        ),
      };
      overlapping = placed.filter((otherKey) =>
        sidebarRectsOverlap(result[key], result[otherKey])
      );
    }
    placed.push(key);
  }

  return compactSidebarTileLayout(result, visibleKeys);
};

function SidebarWidgetSection({
  title,
  accentColor,
  theme,
  isLight,
  onClose,
  onMoveStart,
  onResizeStart,
  children,
}: {
  title: string;
  accentColor: string;
  theme: ResolvedSidebarTheme;
  isLight: boolean;
  onClose: () => void;
  onMoveStart: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onResizeStart: (
    event: ReactPointerEvent<HTMLButtonElement>,
    direction: SidebarResizeDirection
  ) => void;
  children: ReactNode;
}) {
  return (
    <section
      className="group/sidebar-tile h-full min-h-0 rounded-md border overflow-hidden flex flex-col relative"
      style={{
        backgroundColor: isLight
          ? hexToRgba("#ffffff", theme.card_opacity)
          : hexToRgba(theme.background, theme.card_opacity),
        borderColor: hexToRgba(accentColor, isLight ? 0.28 : 0.22),
        boxShadow: `inset 0 2px 0 ${hexToRgba(accentColor, 0.62)}`,
        backdropFilter: theme.blur > 0 ? `blur(${Math.min(theme.blur, 18)}px) saturate(135%)` : undefined,
        WebkitBackdropFilter: theme.blur > 0 ? `blur(${Math.min(theme.blur, 18)}px) saturate(135%)` : undefined,
      }}
    >
      <div
        className="h-5 shrink-0 px-1.5 flex items-center justify-between border-b cursor-grab active:cursor-grabbing touch-none"
        style={{
          backgroundColor: hexToRgba(
            accentColor,
            Math.min(0.16, Math.max(0.05, theme.card_opacity * 0.14))
          ),
          borderColor: hexToRgba(accentColor, isLight ? 0.16 : 0.12),
        }}
        onPointerDown={onMoveStart}
      >
        <div className="flex items-center gap-1 min-w-0">
          <GripVertical
            size={9}
            className={isLight ? "text-slate-400" : "text-slate-500"}
          />
          <span
            className="w-1.5 h-1.5 rounded-full"
            style={{ backgroundColor: accentColor }}
          />
          <span className="sr-only">Move {title}</span>
        </div>
        <div className="flex items-center gap-1" onPointerDown={(event) => event.stopPropagation()}>
          <button
            type="button"
            onClick={onClose}
            className={`w-4 h-4 flex items-center justify-center rounded opacity-45 group-hover/sidebar-tile:opacity-100 focus:opacity-100 transition-all ${
              isLight
                ? "text-slate-500 hover:text-red-600 hover:bg-red-50"
                : "text-slate-500 hover:text-white hover:bg-white/10"
            }`}
            title={`Hide ${title}`}
          >
            <X size={10} />
          </button>
        </div>
      </div>
      <div className="flex-1 min-h-0 p-2 overflow-hidden">{children}</div>
      {SIDEBAR_RESIZE_HANDLES.map((handle) => (
        <button
          key={handle.direction}
          type="button"
          onPointerDown={(event) => onResizeStart(event, handle.direction)}
          className={`absolute z-30 touch-none transition-colors ${handle.className} ${
            handle.direction === "se"
              ? `flex items-center justify-center rounded-md opacity-55 group-hover/sidebar-tile:opacity-100 ${
                  isLight
                    ? "text-slate-500 hover:text-slate-900 hover:bg-slate-100/80"
                    : "text-white/50 hover:text-white hover:bg-white/10"
                }`
              : "opacity-0 hover:opacity-100 hover:bg-blue-400/25"
          }`}
          aria-label={`Resize ${title} from ${handle.direction}`}
          title={`Resize ${title}`}
        >
          {handle.direction === "se" ? <Maximize2 size={12} /> : null}
        </button>
      ))}
    </section>
  );
}

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
  const [sidebarTileLayoutDraft, setSidebarTileLayoutDraft] =
    useState<Record<SidebarSectionKey, SidebarTileRect> | null>(null);
  const [activeSidebarTile, setActiveSidebarTile] = useState<SidebarSectionKey | null>(null);
  const [sidebarTileDragPreview, setSidebarTileDragPreview] = useState<{
    key: SidebarSectionKey;
    rect: SidebarTileRect;
  } | null>(null);
  const [sidebarInsertionGuide, setSidebarInsertionGuide] =
    useState<SidebarInsertionGuide | null>(null);
  const [sidebarDockState, setSidebarDockState] = useState<SidebarDockState>({
    edge: "right",
    pinned: false,
    expanded: false,
    dragging: false,
    preview_edge: null,
  });
  const sidebarOrderRef = useRef<SidebarSectionKey[]>(DEFAULT_SIDEBAR_ORDER);
  const sidebarBoardRef = useRef<HTMLDivElement | null>(null);
  const sidebarScrollRef = useRef<HTMLDivElement | null>(null);
  const prevActiveTabRef = useRef(activeTab);

  // Any persisted sidebar layout update (including one made in the Settings
  // window) supersedes a local drag draft. Keeping an old draft was the cause
  // of hidden tiles reappearing at stale, overlapping coordinates.
  useEffect(() => {
    setSidebarTileLayoutDraft(null);
  }, [appConfig.sidebar_tile_layout, appConfig.sidebar_widgets, appConfig.sidebar_order]);

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
          if (!active) {
            uTheme();
          } else {
            unlisteners.push(() => uTheme());
          }
          const uAppConfig = await tauriListen("app_config_update", (event) => {
            if (!active) return;
            const nextConfig = event.payload;
            setAppConfig(nextConfig);
            setIsPinned(nextConfig.always_on_top?.[label] ?? false);
          });
          if (!active) {
            uAppConfig();
          } else {
            unlisteners.push(() => uAppConfig());
          }
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
          if (!active) {
            uWidgetVis();
          } else {
            unlisteners.push(() => uWidgetVis());
          }
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

        if (win.label === "main") {
          // Check for updates on startup & every 12 hours in background.
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
        }
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
            console.error(`Error checking ${win.label} visibility on focus change:`, err);
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

  const togglePinDeadline = async (deadline: PaperDeadlineInfo) => {
    const key = deadlineInstanceKey(deadline);
    const pinned = paperConfig.pinned_deadline_ids || [];
    const nextPinned = pinned.includes(key)
      ? pinned.filter((item) => item !== key)
      : [...pinned, key];
    const nextConfig = { ...paperConfig, pinned_deadline_ids: nextPinned };
    await savePaperConfig(nextConfig);
  };

  const toggleSubscribeConference = async (title: string) => {
    const subscribed = paperConfig.subscribed_titles || [];
    const titleKey = title.toLowerCase();
    const nextSubscribed = subscribed.some((t) => t.toLowerCase() === titleKey)
      ? subscribed.filter((t) => t.toLowerCase() !== titleKey)
      : [...subscribed, title];
    const nextConfig = { ...paperConfig, subscribed_titles: nextSubscribed };
    await savePaperConfig(nextConfig);
  };

  const onSaveApp = async (config: AppConfig) => {
    setAppConfig(config);
    if (config.theme) localStorage.setItem("widgitron-theme", config.theme);
    await tauriInvoke("save_app_config", { config });
  };

  const saveSidebarWidgetVisibility = async (key: SidebarSectionKey, visible: boolean) => {
    const sidebarWidgets = appConfig.sidebar_widgets || {};
    const currentOrder = normalizeSidebarOrder(appConfig.sidebar_order);
    const currentVisibleKeys = currentOrder.filter(
      (candidateKey) => sidebarWidgets[candidateKey] !== false
    );
    const alreadyVisible = currentVisibleKeys.includes(key);
    if (alreadyVisible === visible) return;

    // Re-enabled widgets are intentionally ordered last so their freshly
    // allocated tile becomes the new bottom row rather than revisiting a
    // historic coordinate near the top of the board.
    const nextOrder = visible
      ? [...currentOrder.filter((candidateKey) => candidateKey !== key), key]
      : currentOrder;
    const nextWidgets = { ...sidebarWidgets, [key]: visible };
    const nextVisibleKeys = nextOrder.filter(
      (candidateKey) => nextWidgets[candidateKey] !== false
    );
    const sourceLayout =
      sidebarTileLayoutDraft ??
      normalizeSidebarTileLayout(appConfig.sidebar_tile_layout, currentVisibleKeys);
    const nextLayout = reconcileSidebarTileVisibility(
      sourceLayout,
      currentVisibleKeys,
      nextVisibleKeys
    );

    sidebarOrderRef.current = nextOrder;
    setSidebarTileLayoutDraft(nextLayout);
    await onSaveApp({
      ...appConfig,
      sidebar_order: nextOrder,
      sidebar_tile_layout: nextLayout,
      sidebar_widgets: nextWidgets,
    });
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

      const nextConfig = await tauriInvoke("set_widget_always_on_top", {
        label: targetLabel,
        pinned: next,
      });
      setAppConfig(nextConfig);
      if (targetLabel === windowLabel) {
        setIsPinned(next);
      }
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
      } else if (windowLabel === "sidebar") {
        await tauriInvoke("hide_sidebar");
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
        if (windowLabel === "sidebar") {
          e.preventDefault();
          const nextState = await tauriInvoke("begin_sidebar_drag");
          setSidebarDockState(nextState);
          return;
        }
        await getCurrentWindow().startDragging();
      } catch (e) {
        console.error("Drag failed", e);
      }
    }
  };

  useEffect(() => {
    if (windowLabel !== "sidebar") return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        tauriInvoke("hide_sidebar").catch(console.error);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [windowLabel]);

  useEffect(() => {
    if (windowLabel !== "sidebar") return;

    let active = true;
    let unlisten: (() => void) | undefined;
    const initializeDockState = async () => {
      const stopListening = await tauriListen("sidebar_state_update", (event) => {
        if (active) setSidebarDockState(event.payload);
      });
      if (!active) {
        stopListening();
        return;
      }
      unlisten = stopListening;
      const state = await tauriInvoke("get_sidebar_state");
      if (active) setSidebarDockState(state);
    };
    initializeDockState().catch(console.error);

    return () => {
      active = false;
      unlisten?.();
    };
  }, [windowLabel]);

  // --- CUSTOM TRAY MENU VIEW ---
  if (windowLabel === "tray-menu") {
    return (
      <div className="h-screen w-screen flex flex-col bg-white border border-slate-200 rounded-lg overflow-hidden shadow-xl p-1 select-none">
        <button
          onClick={() => tauriInvoke("show_sidebar")}
          className="w-full flex items-center gap-3 px-3 py-2 rounded-md hover:bg-slate-100 text-slate-700 transition-colors group"
        >
          <Activity
            size={14}
            className="text-slate-500 group-hover:text-cyan-600 transition-colors"
          />
          <span className="text-[11px] font-bold">Sidebar</span>
        </button>
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

  // --- SUMMONABLE SIDEBAR HUB VIEW ---
  if (windowLabel === "sidebar") {
    const openDashboard = async () => {
      await tauriInvoke("show_main");
    };
    const sidebarTheme = resolveSidebarTheme(appConfig.sidebar_theme);
    const sidebarIsLight = isLightColor(sidebarTheme.background);
    const sidebarWindowBorder = sidebarIsLight
      ? "rgba(203, 213, 225, 0.96)"
      : "rgba(255, 255, 255, 0.4)";
    const sidebarHiddenTransform: Record<SidebarDockState["edge"], string> = {
      left: "translate3d(-100%, 0, 0)",
      top: "translate3d(0, -100%, 0)",
      right: "translate3d(100%, 0, 0)",
      bottom: "translate3d(0, 100%, 0)",
    };
    const sidebarDockRounding: Record<SidebarDockState["edge"], string> = {
      left: "rounded-r-lg",
      top: "rounded-b-lg",
      right: "rounded-l-lg",
      bottom: "rounded-t-lg",
    };
    // The controls live in an invisible, generous hover target on the free
    // edge. The compact buttons themselves only appear when the cursor is
    // nearby, so the sidebar keeps its clean, frameless surface at rest.
    const sidebarEdgeControlPlacement: Record<SidebarDockState["edge"], string> = {
      left: "right-0 top-1/2 -translate-y-1/2 h-28 w-10",
      top: "bottom-0 left-1/2 -translate-x-1/2 h-10 w-28",
      right: "left-0 top-1/2 -translate-y-1/2 h-28 w-10",
      bottom: "top-0 left-1/2 -translate-x-1/2 h-10 w-28",
    };
    const sidebarPinHandleShape: Record<SidebarDockState["edge"], string> = {
      left: "h-12 w-7 rounded-l-full border-y border-l",
      top: "h-7 w-12 rounded-t-full border-x border-t",
      right: "h-12 w-7 rounded-r-full border-y border-r",
      bottom: "h-7 w-12 rounded-b-full border-x border-b",
    };
    const sidebarPinHandlePosition: Record<SidebarDockState["edge"], string> = {
      left: "absolute right-0 top-1/2 -translate-y-1/2",
      top: "absolute bottom-0 left-1/2 -translate-x-1/2",
      right: "absolute left-0 top-1/2 -translate-y-1/2",
      bottom: "absolute top-0 left-1/2 -translate-x-1/2",
    };
    // Follow the free edge clockwise: right-docked puts Close above Pin,
    // with the other edges rotating this relationship naturally.
    const sidebarCloseButtonPosition: Record<SidebarDockState["edge"], string> = {
      left: "absolute right-0 bottom-0",
      top: "absolute bottom-0 left-0",
      right: "absolute left-0 top-0",
      bottom: "absolute right-0 top-0",
    };
    const sidebarEdgeLabels: Record<SidebarDockState["edge"], string> = {
      left: "left",
      top: "top",
      right: "right",
      bottom: "bottom",
    };
    const sidebarDragMessage = sidebarDockState.preview_edge
      ? "Release to dock on the " + sidebarEdgeLabels[sidebarDockState.preview_edge] + " edge"
      : "Move toward any screen edge to preview docking";
    // Keep resize hit targets thin (h-1.5 / w-1.5). The previous h-4 / w-4
    // strips covered most of the top drag header and stole window moves.
    const sidebarWindowResizeHandles: Array<{
      direction: NativeResizeDirection;
      className: string;
      cursor: "ns-resize" | "ew-resize";
      label: string;
    }> = sidebarDockState.edge === "left" || sidebarDockState.edge === "right"
      ? [
          {
            direction: "North",
            className: "top-0 left-3 right-3 h-1.5",
            cursor: "ns-resize",
            label: "Resize sidebar from top edge",
          },
          {
            direction: "South",
            className: "bottom-0 left-3 right-3 h-1.5",
            cursor: "ns-resize",
            label: "Resize sidebar from bottom edge",
          },
        ]
      : [
          {
            direction: "West",
            className: "left-0 top-3 bottom-3 w-1.5",
            cursor: "ew-resize",
            label: "Resize sidebar from left edge",
          },
          {
            direction: "East",
            className: "right-0 top-3 bottom-3 w-1.5",
            cursor: "ew-resize",
            label: "Resize sidebar from right edge",
          },
        ];
    const sidebarWidgets = appConfig.sidebar_widgets || {};
    const hideSidebarWidgetHeaders = appConfig.sidebar_hide_widget_headers === true;
    const sidebarOrder = normalizeSidebarOrder(appConfig.sidebar_order);
    const visibleSidebarKeys = sidebarOrder.filter(
      (key) => sidebarWidgets[key] !== false
    );
    const sidebarTileLayout =
      sidebarTileLayoutDraft ??
      normalizeSidebarTileLayout(appConfig.sidebar_tile_layout, visibleSidebarKeys);
    sidebarOrderRef.current = sidebarOrder;
    const allSidebarSections: SidebarSectionDefinition[] = [
      {
        key: "quota",
        title: "Quota Monitor",
        accentColor: sidebarTheme.quota,
        content: <QuotaWidgetContent hideHeader={hideSidebarWidgetHeaders} />,
      },
      {
        key: "gpu",
        title: "GPU Monitor",
        accentColor: sidebarTheme.gpu,
        content: <GPUWidgetContent hideHeader={hideSidebarWidgetHeaders} />,
      },
      {
        key: "deadlines",
        title: "Deadlines",
        accentColor: sidebarTheme.deadlines,
        content: <DeadlineWidgetContent hideHeader={hideSidebarWidgetHeaders} />,
      },
      {
        key: "arxiv",
        title: "Arxiv Radar",
        accentColor: sidebarTheme.arxiv,
        content: (
          <ArxivWidgetContent
            hideHeader={hideSidebarWidgetHeaders}
            appearance={sidebarIsLight ? "light" : "dark"}
          />
        ),
      },
    ];
    const sectionByKey = new Map(allSidebarSections.map((section) => [section.key, section]));
    const sidebarSections = visibleSidebarKeys
      .map((key) => sectionByKey.get(key))
      .filter((section): section is SidebarSectionDefinition => Boolean(section));
    const dragPreviewBottom = sidebarTileDragPreview
      ? sidebarTileDragPreview.rect.y + sidebarTileDragPreview.rect.h + 48
      : 0;
    const boardRows = Math.max(
      480,
      dragPreviewBottom,
      ...visibleSidebarKeys.map((key) => sidebarTileLayout[key].y + sidebarTileLayout[key].h)
    );
    // Keep the final tile visibly clear of the window frame. This space belongs
    // to the scrollable content, so it remains present at the end of the list.
    const boardHeight = boardRows + SIDEBAR_SCROLL_BOTTOM_GAP;
    const getSidebarGridMetrics = () => {
      const board = sidebarBoardRef.current;
      if (!board) return null;
      return {
        board,
        width: board.clientWidth,
      };
    };
    const saveSidebarTileLayout = (
      nextLayout: Record<SidebarSectionKey, SidebarTileRect>,
      nextVisibleOrder?: SidebarSectionKey[]
    ) => {
      const nextOrder = nextVisibleOrder
        ? [
            ...nextVisibleOrder,
            ...sidebarOrderRef.current.filter((key) => !nextVisibleOrder.includes(key)),
          ]
        : sidebarOrderRef.current;
      const compactedLayout = compactSidebarTileLayout(nextLayout, visibleSidebarKeys);
      sidebarOrderRef.current = nextOrder;
      setSidebarTileLayoutDraft(compactedLayout);
      onSaveApp({
        ...appConfig,
        sidebar_order: nextOrder,
        sidebar_tile_layout: compactedLayout,
      }).catch(console.error);
    };
    const startSidebarTileMove = (
      event: ReactPointerEvent<HTMLDivElement>,
      key: SidebarSectionKey
    ) => {
      const metrics = getSidebarGridMetrics();
      if (!metrics || event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      const dragTarget = event.currentTarget;
      const pointerId = event.pointerId;
      dragTarget.setPointerCapture(pointerId);
      setActiveSidebarTile(key);

      const startRect = sidebarTileLayout[key];
      const boardRect = metrics.board.getBoundingClientRect();
      const grabOffsetX = event.clientX - (boardRect.left + startRect.x * metrics.width);
      const grabOffsetY = event.clientY - (boardRect.top + startRect.y);
      let latestPreview = startRect;
      let latestGuide: SidebarInsertionGuide | null = null;
      setSidebarTileDragPreview({ key, rect: startRect });
      setSidebarInsertionGuide(null);

      const onPointerMove = (moveEvent: PointerEvent) => {
        if (moveEvent.pointerId !== pointerId) return;
        const scrollContainer = sidebarScrollRef.current;
        if (scrollContainer) {
          const scrollRect = scrollContainer.getBoundingClientRect();
          if (moveEvent.clientY < scrollRect.top + 44) {
            scrollContainer.scrollTop = Math.max(0, scrollContainer.scrollTop - 18);
          } else if (moveEvent.clientY > scrollRect.bottom - 44) {
            scrollContainer.scrollTop += 18;
          }
        }
        const liveBoardRect = metrics.board.getBoundingClientRect();
        const nextX = (moveEvent.clientX - liveBoardRect.left - grabOffsetX) / metrics.width;
        const nextRect = {
          ...startRect,
          x: Math.round(Math.min(1 - startRect.w, Math.max(0, nextX)) * 1000) / 1000,
          y: Math.round(Math.max(0, moveEvent.clientY - liveBoardRect.top - grabOffsetY)),
        };
        if (!sidebarTileWithinBounds(nextRect)) return;
        latestPreview = nextRect;
        latestGuide = findSidebarInsertionGuide(
          moveEvent.clientX - liveBoardRect.left,
          moveEvent.clientY - liveBoardRect.top,
          sidebarTileLayout,
          visibleSidebarKeys,
          key,
          metrics.width
        );
        setSidebarTileDragPreview({ key, rect: nextRect });
        setSidebarInsertionGuide(latestGuide);
      };

      const cleanup = () => {
        window.removeEventListener("pointermove", onPointerMove);
        window.removeEventListener("pointerup", onPointerUp);
        window.removeEventListener("pointercancel", onPointerCancel);
        window.removeEventListener("blur", onWindowBlur);
        if (dragTarget.hasPointerCapture(pointerId)) {
          dragTarget.releasePointerCapture(pointerId);
        }
        setActiveSidebarTile(null);
        setSidebarTileDragPreview(null);
        setSidebarInsertionGuide(null);
      };
      const onPointerUp = () => {
        cleanup();
        if (!latestGuide) {
          setSidebarTileLayoutDraft(sidebarTileLayout);
          return;
        }
        const inserted = insertSidebarTileAtGuide(
          sidebarTileLayout,
          visibleSidebarKeys,
          key,
          latestGuide,
          latestPreview
        );
        saveSidebarTileLayout(inserted.layout, inserted.order);
      };
      const onPointerCancel = () => {
        cleanup();
        setSidebarTileLayoutDraft(sidebarTileLayout);
      };
      const onWindowBlur = () => {
        cleanup();
        setSidebarTileLayoutDraft(sidebarTileLayout);
      };

      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", onPointerUp);
      window.addEventListener("pointercancel", onPointerCancel);
      window.addEventListener("blur", onWindowBlur, { once: true });
    };
    const startSidebarTileResize = (
      event: ReactPointerEvent<HTMLButtonElement>,
      key: SidebarSectionKey,
      direction: SidebarResizeDirection
    ) => {
      const metrics = getSidebarGridMetrics();
      if (!metrics || event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      const resizeTarget = event.currentTarget;
      const pointerId = event.pointerId;
      resizeTarget.setPointerCapture(pointerId);
      setActiveSidebarTile(key);

      const startX = event.clientX;
      const startY = event.clientY;
      const startRect = sidebarTileLayout[key];
      let latestLayout = sidebarTileLayout;

      const onPointerMove = (moveEvent: PointerEvent) => {
        if (moveEvent.pointerId !== pointerId) return;
        const deltaXPixels = moveEvent.clientX - startX;
        const deltaYPixels = moveEvent.clientY - startY;
        const nextRect = resizeSidebarTileRect(
          startRect,
          direction,
          deltaXPixels,
          deltaYPixels,
          metrics.width
        );
        if (!sidebarTileWithinBounds(nextRect)) return;
        const hasHorizontalEdge = direction.includes("e") || direction.includes("w");
        const hasVerticalEdge = direction.includes("n") || direction.includes("s");
        const preferredAxis: SidebarCollisionAxis =
          hasHorizontalEdge && !hasVerticalEdge
            ? "horizontal"
            : hasVerticalEdge && !hasHorizontalEdge
              ? "vertical"
              : Math.abs(deltaXPixels) > Math.abs(deltaYPixels)
                ? "horizontal"
                : "vertical";
        latestLayout = resolveSidebarTileCollisions(
          key,
          nextRect,
          sidebarTileLayout,
          visibleSidebarKeys,
          metrics.width,
          preferredAxis
        );
        setSidebarTileLayoutDraft(latestLayout);
      };

      const cleanup = () => {
        window.removeEventListener("pointermove", onPointerMove);
        window.removeEventListener("pointerup", onPointerUp);
        window.removeEventListener("pointercancel", onPointerCancel);
        window.removeEventListener("blur", onWindowBlur);
        if (resizeTarget.hasPointerCapture(pointerId)) {
          resizeTarget.releasePointerCapture(pointerId);
        }
        setActiveSidebarTile(null);
      };
      const onPointerUp = () => {
        cleanup();
        saveSidebarTileLayout(latestLayout);
      };
      const onPointerCancel = () => {
        cleanup();
        setSidebarTileLayoutDraft(sidebarTileLayout);
      };
      const onWindowBlur = () => {
        cleanup();
        saveSidebarTileLayout(latestLayout);
      };

      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", onPointerUp);
      window.addEventListener("pointercancel", onPointerCancel);
      window.addEventListener("blur", onWindowBlur, { once: true });
    };

    const insertionGuideStyle = (() => {
      if (!sidebarInsertionGuide) return null;
      const targetRect = sidebarTileLayout[sidebarInsertionGuide.targetKey];
      const isColumnGuide =
        sidebarInsertionGuide.placement === "left" ||
        sidebarInsertionGuide.placement === "right";
      if (isColumnGuide) {
        const edge =
          sidebarInsertionGuide.placement === "left"
            ? targetRect.x
            : targetRect.x + targetRect.w;
        return {
          left: `calc(${edge * 100}% - 2px)`,
          top: targetRect.y + 4,
          width: 3,
          height: Math.max(24, targetRect.h - 8),
        };
      }

      const guideRows = sidebarRowsFromLayout(
        sidebarTileLayout,
        visibleSidebarKeys.filter((key) => key !== activeSidebarTile)
      );
      const targetRow = guideRows.find((row) =>
        row.keys.includes(sidebarInsertionGuide.targetKey)
      );
      const edge =
        sidebarInsertionGuide.placement === "above"
          ? targetRow?.top ?? targetRect.y
          : targetRow?.bottom ?? targetRect.y + targetRect.h;
      return {
        left: 0,
        top: edge - 2,
        width: `calc(100% - ${SIDEBAR_TILE_GAP}px)`,
        height: 3,
      };
    })();

    return (
      <div
        className={`absolute inset-0 relative flex flex-col overflow-hidden select-none transition-[transform,box-shadow,outline-color] duration-150 ease-out will-change-transform ${sidebarDockRounding[sidebarDockState.edge]} ${
          sidebarIsLight ? "text-slate-900" : "text-white"
        }`}
        style={{
          backgroundColor: hexToRgba(
            sidebarTheme.background,
            sidebarTheme.background_opacity
          ),
          backdropFilter:
            sidebarTheme.blur > 0
              ? `blur(${sidebarTheme.blur}px) saturate(145%)`
              : undefined,
          WebkitBackdropFilter:
            sidebarTheme.blur > 0
              ? `blur(${sidebarTheme.blur}px) saturate(145%)`
              : undefined,
          border: `1px solid ${sidebarWindowBorder}`,
          // This is the same inset highlight treatment used by the Dashboard
          // frame, rendered directly so it remains visible in this transparent
          // webview without adding a drop shadow.
          boxShadow: `inset 0 0 0 1px ${sidebarWindowBorder}`,
          outline: sidebarDockState.dragging ? "2px solid rgba(56, 189, 248, 0.72)" : undefined,
          outlineOffset: sidebarDockState.dragging ? "-2px" : undefined,
          transform: sidebarDockState.expanded
            ? "translate3d(0, 0, 0)"
            : sidebarHiddenTransform[sidebarDockState.edge],
        }}
      >
        {sidebarWindowResizeHandles.map((handle) => (
          <div
            key={handle.direction}
            role="separator"
            aria-label={handle.label}
            data-no-drag="true"
            className={`absolute z-[70] bg-transparent transition-colors hover:bg-sky-400/15 ${handle.className}`}
            style={{ cursor: handle.cursor, touchAction: "none" }}
            onPointerDown={(event) => {
              if (event.button !== 0) return;
              event.preventDefault();
              event.stopPropagation();
              getCurrentWindow().startResizeDragging(handle.direction).catch((error) => {
                console.error("Sidebar resize failed", error);
              });
            }}
          />
        ))}
        <div
          data-no-drag="true"
          className={`group absolute z-40 ${sidebarEdgeControlPlacement[sidebarDockState.edge]}`}
        >
          <button
            type="button"
            data-no-drag="true"
            aria-label={sidebarDockState.pinned ? "Unpin sidebar" : "Pin sidebar open"}
            title={
              sidebarDockState.pinned
                ? "Unpin sidebar and enable auto-hide"
                : "Pin sidebar open"
            }
            onMouseDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              tauriInvoke("set_sidebar_pinned", { pinned: !sidebarDockState.pinned })
                .then(setSidebarDockState)
                .catch(console.error);
            }}
            className={`flex shrink-0 items-center justify-center shadow-lg opacity-0 scale-90 transition-all duration-200 group-hover:opacity-100 group-hover:scale-100 hover:brightness-110 focus-visible:opacity-100 focus-visible:scale-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/80 ${sidebarPinHandlePosition[sidebarDockState.edge]} ${sidebarPinHandleShape[sidebarDockState.edge]} ${
              sidebarIsLight
                ? "text-slate-600 hover:text-slate-950"
                : "text-slate-300 hover:text-white"
            }`}
            style={{
              backgroundColor: hexToRgba(
                sidebarTheme.background,
                Math.min(1, sidebarTheme.background_opacity + 0.06)
              ),
              borderColor: sidebarIsLight
                ? hexToRgba(sidebarTheme.header, 0.34)
                : hexToRgba("#ffffff", 0.14),
              backdropFilter:
                sidebarTheme.blur > 0
                  ? `blur(${sidebarTheme.blur}px) saturate(145%)`
                  : undefined,
              WebkitBackdropFilter:
                sidebarTheme.blur > 0
                  ? `blur(${sidebarTheme.blur}px) saturate(145%)`
                  : undefined,
            }}
          >
            {sidebarDockState.pinned ? <PinOff size={13} /> : <Pin size={13} />}
          </button>
          <button
            type="button"
            data-no-drag="true"
            aria-label="Close sidebar"
            title="Close sidebar"
            onMouseDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              tauriInvoke("hide_sidebar").catch(console.error);
            }}
            className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-red-200/35 bg-red-500/85 text-white shadow-lg opacity-0 scale-90 transition-all duration-200 group-hover:opacity-100 group-hover:scale-100 hover:bg-red-500 focus-visible:opacity-100 focus-visible:scale-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-300/90 ${sidebarCloseButtonPosition[sidebarDockState.edge]}`}
          >
            <X size={13} strokeWidth={2.5} />
          </button>
        </div>
        {/* Deliberately blank: the parent owns the translucent frosted surface,
            so this drag strip has no separate tint, blur layer, or divider. */}
        <header
          aria-label="Drag sidebar"
          className="h-4 shrink-0 cursor-grab active:cursor-grabbing"
          onMouseDown={startDrag}
        />
        {sidebarDockState.dragging ? (
          <div className="absolute inset-2 z-50 pointer-events-none rounded-md border border-dashed border-sky-300/80 bg-sky-400/10">
            <span
              className={"absolute left-1/2 top-2 -translate-x-1/2 rounded-full px-2 py-1 text-[8px] font-black uppercase tracking-[0.16em] transition-colors " + (
                sidebarDockState.preview_edge === "top"
                  ? "bg-sky-400 text-slate-950 shadow-lg shadow-sky-400/50"
                  : "bg-slate-950/65 text-sky-100/80"
              )}
            >
              Top
            </span>
            <span
              className={"absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full px-2 py-1 text-[8px] font-black uppercase tracking-[0.16em] transition-colors " + (
                sidebarDockState.preview_edge === "bottom"
                  ? "bg-sky-400 text-slate-950 shadow-lg shadow-sky-400/50"
                  : "bg-slate-950/65 text-sky-100/80"
              )}
            >
              Bottom
            </span>
            <span
              className={"absolute left-2 top-1/2 -translate-y-1/2 rounded-full px-2 py-1 text-[8px] font-black uppercase tracking-[0.16em] transition-colors " + (
                sidebarDockState.preview_edge === "left"
                  ? "bg-sky-400 text-slate-950 shadow-lg shadow-sky-400/50"
                  : "bg-slate-950/65 text-sky-100/80"
              )}
            >
              Left
            </span>
            <span
              className={"absolute right-2 top-1/2 -translate-y-1/2 rounded-full px-2 py-1 text-[8px] font-black uppercase tracking-[0.16em] transition-colors " + (
                sidebarDockState.preview_edge === "right"
                  ? "bg-sky-400 text-slate-950 shadow-lg shadow-sky-400/50"
                  : "bg-slate-950/65 text-sky-100/80"
              )}
            >
              Right
            </span>
            <div className="absolute left-1/2 top-1/2 w-[min(19rem,calc(100%-3.5rem))] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-sky-200/40 bg-slate-950/85 px-4 py-3 text-center text-white shadow-2xl shadow-slate-950/45">
              <div className="text-[9px] font-black uppercase tracking-[0.2em] text-sky-300">
                {sidebarDockState.preview_edge ? "Dock target ready" : "Moving sidebar"}
              </div>
              <div className="mt-1 text-[11px] font-bold leading-snug">
                {sidebarDragMessage}
              </div>
            </div>
          </div>
        ) : null}

        <div
          ref={sidebarScrollRef}
          className="flex-1 min-h-0 overflow-y-auto custom-scrollbar px-2 pt-2"
          style={{ marginBottom: SIDEBAR_WINDOW_RESIZE_GUTTER }}
          data-no-drag="true"
        >
          {sidebarSections.length > 0 ? (
            <div
              ref={sidebarBoardRef}
              className="relative min-w-0"
              style={{ height: boardHeight }}
            >
              {sidebarSections.map((section) => {
                const rect =
                  sidebarTileDragPreview?.key === section.key
                    ? sidebarTileDragPreview.rect
                    : sidebarTileLayout[section.key];
                const isActive = activeSidebarTile === section.key;
                return (
                  <div
                    key={section.key}
                    className={`absolute min-h-0 ${
                      isActive ? "" : "transition-[left,top,width,height,opacity] duration-150"
                    } ${
                      isActive ? "z-20 opacity-90" : "z-0 opacity-100"
                    }`}
                    style={{
                      left: `${rect.x * 100}%`,
                      top: rect.y,
                      width: `calc(${rect.w * 100}% - ${SIDEBAR_TILE_GAP}px)`,
                      height: rect.h,
                    }}
                  >
                    <SidebarWidgetSection
                      title={section.title}
                      accentColor={section.accentColor}
                      theme={sidebarTheme}
                      isLight={sidebarIsLight}
                      onClose={() => saveSidebarWidgetVisibility(section.key, false)}
                      onMoveStart={(event) => startSidebarTileMove(event, section.key)}
                      onResizeStart={(event, direction) =>
                        startSidebarTileResize(event, section.key, direction)
                      }
                    >
                      {section.content}
                    </SidebarWidgetSection>
                  </div>
                );
              })}
              {insertionGuideStyle ? (
                <div
                  className="absolute z-40 pointer-events-none rounded-full bg-blue-400 shadow-[0_0_0_1px_rgba(255,255,255,0.75),0_0_14px_rgba(59,130,246,0.9)]"
                  style={insertionGuideStyle}
                >
                  <span className="absolute left-1/2 top-1/2 w-2 h-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-blue-400 ring-2 ring-white/90" />
                </div>
              ) : null}
            </div>
          ) : (
            <div
              className={`h-full min-h-[320px] rounded-lg border border-dashed flex flex-col items-center justify-center text-center px-6 ${
                sidebarIsLight
                  ? "border-slate-300 bg-white/70 text-slate-500"
                  : "border-white/10 bg-white/5 text-slate-400"
              }`}
            >
              <LayoutDashboard size={20} className="mb-3 opacity-70" />
              <div className="text-[11px] font-black uppercase tracking-widest">
                No Sidebar Widgets
              </div>
              <button
                type="button"
                onClick={openDashboard}
                className={`mt-4 px-4 py-2 rounded-lg border text-[10px] font-black uppercase tracking-wider transition-colors ${
                  sidebarIsLight
                    ? "bg-slate-900 text-white border-slate-900 hover:bg-slate-700"
                    : "bg-white/10 text-white border-white/10 hover:bg-white/15"
                }`}
              >
                Open Settings
              </button>
            </div>
          )}
        </div>
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
                  <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
                    <h2
                      className={`text-xl font-bold tracking-tight ${
                        appConfig.theme === "light" ? "text-slate-900" : "text-white"
                      }`}
                    >
                      Quick Launch Widgets
                    </h2>
                    <button
                      type="button"
                      onClick={() => tauriInvoke("show_sidebar")}
                      className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg border text-xs font-black uppercase tracking-widest transition-colors ${
                        appConfig.theme === "light"
                          ? "bg-white border-slate-200 text-slate-700 hover:bg-slate-50"
                          : "bg-white/5 border-white/10 text-slate-200 hover:bg-white/10"
                      }`}
                    >
                      <Activity size={14} />
                      Open Sidebar
                    </button>
                  </div>
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
                      const deadlineKey = deadlineInstanceKey(dl);
                      const isPinned = (paperConfig.pinned_deadline_ids || []).includes(deadlineKey);
                      const isSubscribed = (paperConfig.subscribed_titles || []).some(
                        (title) => title.toLowerCase() === dl.title.toLowerCase()
                      );
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
                                onClick={() => togglePinDeadline(dl)}
                                className={`absolute -top-2 -right-2 p-1.5 rounded-full shadow-lg transition-all ${
                                  isPinned ? "bg-amber-500 text-white scale-110" : "bg-slate-800 text-slate-500 opacity-0 group-hover:opacity-100"
                                }`}
                                title={isPinned ? "Unpin this deadline from widget" : "Pin this deadline to widget"}
                              >
                                <Pin size={10} className={isPinned ? "fill-current" : ""} />
                              </button>
                              <button
                                onClick={() => toggleSubscribeConference(dl.title)}
                                className={`absolute -bottom-2 -right-2 p-1.5 rounded-full shadow-lg transition-all ${
                                  isSubscribed ? "bg-emerald-500 text-white scale-110" : "bg-slate-800 text-slate-500 opacity-0 group-hover:opacity-100"
                                }`}
                                title={isSubscribed ? "Unsubscribe conference" : "Subscribe conference"}
                              >
                                <Bell size={10} className={isSubscribed ? "fill-current" : ""} />
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
                onToggleSidebarWidget={saveSidebarWidgetVisibility}
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
