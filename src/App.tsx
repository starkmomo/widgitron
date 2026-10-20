import { useState, useEffect, useLayoutEffect, useCallback, useRef, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { flushSync } from "react-dom";
import {
  LayoutDashboard,
  Settings,
  SlidersHorizontal,
  Cpu,
  X,
  Minus,
  Square,
  Activity,
  Pin,
  PinOff,
  Copy,
  RefreshCw,
  GripVertical,
  Maximize2,
  Globe,
  User,
  Plus,
  ChevronDown,
  EyeOff,
  Eye
} from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { APP_VERSION, APP_NAME } from "./constants";
import { isStaleQuotaWarning, quotaHasDisplayValue, orderQuotaByConfig } from "./utils/quotaDisplay";
import { orderGpuServersByConfig, sortGpuJobGroups } from "./utils/gpuDisplay";
import {
  gpuStatHint as computeGpuStatHint,
  quotaStatHint as computeQuotaStatHint,
  serviceUpdateStatHint,
} from "./utils/statHints";
import { tauriInvoke } from "./utils/tauriInvoke";
import { tauriListen } from "./utils/tauriListen";
import { ArxivPaperActions } from "./components/ArxivPaperActions";
import { ArxivAbstractPreview } from "./components/ArxivAbstractPreview";
import { ArxivPaperMetadata } from "./components/ArxivPaperMetadata";
import { useArxivPaperPages } from "./hooks/useArxivPaperPages";
import { ArxivDateFilter } from "./components/ArxivDateFilter";
import { ArxivPagination } from "./components/ArxivPagination";
import { startWindowSnapshotSync } from "./utils/windowSnapshotSync";
import { enable, disable, isEnabled } from "@tauri-apps/plugin-autostart";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";

import { WidgetThemeConfig } from "./types/theme";
import { hexToRgba, isLightColor } from "./utils/color";
import { providerLogoToneClass } from "./utils/providerLogo";
import { listenBackendServiceError } from "./utils/backendServiceError";
import { listenQuotaMonitorStatus, type QuotaMonitorStatus } from "./utils/quotaMonitorStatus";
import { listenServiceUpdateEvents } from "./utils/serviceUpdateEvents";
import { listenGpuDataSync } from "./utils/gpuDataSync";
import { isLiveDataSection, LIVE_DATA_SECTION, refetchSectionLiveDataForSection, LIVE_DATA_SECTION_LABELS, type AppTab, type SettingsSection } from "./utils/sectionLiveData";
import { ResearchBulkControls, ResearchBulkToggle } from "./components/ResearchBulkControls";
import { ArxivBulkActions } from "./components/ArxivBulkActions";
import { useResearchSelection } from "./hooks/useResearchSelection";
import { arxivPaperKey, useArxivLibrary } from "./hooks/useArxivLibrary";
import { ArxivReadingActions } from "./components/ArxivReadingActions";
import { ArxivSkippedDialog } from "./components/ArxivSkippedDialog";
import { formatCpuPercent, formatSystemMemory } from "./utils/systemMetrics";
import { formatArxivKeywordLabel, groupArxivPapersByKeyword, hasArxivKeywords } from "./utils/arxivKeywords";
import type { AppConfig, ArxivConfig, ArxivPaper, GpuConfig, GpuInfo, PaperConfig, PaperDeadlineInfo, QuotaBarDisplay, QuotaConfig, QuotaItem, ServerGpuData } from "./types/config";
import type { SidebarDockState, UpdateInfo } from "./types/tauri";
import { resolveWidgetTheme } from "./utils/widgetTheme";
import { isMacOS, isWindows } from "./utils/platform";
import { resolveLanguage, useUiLocalization } from "./utils/localization";
import { CACHED_LABELS, cachedLabelWhen, gpuRefreshCachedLabel, messageShowsCached } from "./utils/cachedLabels";
import { MODULE_NAVIGATION } from "./utils/moduleNavigation";
import { SidebarLink } from "./components/SidebarLink";
import { WindowButton } from "./components/WindowButton";
import { MasterSwitch } from "./components/MasterSwitch";
import { DashboardServiceToggleError, ToggleErrorBanner } from "./components/SettingsRefreshError";
import { ServiceErrorBanners } from "./components/ServiceErrorBanners";
import { QuotaVisualizations } from "./components/QuotaVisualizations";
import { StatCard } from "./components/StatCard";
import { SectionEmptyState } from "./components/SectionEmptyState";
import { FloatingWindowControls } from "./components/FloatingWindowControls";
import { SidebarWidgetHeaderContext } from "./components/WidgetHeader";
import { WidgetResizeHandle } from "./components/WidgetResizeHandle";
import { WidgetPreviewCard } from "./components/WidgetPreviewCard";
import { CopyButton } from "./components/CopyButton";
import { DeadlineConferenceBrowser } from "./components/DeadlineConferenceBrowser";
import { ResearchPageHeader, ResearchTabs } from "./components/ResearchPageHeader";
import { ConferenceUndoNotice } from "./components/ConferenceUndoNotice";
import { useDeadlineConferences } from "./hooks/useDeadlineConferences";
import { conferencePreferenceIds, isConferenceFollowed, isConferenceIgnored, resolveConferencePreferences, updateConferencePreferences, type ConferencePreference } from "./utils/deadlineKeys";
import { resolveSidebarTheme, type ResolvedSidebarTheme } from "./utils/sidebarTheme";
import { observeSidebarContentHeight } from "./utils/sidebarContentHeight";
import { useFloatingGlass } from "./hooks/useFloatingGlass";
import {
  compactSidebarTileLayout,
  constrainSidebarTileHeights,
  sidebarTileHeightLimits,
  findSidebarInsertionGuide,
  insertSidebarTileAtGuide,
  reconcileSidebarTileVisibility,
  resolveSidebarTileCollisions,
  resizeSidebarTileRect,
  sidebarRectsOverlap,
  sidebarRowsFromLayout,
  sidebarTileWithinBounds,
  SIDEBAR_TILE_GAP,
  SIDEBAR_TILE_MIN_WIDTH_RATIO,
  type SidebarCollisionAxis,
  type SidebarInsertionGuide,
  type SidebarSectionKey,
  type SidebarResizeDirection,
  type SidebarTileRect,
  type SidebarTileHeightLimitMap,
} from "./utils/sidebarTileLayout";
import { GPUWidgetContent } from "./widgets/GPUWidgetContent";
import { DeadlineWidgetContent } from "./widgets/DeadlineWidgetContent";
import { ArxivWidgetContent } from "./widgets/ArxivWidgetContent";
import { QuotaWidgetContent } from "./widgets/QuotaWidgetContent";
import { SettingsPanel } from "./settings/SettingsPanel";
import { FilterStatus, type FilterSaveResult, type FilterStatusState } from "./components/FilterStatus";
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
        sidebarTileHeightLimits(key, window.innerHeight).min,
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
        ? Math.max(sidebarTileHeightLimits(key, window.innerHeight).min, source.h)
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
  sectionKey,
  onContentHeight,
  title,
  accentColor,
  theme,
  isLight,
  showHeader,
  onClose,
  onMoveStart,
  onResizeStart,
  children,
}: {
  sectionKey: SidebarSectionKey;
  onContentHeight: (key: SidebarSectionKey, height: number, expanded: boolean) => void;
  title: string;
  accentColor: string;
  theme: ResolvedSidebarTheme;
  isLight: boolean;
  showHeader: boolean;
  onClose: () => void;
  onMoveStart: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onResizeStart: (
    event: ReactPointerEvent<HTMLButtonElement>,
    direction: SidebarResizeDirection
  ) => void;
  children: ReactNode;
}) {
  const sectionRef = useRef<HTMLElement>(null);
  const [headerTarget, setHeaderTarget] = useState<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    if (sectionKey === "arxiv") return;
    const section = sectionRef.current;
    if (!section) return;
    return observeSidebarContentHeight(section, (height, expanded) => onContentHeight(sectionKey, height, expanded));
  }, [sectionKey, onContentHeight]);
  return (
    <section
      ref={sectionRef}
      className="group/sidebar-tile h-full min-h-0 rounded-md border overflow-hidden flex flex-col relative"
      style={{
        backgroundColor: theme.material === "native-glass" && theme.card_background ? "transparent" : isLight
          ? hexToRgba("#ffffff", theme.card_opacity)
          : hexToRgba(theme.background, theme.card_opacity),
        borderColor: hexToRgba(accentColor, isLight ? 0.28 : 0.22),
        boxShadow: `inset 0 2px 0 ${hexToRgba(accentColor, 0.62)}`,
        backdropFilter: theme.blur > 0 ? `blur(${Math.min(theme.blur, 18)}px) saturate(135%)` : undefined,
        WebkitBackdropFilter: theme.blur > 0 ? `blur(${Math.min(theme.blur, 18)}px) saturate(135%)` : undefined,
      }}
    >
      <div
        className={`${showHeader ? "h-7" : "h-5"} shrink-0 px-1.5 flex items-center gap-1 border-b cursor-grab active:cursor-grabbing touch-none`}
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
          {!showHeader && <span
            className="w-1.5 h-1.5 rounded-full"
            style={{ backgroundColor: accentColor }}
          />}
          <span className="sr-only">Move {title}</span>
        </div>
        <div ref={setHeaderTarget} className="min-w-0 flex-1" />
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
      <div className="flex-1 min-h-0 p-2 overflow-hidden">
        <SidebarWidgetHeaderContext.Provider value={{ target: headerTarget, onMoveStart }}>{children}</SidebarWidgetHeaderContext.Provider>
      </div>
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

const renderProviderIcon = (provider: string, isManual = false, lightBackground = false) => {
  if (isManual) {
    return <User size={14} className="text-cyan-400 flex-shrink-0" />;
  }
  const logoSrc = PROVIDER_LOGOS[provider];
  if (logoSrc) {
    return (
      <img
        src={logoSrc}
        alt=""
        className={`w-3.5 h-3.5 flex-shrink-0 object-contain ${providerLogoToneClass(provider, lightBackground)}`}
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
  const [settingsSection, setSettingsSection] = useState<SettingsSection>("general");
  const [inlineSettingsSection, setInlineSettingsSection] = useState<SettingsSection | null>(null);
  const [isMaximized, setIsMaximized] = useState(false);
  const windowLabel = appWindow.label;
  useEffect(() => {
    if (windowLabel !== "main") return;
    let active = true;
    let unlisten: (() => void) | undefined;
    let queue = Promise.resolve();
    const consumeNavigation = () => {
      // Serialize reads so an older IPC response cannot replace a newer click.
      queue = queue.then(async () => {
        if (!active) return;
        try {
          const destination = await tauriInvoke("take_pending_main_navigation");
          if (active && destination) {
            setInlineSettingsSection(null);
            setActiveTab(destination);
          }
        } catch (error) {
          console.error("Widget navigation failed", error);
        }
      });
    };
    tauriListen("main_navigation_pending", consumeNavigation).then(stop => {
      if (!active) { stop(); return; }
      unlisten = stop;
      consumeNavigation();
    }).catch(error => console.error("Widget navigation listener failed", error));
    return () => { active = false; unlisten?.(); };
  }, [windowLabel]);
  const [nativeWidgetsAvailable, setNativeWidgetsAvailable] = useState(false);
  const [isLocked, setIsLocked] = useState(false);
  const [isPinned, setIsPinned] = useState(false);
  const [gpuData, setGpuData] = useState<ServerGpuData[]>([]);
  const [deadlines, setDeadlines] = useState<PaperDeadlineInfo[]>([]);
  const { conferences: deadlineConferences, now: deadlineNow } = useDeadlineConferences(deadlines);
  const [gpuConfig, setGpuConfig] = useState<GpuConfig>({ servers: [] });
  const [paperConfig, setPaperConfig] = useState<PaperConfig>({});
  const paperConfigRef = useRef(paperConfig);
  paperConfigRef.current = paperConfig;
  const paperSaveQueue = useRef<Promise<void>>(Promise.resolve());
  const paperSaveRevision = useRef(0);
  const [paperSaveError, setPaperSaveError] = useState(false);
  const paperPendingWrites = useRef(0);
  const [paperPreferenceUndo, setPaperPreferenceUndo] = useState<{ config: PaperConfig; id: number } | null>(null);
  const paperUndoId = useRef(0);
  useEffect(() => {
    if (windowLabel !== "main") return;
    const sync = startWindowSnapshotSync<PaperConfig>({
      listen: handler => tauriListen("paper_config_update", event => handler(event.payload)),
      read: () => tauriInvoke("get_paper_config"),
      apply: config => { if (!paperPendingWrites.current) { paperConfigRef.current = config; setPaperConfig(config); } },
      onError: error => console.error("Conference preferences sync failed", error),
    });
    return () => sync.stop();
  }, [windowLabel]);
  const [arxivConfig, setArxivConfig] = useState<ArxivConfig>({});
  const [arxivConfigLoaded, setArxivConfigLoaded] = useState(false);
  const arxivConfigRef = useRef(arxivConfig);
  const arxivSaveQueue = useRef<Promise<boolean>>(Promise.resolve(true));
  const arxivSaveRevision = useRef(0);
  const arxivPendingWrites = useRef(0);
  const [arxivFilterState, setArxivFilterState] = useState<FilterStatusState>("idle");
  useEffect(() => {
    if (arxivFilterState !== "applied") return;
    const timer = window.setTimeout(() => setArxivFilterState("idle"), 4000);
    return () => window.clearTimeout(timer);
  }, [arxivFilterState]);
  useEffect(() => {
    if (windowLabel !== "main") return;
    const sync = startWindowSnapshotSync<ArxivConfig>({
      listen: handler => tauriListen("arxiv_config_update", event => handler(event.payload)),
      read: () => tauriInvoke("get_arxiv_config"),
      apply: config => {
        setArxivConfigLoaded(true);
        if (!arxivPendingWrites.current) {
          arxivConfigRef.current = config;
          setArxivConfig(config);
        }
      },
      onError: error => console.error("arXiv filter sync failed", error),
    });
    return () => sync.stop();
  }, [windowLabel]);
  const hasReadingKeywords = hasArxivKeywords(arxivConfig.keywords);
  const [arxivPapers, setArxivPapers] = useState<ArxivPaper[]>([]);
  const arxivLibrary = useArxivLibrary(windowLabel === "main");
  const arxivSavedPapers = arxivLibrary.saved;
  const [arxivView, setArxivView] = useState<"all" | "unread" | "saved">("unread");
  const [arxivDate, setArxivDate] = useState("");
  const arxivHeaderRef = useRef<HTMLDivElement>(null);
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
  const appConfigSync = useRef<ReturnType<typeof startWindowSnapshotSync<AppConfig>> | null>(null);
  useUiLocalization(resolveLanguage(appConfig.language));
  const pagedArxivView = arxivView === "all" || (arxivView === "unread" && hasReadingKeywords && arxivDate !== "");
  const arxivPageEnabled = windowLabel === "main" && activeTab === "arxiv" && appConfig.arxiv_enabled !== false;
  const overviewNeedsArxivTotal = windowLabel === "main" && activeTab === "dashboard" && arxivConfigLoaded && !hasReadingKeywords && appConfig.arxiv_enabled !== false;
  const allArxiv = useArxivPaperPages((arxivPageEnabled && arxivView === "all") || overviewNeedsArxivTotal,
    arxivConfig.categories, [], activeTab === "dashboard" ? null : arxivDate || null);
  const matchedArxiv = useArxivPaperPages(arxivPageEnabled && arxivView === "unread" && hasReadingKeywords && Boolean(arxivDate), arxivConfig.categories, arxivConfig.keywords, arxivDate || null);
  const pagedArxiv = arxivView === "all" ? allArxiv : matchedArxiv;
  const refreshingArxivView = pagedArxivView ? pagedArxiv.loading : isRefreshingArxiv;
  const overviewConferencePreferences = resolveConferencePreferences(paperConfig, deadlines, deadlineNow);
  const overviewShowsFollowed = conferencePreferenceIds(overviewConferencePreferences, "followed").length > 0;
  const overviewConferenceCount = deadlineConferences.filter(conference => overviewShowsFollowed
    ? isConferenceFollowed(conference, overviewConferencePreferences)
    : !isConferenceIgnored(conference, overviewConferencePreferences)).length;
  const overviewArxivHint = hasReadingKeywords ? arxivStat : serviceUpdateStatHint(null, allArxiv.error, allArxiv.loaded);
  useEffect(() => {
    if (pagedArxivView && pagedArxiv.loaded) arxivHeaderRef.current?.scrollIntoView({ block: "start" });
  }, [pagedArxivView, pagedArxiv.page, pagedArxiv.data_date, pagedArxiv.loaded]);
  const [isAutostart, setIsAutostart] = useState(false);
  const [activeWidgets, setActiveWidgets] = useState<string[]>([]);
  const [widgetsVisibilityBusy, setWidgetsVisibilityBusy] = useState(false);
  const hasFloatingWidgets = MODULE_NAVIGATION.some(({ field }) =>
    appConfig[field] !== false && activeWidgets.includes(serviceWidgetMeta(field).id));
  const [themeConfig, setThemeConfig] = useState<WidgetThemeConfig>({ themes: [], assignments: {} });
  const currentTheme = resolveWidgetTheme(themeConfig, windowLabel, undefined, { dashboardTheme: appConfig.theme });
  const themePendingWrites = useRef(0);
  const themeSaveRevision = useRef(0);
  const themeSaveQueue = useRef<Promise<void>>(Promise.resolve());
  const [pendingToggles, setPendingToggles] = useState<Set<string>>(new Set());
  const [toggleWidgetError, setToggleWidgetError] = useState<string | null>(null);
  const [serviceToggleBusy, setServiceToggleBusy] = useState<Partial<Record<ServiceField, boolean>>>({});
  const [generalServiceRefreshError, setGeneralServiceRefreshError] = useState<ServiceToggleError | null>(null);
  const [serviceToggleErrorDismissed, setServiceToggleErrorDismissed] = useState(false);
  const [sidebarTileLayoutDraft, setSidebarTileLayoutDraft] =
    useState<Record<SidebarSectionKey, SidebarTileRect> | null>(null);
  const [sidebarContentHeights, setSidebarContentHeights] = useState<Partial<Record<SidebarSectionKey, { height: number; expanded: boolean; collapsedHeight: number }>>>({});
  const sidebarExpandedResizeOverrides = useRef(new Set<SidebarSectionKey>());
  const [sidebarViewportHeight, setSidebarViewportHeight] = useState(() => window.innerHeight);
  const reportSidebarContentHeight = useCallback((key: SidebarSectionKey, height: number, expanded: boolean) => {
    if (!expanded) sidebarExpandedResizeOverrides.current.delete(key);
    setSidebarContentHeights((previous) => previous[key]?.height === height && previous[key]?.expanded === expanded
      ? previous : { ...previous, [key]: { height, expanded, collapsedHeight: expanded ? (previous[key]?.collapsedHeight ?? height) : height } });
  }, []);
  useEffect(() => {
    if (windowLabel !== "sidebar" || appConfig.sidebar_enabled === false) return;
    const update = () => setSidebarViewportHeight(window.innerHeight);
    const observer = new ResizeObserver(update);
    observer.observe(document.documentElement);
    window.addEventListener("resize", update);
    update();
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [windowLabel, appConfig.sidebar_enabled]);
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
  const sidebarTheme = resolveSidebarTheme(appConfig.sidebar_theme, appConfig.theme);
  const sidebarGlass = sidebarTheme.material === "native-glass";
  const nativeGlass = useFloatingGlass(windowLabel.startsWith("widget-") || windowLabel === "sidebar",
    windowLabel === "sidebar" || Boolean(currentTheme),
    windowLabel === "sidebar" ? sidebarGlass && appConfig.sidebar_enabled !== false : currentTheme?.material === "native-glass",
    windowLabel === "sidebar" ? !isLightColor(sidebarTheme.background) : currentTheme ? !isLightColor(currentTheme.bg_color) : false,
    windowLabel === "sidebar" ? sidebarDockState.edge : null);
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

  const openSettingsSection = (section: SettingsSection) => {
    setSettingsSection(section);
    setActiveTab("settings");
  };

  const openInlineSettings = (section: SettingsSection) => {
    setInlineSettingsSection((current) => current === section ? null : section);
  };

  useEffect(() => {
    let lastReadSummary = "";
    const trace = (phase: string, details: string) => {
      if (windowLabel === "sidebar" && !isMacOS) {
        void tauriInvoke("log_sidebar_sync", { phase, details }).catch(console.error);
      }
    };
    const summary = (config: AppConfig) => JSON.stringify({
      theme: resolveSidebarTheme(config.sidebar_theme, config.theme).id,
      dashboardTheme: config.theme,
      widgets: config.sidebar_widgets,
      hideHeaders: config.sidebar_hide_widget_headers,
    });
    const sync = startWindowSnapshotSync<AppConfig>({
      listen: async (apply) => {
        trace("subscribe-start", "app_config_update");
        const stop = await tauriListen("app_config_update", (event) => {
          trace("event-received", summary(event.payload));
          apply(event.payload);
        });
        trace("subscribe-ready", "app_config_update");
        return stop;
      },
      read: async () => {
        const timeout = window.setTimeout(() => trace("read-pending", "get_app_config > 2s"), 2000);
        try {
          const config = await tauriInvoke("get_app_config");
          const nextSummary = summary(config);
          if (lastReadSummary !== nextSummary) {
            trace("read-completed", nextSummary);
            lastReadSummary = nextSummary;
          }
          return config;
        } finally {
          window.clearTimeout(timeout);
        }
      },
      apply: (config) => {
        const update = () => {
          setAppConfig((previous) => {
            if (JSON.stringify(previous) === JSON.stringify(config)) return previous;
            applyServiceDisableClears(previous, config, serviceDisableHandlers);
            return config;
          });
          if (windowLabel.startsWith("widget-")) {
            setIsPinned(config.always_on_top?.[windowLabel] ?? false);
          }
          if (windowLabel === "main" || windowLabel === "tray-menu") {
            setActiveWidgets(activeWidgetLabelsFromConfig(config) ?? []);
          }
        };
        // Native IPC callbacks run outside React input events. Commit sidebar
        // settings synchronously so the DOM is updated before the callback ends.
        if (windowLabel === "sidebar" && !isMacOS) flushSync(update);
        else update();
        try {
          if (config.theme) localStorage.setItem("widgitron-theme", config.theme);
        } catch (error) {
          console.warn("Could not cache the application theme", error);
        }
      },
      onError: (error) => {
        console.error("Application settings sync failed", error);
        void tauriInvoke("log_frontend_error", {
          source: `${windowLabel}:app-config-sync`,
          message: String(error),
        }).catch(console.error);
      },
    });
    appConfigSync.current = sync;
    return () => {
      sync.stop();
      appConfigSync.current = null;
    };
  }, [windowLabel]);

  useEffect(() => {
    if (windowLabel !== "sidebar" || isMacOS) return;
    const root = document.querySelector("[data-sidebar-theme]");
    void tauriInvoke("log_sidebar_sync", {
      phase: "dom-committed",
      details: JSON.stringify({
        theme: root?.getAttribute("data-sidebar-theme"),
        modules: Array.from(document.querySelectorAll("[data-sidebar-module]"))
          .map((node) => node.getAttribute("data-sidebar-module")),
        background: root ? getComputedStyle(root).backgroundColor : null,
        expanded: sidebarDockState.expanded,
        visibility: document.visibilityState,
      }),
    }).catch(console.error);
  }, [windowLabel, appConfig.sidebar_theme, appConfig.sidebar_widgets, sidebarDockState.expanded]);

  useEffect(() => {
    const win = appWindow;

    let unlisteners: (() => void)[] = [];
    let active = true;

    const init = async () => {
      try {
        const label = win.label;

        // These windows have their own config subscription above. Sidebar
        // content widgets load their own data; unrelated service/autostart
        // failures must never prevent appearance updates from being registered.
        if (label === "tray-menu" || label === "sidebar") return;

        if (label.startsWith("widget-")) {
          const [ac, tc] = await Promise.all([
            tauriInvoke("get_app_config"),
            tauriInvoke("get_theme_config"),
          ]);
          if (!active) return;

          setThemeConfig(tc);

          const pinned = ac.always_on_top?.[label] ?? false;
          setIsPinned(pinned);

          if (!isMacOS) {
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
          }

          const uTheme = await tauriListen("theme_update", (event) => {
            if (!active) return;
            const config = event.payload;
            setThemeConfig(config);
          });
          unlisteners.push(() => uTheme());
          return;
        }

        void isEnabled().then((enabled) => {
          if (active) setIsAutostart(enabled);
        }).catch((error) => console.error("Autostart status unavailable", error));

        const [gc, qc, tc] = await Promise.all([
          tauriInvoke("get_gpu_config"),
          tauriInvoke("get_quota_config"),
          tauriInvoke("get_theme_config"),
        ]);

        if (!active) return;

        setGpuConfig(gc);
        setQuotaConfig(qc);
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

        const u5 = await tauriListen("theme_update", (event) => {
          if (!active) return;
          const config = event.payload;
          if (!themePendingWrites.current) setThemeConfig(config);
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
    const previous = paperConfigRef.current;
    const revision = ++paperSaveRevision.current;
    paperPendingWrites.current += 1;
    paperConfigRef.current = newConfig;
    setPaperConfig(newConfig);
    setPaperSaveError(false);
    // Respond to the click immediately and serialize writes so fast actions
    // cannot replace one another with a stale config or delayed response.
    const save = paperSaveQueue.current.catch(() => {}).then(() => tauriInvoke("save_paper_config", { config: newConfig }));
    paperSaveQueue.current = save;
    try {
      await save;
      return true;
    } catch (e) {
      console.error("Save failed", e);
      if (revision !== paperSaveRevision.current) return false;
      let saved = previous;
      try { saved = await tauriInvoke("get_paper_config"); } catch { /* Keep the last known config if reading also fails. */ }
      if (revision === paperSaveRevision.current) {
        paperConfigRef.current = saved;
        setPaperConfig(saved);
        setPaperSaveError(true);
        setPaperPreferenceUndo(null);
      }
      return false;
    } finally {
      paperPendingWrites.current -= 1;
      if (!paperPendingWrites.current && revision === paperSaveRevision.current) {
        try {
          const saved = await tauriInvoke("get_paper_config");
          if (!paperPendingWrites.current && revision === paperSaveRevision.current) {
            paperConfigRef.current = saved;
            setPaperConfig(saved);
          }
        } catch (error) { console.error("Could not reload conference preferences", error); }
      }
    }
  };

  const setConferencePreference = (ids: string[], action: ConferencePreference, undoable = false) => {
    const previous = paperConfigRef.current;
    setPaperPreferenceUndo(undoable ? { config: previous, id: ++paperUndoId.current } : null);
    void savePaperConfig(updateConferencePreferences(previous, ids, action));
  };

  const undoConferencePreference = () => {
    if (!paperPreferenceUndo) return;
    const { followed_conference_ids, ignored_conference_ids, subscribed_titles, ignored_titles, pinned_titles, pinned_deadline_ids } = paperPreferenceUndo.config;
    setPaperPreferenceUndo(null);
    void savePaperConfig({ ...paperConfigRef.current, followed_conference_ids, ignored_conference_ids, subscribed_titles, ignored_titles, pinned_titles, pinned_deadline_ids });
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
    const updated = await tauriInvoke("save_sidebar_tile_layout", {
      order: nextOrder,
      layout: nextLayout,
      widgets: nextWidgets,
    });
    setAppConfig(updated);
  };

  const handleMasterServiceToggle = createMasterServiceToggleHandler({
    appConfig,
    onSaveApp,
    serviceDisableHandlers,
    onActiveWidgetsChanged,
    serviceToggleCallbacks,
    onClearGeneralError: () => setGeneralServiceRefreshError(null),
  });

  const saveArxivConfig = async (changes: Partial<ArxivConfig>): Promise<FilterSaveResult> => {
    const newConfig = { ...arxivConfigRef.current, ...changes };
    const revision = ++arxivSaveRevision.current;
    arxivConfigRef.current = newConfig;
    arxivPendingWrites.current += 1;
    setArxivConfig(newConfig);
    setIsRefreshingArxiv(true);
    setArxivFilterState("applying");
    setArxivError(null);
    setArxivRefreshError(null);
    // A keyword draft can be committed while a category or preference save is
    // still running. Keep their writes ordered and merge from the latest intent.
    const save = arxivSaveQueue.current.catch(() => false).then(() => tauriInvoke("save_arxiv_config", { config: newConfig }));
    arxivSaveQueue.current = save;
    try {
      const updated = await save;
      const result = updated ? "applied" : "refresh-error";
      if (revision === arxivSaveRevision.current) setArxivFilterState(result);
      return result;
    } catch (error) {
      console.error("Save arXiv filters failed", error);
      if (revision === arxivSaveRevision.current) setArxivFilterState("save-error");
      return "save-error";
    } finally {
      arxivPendingWrites.current -= 1;
      if (!arxivPendingWrites.current && revision === arxivSaveRevision.current) {
        setIsRefreshingArxiv(false);
        try {
          const saved = await tauriInvoke("get_arxiv_config");
          if (!arxivPendingWrites.current && revision === arxivSaveRevision.current) {
            arxivConfigRef.current = saved;
            setArxivConfig(saved);
          }
        } catch (error) { console.error("Could not reload arXiv filters", error); }
      }
    }
  };


  const activeArxivPapers = arxivView === "unread" && !hasReadingKeywords ? [] : pagedArxivView ? pagedArxiv.papers : arxivView === "unread" ? arxivPapers : arxivSavedPapers;
  const arxivSelection = useResearchSelection(activeArxivPapers, arxivPaperKey, JSON.stringify([activeTab, arxivView, arxivDate, pagedArxivView ? pagedArxiv.page : null, arxivConfig.categories, arxivConfig.keywords]));
  const arxivKeywordGroups = groupArxivPapersByKeyword(arxivView === "unread" && arxivDate ? pagedArxiv.papers : arxivPapers, arxivConfig.keywords);
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
      <div className="flex flex-1 min-w-0 min-h-0 flex-col">
        <div className="flex items-start gap-2">
        {arxivSelection.enabled && <input type="checkbox" checked={arxivSelection.has(paper)} disabled={arxivLibrary.busy} onChange={() => arxivSelection.toggle(paper)} aria-label={paper.title} className="mt-1 size-4 shrink-0 accent-blue-600" />}
        <h3 data-no-localize
          className={`min-w-0 flex-1 shrink-0 text-sm font-bold leading-relaxed break-words mb-2 ${
            appConfig.theme === "light" ? "text-slate-900" : "text-white"
          }`}
        >
          {paper.title}
        </h3>
        </div>
        <ArxivPaperMetadata paper={paper} isLight={appConfig.theme === "light"} className="mb-2 shrink-0" />
        <ArxivAbstractPreview paper={paper} isLight={appConfig.theme === "light"} />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--dashboard-border)] pt-2">
        <ArxivReadingActions paper={paper} library={arxivLibrary} allowSkip={arxivView === "unread" && !arxivDate} />
        <ArxivPaperActions paper={paper} />
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
    const revision = ++themeSaveRevision.current;
    themePendingWrites.current += 1;
    setThemeConfig(config);
    const save = themeSaveQueue.current.catch(() => {}).then(() => tauriInvoke("save_theme_config", { config }));
    themeSaveQueue.current = save;
    try {
      await save;
    } finally {
      themePendingWrites.current -= 1;
      if (!themePendingWrites.current && revision === themeSaveRevision.current) {
        try {
          const saved = await tauriInvoke("get_theme_config");
          if (!themePendingWrites.current && revision === themeSaveRevision.current) setThemeConfig(saved);
        } catch (error) { console.error("Could not reload floating appearance", error); }
      }
    }
  };

  const toggleMaximize = async () => {
    try {
      await appWindow.toggleMaximize();
    } catch (e) {
      console.error(e);
    }
  };

  const handleToggleWidget = async (id: string, title: string) => {
    if (pendingToggles.has(id) || widgetsVisibilityBusy) return;
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

  const toggleWidgetsVisibility = async () => {
    if (widgetsVisibilityBusy || pendingToggles.size > 0) return;
    setWidgetsVisibilityBusy(true);
    setToggleWidgetError(null);
    try {
      setAppConfig(await tauriInvoke("toggle_widgets_visibility"));
    } catch (error) {
      setToggleWidgetError(String(error));
    } finally {
      setWidgetsVisibilityBusy(false);
    }
  };

  const toggleLock = async () => {
    setIsLocked(previous => !previous);
  };

  const togglePin = async (labelToToggle?: string) => {
    try {
      const targetLabel = labelToToggle || windowLabel;
      const currentVal = targetLabel === windowLabel ? isPinned : appConfig.always_on_top?.[targetLabel] || false;
      const next = !currentVal;

      if (!isMacOS) {
        const targetWin = targetLabel === windowLabel ? appWindow : await WebviewWindow.getByLabel(targetLabel);
        if (next) {
          await tauriInvoke("set_desktop_mode", { label: targetLabel, enabled: false });
          await targetWin?.setAlwaysOnTop(true);
        } else {
          await targetWin?.setAlwaysOnTop(false);
          await tauriInvoke("set_desktop_mode", { label: targetLabel, enabled: true });
        }
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
      throw e;
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
          // The native loop owns drag state. Its completion event can arrive
          // before this command resolves, so applying the command's initial
          // snapshot here could leave the "moving" overlay stuck on screen.
          await tauriInvoke("begin_sidebar_drag");
          return;
        }
        if (isWindows && windowLabel.startsWith("widget-")) {
          e.preventDefault();
          await tauriInvoke("begin_widget_drag", { label: windowLabel });
        } else {
          await getCurrentWindow().startDragging();
        }
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
    if (!["main", "sidebar", "tray-menu"].includes(windowLabel)) return;

    const sync = startWindowSnapshotSync<SidebarDockState>({
      listen: (apply) => tauriListen("sidebar_state_update", (event) => apply(event.payload)),
      read: () => tauriInvoke("get_sidebar_state"),
      apply: setSidebarDockState,
      onError: console.error,
    });
    return sync.stop;
  }, [windowLabel]);

  useEffect(() => {
    if (windowLabel !== "sidebar" || !sidebarDockState.expanded) return;
    let active = true;
    let inFlight = false;
    const refresh = async () => {
      if (!active || inFlight) return;
      inFlight = true;
      try {
        await appConfigSync.current?.refresh();
      } finally {
        inFlight = false;
      }
    };
    // The Windows sidebar is a separate WebView2 window. Check persisted
    // settings while it is visible so a missed cross-window event cannot leave
    // theme or module visibility stale. The config file is small.
    void refresh();
    const interval = isMacOS ? undefined : window.setInterval(refresh, 500);
    return () => {
      active = false;
      if (interval !== undefined) window.clearInterval(interval);
    };
  }, [windowLabel, sidebarDockState.expanded]);

  useEffect(() => {
    if (!isMacOS || windowLabel !== "main") return;
    tauriInvoke("get_native_quota_widget_status")
      .then(setNativeWidgetsAvailable)
      .catch(console.error);
  }, [windowLabel]);

  // --- CUSTOM TRAY MENU VIEW ---
  if (windowLabel === "tray-menu") {
    return (
      <div className="h-screen w-screen flex flex-col bg-white border border-slate-200 rounded-lg overflow-hidden shadow-xl p-1 select-none">
        <button
          onClick={() => tauriInvoke("toggle_sidebar_visibility").catch(console.error)}
          className="w-full flex items-center gap-3 px-3 py-1.5 rounded-md hover:bg-slate-100 text-slate-700 transition-colors group"
        >
          <Activity
            size={14}
            className="text-slate-500 group-hover:text-cyan-600 transition-colors"
          />
          <span className="text-[11px] font-bold">{sidebarDockState.expanded ? "Hide Sidebar" : "Open Sidebar"}</span>
        </button>
        <button
          onClick={() => tauriInvoke("show_main")}
          className="w-full flex items-center gap-3 px-3 py-1.5 rounded-md hover:bg-slate-100 text-slate-700 transition-colors group"
        >
          <LayoutDashboard
            size={14}
            className="text-slate-500 group-hover:text-blue-600 transition-colors"
          />
          <span className="text-[11px] font-bold">Dashboard</span>
        </button>
        {hasFloatingWidgets && <button
          disabled={widgetsVisibilityBusy}
          onClick={() => toggleWidgetsVisibility().then(() => appWindow.hide()).catch(console.error)}
          className="w-full flex items-center gap-3 px-3 py-1.5 rounded-md hover:bg-slate-100 text-slate-700 transition-colors group"
        >
          {appConfig.widgets_hidden ? <Eye size={14} /> : <EyeOff size={14} />}
          <span className="text-[11px] font-bold">{appConfig.widgets_hidden ? "Show Widgets" : "Hide Widgets"}</span>
        </button>}
        <div role="separator" className="mx-2 my-1 border-t border-slate-200" />
        <button
          onClick={() => tauriInvoke("exit_app")}
          className="w-full flex items-center gap-3 px-3 py-1.5 rounded-md hover:bg-red-50 text-slate-700 hover:text-red-600 transition-colors group"
        >
          <X size={14} className="text-slate-500 group-hover:text-red-500 transition-colors" />
          <span className="text-[11px] font-bold">Quit</span>
        </button>
      </div>
    );
  }

  // --- SUMMONABLE SIDEBAR HUB VIEW ---
  if (windowLabel === "sidebar") {
    if (appConfig.sidebar_enabled === false) return null;
    const openDashboard = async () => {
      await tauriInvoke("show_main");
    };
    const sidebarIsLight = isLightColor(sidebarTheme.background);
    const sidebarWindowBorder = sidebarIsLight
      ? "rgba(203, 213, 225, 0.96)"
      : "rgba(255, 255, 255, 0.4)";
    const sidebarDockRounding: Record<SidebarDockState["edge"], string> = {
      left: "rounded-r-lg",
      top: "rounded-b-lg",
      right: "rounded-l-lg",
      bottom: "rounded-t-lg",
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
    const heightLimits = Object.fromEntries(DEFAULT_SIDEBAR_ORDER.map((key) => [key,
      sidebarTileHeightLimits(key, sidebarViewportHeight - 48, sidebarContentHeights[key]?.height),
    ])) as SidebarTileHeightLimitMap;
    const deadlineHeight = sidebarContentHeights.deadlines;
    const timelineGrowth = deadlineHeight?.expanded && !sidebarExpandedResizeOverrides.current.has("deadlines")
      ? Math.max(0, deadlineHeight.height - deadlineHeight.collapsedHeight) : 0;
    const sidebarBaseLayout = constrainSidebarTileHeights(
      sidebarTileLayoutDraft ?? normalizeSidebarTileLayout(appConfig.sidebar_tile_layout, visibleSidebarKeys),
      visibleSidebarKeys, heightLimits,
    );
    const sidebarTileLayout = constrainSidebarTileHeights(
      sidebarBaseLayout, visibleSidebarKeys, heightLimits,
      { deadlines: timelineGrowth },
    );
    const effectiveTimelineGrowth = sidebarTileLayout.deadlines.h - sidebarBaseLayout.deadlines.h;
    const withoutTimelineGrowth = (layout: Record<SidebarSectionKey, SidebarTileRect>) =>
      effectiveTimelineGrowth > 0 && !sidebarExpandedResizeOverrides.current.has("deadlines") ? {
        ...layout,
        deadlines: { ...layout.deadlines, h: Math.max(heightLimits.deadlines.min, layout.deadlines.h - effectiveTimelineGrowth) },
      } : layout;
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
        content: <DeadlineWidgetContent hideHeader={hideSidebarWidgetHeaders} language={resolveLanguage(appConfig.language)} />,
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
      // Moving cards while a timeline is open must not save its temporary
      // expansion as the user's collapsed reading height.
      const savedLayout = withoutTimelineGrowth(nextLayout);
      const compactedLayout = constrainSidebarTileHeights(savedLayout, visibleSidebarKeys, heightLimits);
      sidebarOrderRef.current = nextOrder;
      setSidebarTileLayoutDraft(compactedLayout);
      tauriInvoke("save_sidebar_tile_layout", {
        order: nextOrder,
        layout: compactedLayout,
        widgets: null,
      })
        .then(setAppConfig)
        .catch(console.error);
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
          setSidebarTileLayoutDraft(withoutTimelineGrowth(sidebarTileLayout));
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
        setSidebarTileLayoutDraft(withoutTimelineGrowth(sidebarTileLayout));
      };
      const onWindowBlur = () => {
        cleanup();
        setSidebarTileLayoutDraft(withoutTimelineGrowth(sidebarTileLayout));
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
      // An explicit resize while a timeline is open overrides automatic fit
      // until it is collapsed. Start from the currently displayed height.
      if (sidebarContentHeights[key]?.expanded) {
        sidebarExpandedResizeOverrides.current.add(key);
        setSidebarTileLayoutDraft(sidebarTileLayout);
      }
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
          metrics.width,
          heightLimits[key],
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
        setSidebarTileLayoutDraft(withoutTimelineGrowth(latestLayout));
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
        setSidebarTileLayoutDraft(withoutTimelineGrowth(sidebarTileLayout));
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
        data-sidebar-theme={sidebarTheme.id}
        data-sidebar-edge={sidebarDockState.edge}
        data-glass-tone={isWindows || sidebarGlass ? (sidebarIsLight ? "light" : "dark") : undefined}
        data-native-glass={sidebarGlass && nativeGlass ? "true" : undefined}
        className={`absolute inset-0 flex flex-col overflow-hidden select-none transition-[box-shadow,outline-color] duration-150 ease-out ${sidebarGlass ? "glass-surface glass-sidebar" : ""} ${sidebarDockRounding[sidebarDockState.edge]} ${
          sidebarIsLight ? "text-slate-900" : "text-white"
        }`}
        style={{
          ...(isWindows ? { "--surface-radii": ({ left: "0 8px 8px 0", top: "0 0 8px 8px", right: "8px 0 0 8px", bottom: "8px 8px 0 0" })[sidebarDockState.edge] } : {}),
          backgroundColor: hexToRgba(
            sidebarTheme.background,
            sidebarGlass && !nativeGlass ? (isWindows ? 0.86 : 0.88) : sidebarTheme.background_opacity
          ),
          backdropFilter:
            !sidebarGlass && sidebarTheme.blur > 0
              ? `blur(${sidebarTheme.blur}px) saturate(145%)`
              : undefined,
          WebkitBackdropFilter:
            !sidebarGlass && sidebarTheme.blur > 0
              ? `blur(${sidebarTheme.blur}px) saturate(145%)`
              : undefined,
          // Glass already supplies its own rim. Stacking the old border and
          // inset outline on it creates a conspicuous white frame.
          border: `1px solid ${sidebarGlass ? "transparent" : sidebarWindowBorder}`,
          boxShadow: sidebarGlass ? undefined : `inset 0 0 0 1px ${sidebarWindowBorder}`,
          outline: sidebarDockState.dragging ? "2px solid rgba(56, 189, 248, 0.72)" : undefined,
          outlineOffset: sidebarDockState.dragging ? "-2px" : undefined,
        } as React.CSSProperties}
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
        <header
          aria-label="Drag sidebar"
          className={`h-11 shrink-0 flex items-center justify-between gap-2 px-3 border-b ${sidebarIsLight ? "border-slate-300/60" : "border-white/10"} ${isMacOS ? "cursor-default" : "cursor-grab active:cursor-grabbing"}`}
          style={{ backgroundColor: hexToRgba(sidebarTheme.header, sidebarTheme.header_opacity) }}
          onMouseDown={isMacOS ? undefined : startDrag}
        >
          <span className="text-xs font-bold tracking-wide">Widgitron Sidebar</span>
          <div className="flex items-center gap-2" data-no-drag="true" onMouseDown={(event) => event.stopPropagation()}>
            <button
              type="button"
              aria-label={sidebarDockState.pinned ? "Unpin sidebar" : "Pin sidebar open"}
              aria-pressed={sidebarDockState.pinned}
              title={sidebarDockState.pinned ? "Unpin sidebar and enable auto-hide" : "Pin sidebar open"}
              onClick={() => {
                tauriInvoke("set_sidebar_pinned", { pinned: !sidebarDockState.pinned })
                  .then(setSidebarDockState)
                  .catch(console.error);
              }}
              className={`flex h-7 w-7 items-center justify-center rounded-md transition-colors focus-visible:outline-2 focus-visible:outline-sky-400 ${sidebarIsLight ? "bg-slate-100 text-slate-700 hover:bg-slate-200" : "bg-white/10 text-white hover:bg-white/20"}`}
            >
              {sidebarDockState.pinned ? <Pin size={14} /> : <PinOff size={14} />}
            </button>
            <button
              type="button"
              aria-label="Hide sidebar"
              title="Hide sidebar"
              onClick={() => tauriInvoke("hide_sidebar").catch(console.error)}
              className="flex h-7 w-7 items-center justify-center rounded-md bg-red-500/15 text-red-500 hover:bg-red-500/25 transition-colors focus-visible:outline-2 focus-visible:outline-red-400"
            >
              <X size={14} />
            </button>
          </div>
        </header>
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
                    data-sidebar-module={section.key}
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
                      sectionKey={section.key}
                      onContentHeight={reportSidebarContentHeight}
                      title={section.title}
                      accentColor={section.accentColor}
                      theme={sidebarTheme}
                      isLight={sidebarIsLight}
                      showHeader={!hideSidebarWidgetHeaders}
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

    const controls = <FloatingWindowControls locked={isLocked} pinned={isPinned}
      light={Boolean(currentTheme && isLightColor(currentTheme.bg_color))}
      onToggleLock={toggleLock} onTogglePin={() => togglePin()} onHide={handleClose} />;

    return (
      <div className={`floating-window absolute inset-0 flex flex-col group select-none overflow-hidden bg-transparent p-0 ${currentTheme?.material === "native-glass" ? "glass-surface" : ""}`}
        role={currentTheme?.material === "native-glass" ? "group" : undefined} aria-label={currentTheme?.material === "native-glass" ? "Glass" : undefined}
        data-native-glass={nativeGlass ? "true" : undefined}
        data-floating-surface={currentTheme && (currentTheme.bg_opacity >= 0.5 || currentTheme.material === "native-glass") && isLightColor(currentTheme.bg_color) ? "light" : undefined}>

        <div
          className="min-h-0 flex-1 p-3 flex flex-col relative overflow-hidden rounded-xl z-10"
          style={
            windowLabel.startsWith("widget-") && currentTheme
              ? {
                  backgroundColor: hexToRgba(currentTheme.bg_color,
                    currentTheme.material === "native-glass" && !nativeGlass ? (isWindows ? 0.86 : 0.84) : currentTheme.bg_opacity),
                  color: currentTheme.text_colors?.find((c) => c.name === "Main Text")
                    ? hexToRgba(
                        currentTheme.text_colors.find((c) => c.name === "Main Text")!.value,
                        currentTheme.text_colors.find((c) => c.name === "Main Text")!.opacity ?? 1.0
                      )
                    : "#ffffff",
                  border: nativeGlass ? "1px solid transparent" : `1px solid ${hexToRgba(
                    currentTheme.text_colors?.find((c) => c.name === "Main Text")?.value || "#ffffff",
                    0.1
                  )}`
                }
              : {}
          }
          onMouseDown={!isLocked ? startDrag : undefined}
          data-tauri-drag-region={!isLocked && !isWindows ? "true" : "false"}
        >
          {isGpu && <GPUWidgetContent headerControls={controls} />}
          {isDeadline && <DeadlineWidgetContent language={resolveLanguage(appConfig.language)} headerControls={controls} />}
          {windowLabel.includes("arxiv") && <ArxivWidgetContent headerControls={controls} />}
          {isQuota && <QuotaWidgetContent headerControls={controls} />}
        </div>
        {(isMacOS || isWindows) && <WidgetResizeHandle />}
      </div>
    );
  }

  const renderSettingsPanel = (section: SettingsSection, embedded = false) => (
    <SettingsPanel
      key={`${embedded ? "inline" : "settings"}-${section}`}
      initialSection={section}
      embeddedSection={embedded ? section : undefined}
      gpuConfig={gpuConfig}
      paperConfig={paperConfig}
      arxivConfig={arxivConfig}
      appConfig={appConfig}
      quotaConfig={quotaConfig}
      themeConfig={themeConfig}
      onSaveGpu={saveGpuConfig}
      onSavePaper={savePaperConfig}
      onSaveArxiv={saveArxivConfig}
      arxivFilterState={arxivFilterState}
      onSaveQuota={saveQuotaConfig}
      onSaveApp={onSaveApp}
      onToggleSidebarWidget={saveSidebarWidgetVisibility}
      sidebarExpanded={sidebarDockState.expanded}
      onToggleSidebar={() => tauriInvoke("toggle_sidebar_visibility").catch(console.error)}
      onSaveThemes={onSaveThemes}
      isAutostart={isAutostart}
      onToggleAutostart={async () => {
        if (isAutostart) await disable();
        else await enable();
        setIsAutostart(await isEnabled());
      }}
      updateInfo={updateInfo}
      setUpdateInfo={setUpdateInfo}
      updateCheckError={updateCheckError}
      setUpdateCheckError={setUpdateCheckError}
    />
  );

  const renderInlineSettings = (section: SettingsSection) => {
    if (inlineSettingsSection !== section) return null;
    const filterTitle = section === LIVE_DATA_SECTION.DEADLINES ? "Conference filters"
      : section === LIVE_DATA_SECTION.ARXIV ? "Paper filters" : null;
    const closeLabel = filterTitle ? "Close filters" : "Close settings";
    return (
      <section id={`page-options-${section}`} aria-label={filterTitle ?? "Page settings"} className={`mb-8 rounded-2xl border border-l-[3px] p-5 shadow-sm ${appConfig.theme === "light" ? "border-blue-200 border-l-blue-500 bg-blue-50/70" : "border-blue-400/25 border-l-blue-400 bg-blue-500/5"}`}>
        <div className="mb-5 flex items-center justify-between gap-3 border-b border-blue-400/15 pb-4">
          <h3 className="flex items-center gap-2 text-sm font-bold text-blue-500">
            {filterTitle ? <><SlidersHorizontal size={16} /><span>{filterTitle}</span></>
              : <><Settings size={16} /><span>{LIVE_DATA_SECTION_LABELS[section as keyof typeof LIVE_DATA_SECTION_LABELS]}</span><span>Settings</span></>}
          </h3>
          <button type="button" onClick={() => setInlineSettingsSection(null)} aria-label={closeLabel} title={closeLabel} className="flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--dashboard-border)] text-red-500 hover:bg-red-500/10 focus-visible:outline-2 focus-visible:outline-red-500"><X size={16} /></button>
        </div>
        {renderSettingsPanel(section, true)}
      </section>
    );
  };

  const sectionActionClass = `inline-flex min-h-9 whitespace-nowrap items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-semibold transition-colors ${appConfig.theme === "light" ? "border-slate-200 bg-white text-slate-700 hover:bg-blue-50" : "border-white/10 bg-white/5 text-slate-100 hover:bg-white/10"}`;

  // --- MAIN CONTROL PANEL VIEW ---
  return (
    <div
      className={`absolute inset-0 flex overflow-hidden ${appConfig.theme === "light" ? "light-theme" : ""} glass ${
        isMacOS ? "macos-dashboard" : isMaximized ? "rounded-none" : "rounded-xl dashboard-accent-border"
      }`}
    >
      {/* Sidebar */}
      <aside
        className={`relative w-64 border-r border-white/5 flex flex-col bg-[var(--sidebar-bg)] z-20 select-none`}
        onMouseDown={(event) => {
          // Let Tauri handle this strip's native drag/double-click sequence;
          // starting another drag here consumes its second click on macOS.
          if (isMacOS && (event.target as HTMLElement).closest("[data-tauri-drag-region]")) return;
          void startDrag(event);
        }}
      >
        {isMacOS && <div className="absolute inset-x-0 top-0 z-50 h-8" data-tauri-drag-region="true" />}
        <div className={`${isMacOS ? "px-6 pt-11 pb-3" : "p-6"} flex items-center gap-2.5 cursor-default`}>
          <div className="w-9 h-9 bg-blue-600 rounded-xl flex items-center justify-center shadow-lg shadow-blue-500/40 overflow-hidden pointer-events-none">
            <img src="/logo.png" alt="Widgitron" className="w-full h-full object-cover" />
          </div>
          <div className="pointer-events-none flex flex-col justify-center space-y-1.5">
            <h1 className="font-bold text-base tracking-tight leading-none">{APP_NAME}</h1>
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
          {MODULE_NAVIGATION.map(({ section, label, Icon }) => (
            <SidebarLink key={section} icon={<Icon size={20} />} label={label}
              active={activeTab === section} onClick={() => setActiveTab(section)} theme={appConfig.theme} />
          ))}
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
      <main className="flex-1 flex flex-col min-w-0 min-h-0 z-20">
        {/* Keep a compact window drag area; the page below owns its title. */}
        <header
          className={`${isMacOS ? "h-8" : "h-10"} shrink-0 flex items-center justify-end px-2 relative z-50 select-none pointer-events-auto ${appConfig.theme === "light" ? "bg-transparent" : "bg-black/5"}`}
          data-tauri-drag-region="true"
        >
          {!isMacOS && <div className="flex items-center gap-0.5 z-[60] pointer-events-auto">
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
          </div>}
        </header>

        {/* Remount the scroll viewport on navigation so a new page starts at the top. */}
        <div
          key={activeTab}
          className={`flex-1 overflow-y-auto px-8 pb-8 ${isMacOS ? "pt-3" : "pt-2"} custom-scrollbar relative z-0 ${
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
          <>
            {activeTab === "dashboard" && (
              <div
                key="dashboard"
                className="space-y-6"
              >
                <ToggleErrorBanner
                  message={toggleWidgetError}
                  onDismiss={() => setToggleWidgetError(null)}
                  theme={appConfig.theme}
                />
                <h2 className="text-2xl font-bold tracking-tight text-[var(--dashboard-text)]">Overview</h2>
                <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 240px), 1fr))" }}>
                  {MODULE_NAVIGATION.map(({ section, label, Icon, accent }) => {
                    const stat = {
                      quota: { value: monitoredAgentCount, metric: "monitors", hint: quotaStatHint, hintTone: quotaStatHintTone },
                      gpu: { value: totalGpus.toString(), metric: "GPUs", hint: gpuStatHint, hintTone: gpuStatHintTone },
                      deadlines: { value: overviewConferenceCount.toString(), metric: overviewShowsFollowed ? "followed" : undefined, hint: paperStatHint, hintTone: paperStatHintTone },
                      arxiv: { value: hasReadingKeywords ? arxivPapers.length.toString() : allArxiv.loaded ? allArxiv.total.toString() : allArxiv.loading ? "…" : "—",
                        metric: hasReadingKeywords ? "to read" : "recent", hint: overviewArxivHint.hint, hintTone: overviewArxivHint.tone },
                    }[section];
                    return <StatCard key={section} label={label} {...stat} icon={<Icon className={accent} />}
                      theme={appConfig.theme} onClick={() => {
                        if (section === "arxiv") {
                          setArxivDate("");
                          setArxivView(hasReadingKeywords ? "unread" : "all");
                        }
                        setActiveTab(section);
                      }} />;
                  })}
                </div>

                <div>
                  <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                    <h2
                      className={`text-xl font-bold tracking-tight ${
                        appConfig.theme === "light" ? "text-slate-900" : "text-white"
                      }`}
                    >
                      Modules & Display
                    </h2>
                    <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => tauriInvoke("toggle_sidebar_visibility").catch(console.error)}
                      className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg border text-xs font-black uppercase tracking-widest transition-colors ${
                        appConfig.theme === "light"
                          ? "bg-white border-slate-200 text-slate-700 hover:bg-slate-50"
                          : "bg-white/5 border-white/10 text-slate-200 hover:bg-white/10"
                      }`}
                    >
                      <Activity size={14} />
                      {sidebarDockState.expanded ? "Hide Sidebar" : "Open Sidebar"}
                    </button>
                    {hasFloatingWidgets && <button
                      type="button"
                      onClick={toggleWidgetsVisibility}
                      disabled={widgetsVisibilityBusy || pendingToggles.size > 0}
                      className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg border text-xs font-black uppercase tracking-widest transition-colors disabled:cursor-wait disabled:opacity-50 ${appConfig.theme === "light" ? "bg-white border-slate-200 text-slate-700 hover:bg-slate-50" : "bg-white/5 border-white/10 text-slate-200 hover:bg-white/10"}`}
                    >
                      {appConfig.widgets_hidden ? <Eye size={14} /> : <EyeOff size={14} />}
                      {appConfig.widgets_hidden ? "Show Widgets" : "Hide Widgets"}
                    </button>}
                    </div>
                  </div>
                  {isMacOS && (
                    <p className={`mb-4 text-xs ${appConfig.theme === "light" ? "text-slate-500" : "text-slate-300"}`}>
                      {nativeWidgetsAvailable
                        ? "macOS widgets: Quota · GPU · Deadlines"
                        : "System widgets unavailable in this build."}
                    </p>
                  )}
                  <div className="grid grid-cols-2 gap-3">
                    {MODULE_NAVIGATION.map(({ field, detail }) => {
                      const { id, title } = serviceWidgetMeta(field);
                      const section = SERVICE_FIELD_TO_TAB[field];
                      return (
                        <WidgetPreviewCard
                          key={id}
                          title={title}
                          detail={detail}
                          theme={appConfig.theme}
                          enabled={appConfig[field] !== false}
                          sidebarVisible={appConfig.sidebar_widgets?.[section] !== false}
                          floatingVisible={activeWidgets.includes(id)}
                          loading={pendingToggles.has(id) || widgetsVisibilityBusy}
                          onToggleSidebar={() => {
                            saveSidebarWidgetVisibility(section, appConfig.sidebar_widgets?.[section] === false)
                              .catch((error) => setToggleWidgetError(String(error)));
                          }}
                          onToggleFloating={() => handleToggleWidget(id, title)}
                          onConfigure={() => openSettingsSection(section)}
                        />
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {activeTab === LIVE_DATA_SECTION.GPU && (
              <div
                key="gpu"
              >
                <div className="flex flex-wrap items-center justify-between gap-3 mb-8">
                  <h2
                    className={`text-2xl font-bold tracking-tight ${
                      appConfig.theme === "light" ? "text-slate-900" : "text-white"
                    }`}
                  >
                    GPU Monitor Status
                  </h2>
                  <div className="flex items-center gap-3">
                    <button type="button" onClick={() => openInlineSettings(LIVE_DATA_SECTION.GPU)} aria-expanded={inlineSettingsSection === LIVE_DATA_SECTION.GPU} className={sectionActionClass}>
                      {inlineSettingsSection === LIVE_DATA_SECTION.GPU ? <><ChevronDown size={14} className="rotate-180" /> Hide settings</> : <><Plus size={14} /> Add server</>}
                    </button>
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
                      label="GPU monitoring"
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
                {renderInlineSettings(LIVE_DATA_SECTION.GPU)}
                <div className="space-y-6">
                  {visibleGpuData.length === 0 ? (
                    <SectionEmptyState message="No GPU data yet. Add an SSH server to start monitoring." action={inlineSettingsSection === LIVE_DATA_SECTION.GPU ? "Hide settings" : "Add server"} onAction={() => openInlineSettings(LIVE_DATA_SECTION.GPU)} />
                  ) : (
                    visibleGpuData.map((server, idx) => {
                      const hasCachedGpus =
                        Array.isArray(server.gpu_list) && server.gpu_list.length > 0;
                      const noGpuDetected = server.error === "No GPU detected";
                      const showStaleOffline = !server.is_online && hasCachedGpus;

                      return (
                      <div key={idx} className="glass-card p-6">
                        <div className="flex items-center justify-between mb-6">
                          <div className="flex items-center gap-3">
                            <div
                              className={`w-3 h-3 rounded-full ${
                                noGpuDetected
                                  ? "bg-slate-400"
                                  : server.is_online
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
                        {server.is_online && server.system && (
                          <div className="grid grid-cols-2 gap-3 mb-6">
                            <div className={`rounded-xl px-4 py-3 ${appConfig.theme === "light" ? "bg-slate-50" : "bg-white/5"}`}>
                              <div className="text-[10px] font-bold text-slate-500">CPU</div>
                              <div className="text-lg font-bold">{formatCpuPercent(server.system.cpu_percent)}</div>
                              <div className="h-1.5 mt-2 rounded-full bg-slate-200/40 overflow-hidden">
                                <div className="h-full rounded-full bg-blue-500" style={{ width: `${server.system.cpu_percent ?? 0}%` }} />
                              </div>
                            </div>
                            <div className={`rounded-xl px-4 py-3 ${appConfig.theme === "light" ? "bg-slate-50" : "bg-white/5"}`}>
                              <div className="text-[10px] font-bold text-slate-500">RAM</div>
                              <div className="text-sm font-bold mt-1">{formatSystemMemory(server.system.memory_used_bytes)} / {formatSystemMemory(server.system.memory_total_bytes)}</div>
                              <div className="h-1.5 mt-2 rounded-full bg-slate-200/40 overflow-hidden">
                                <div className="h-full rounded-full bg-cyan-500" style={{ width: `${Math.min(100, 100 * server.system.memory_used_bytes / Math.max(1, server.system.memory_total_bytes))}%` }} />
                              </div>
                            </div>
                          </div>
                        )}
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
                              noGpuDetected ? "text-slate-500" : showStaleOffline ? "text-amber-400/80" : "text-red-400/60"
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
              </div>
            )}

            {activeTab === LIVE_DATA_SECTION.DEADLINES && (
              <div
                key="deadlines"
              >
                <DeadlineConferenceBrowser deadlines={deadlines} config={paperConfig} now={deadlineNow}
                  language={resolveLanguage(appConfig.language)} isLight={appConfig.theme === "light"} saveError={paperSaveError}
                  onPreference={setConferencePreference} onAdjustFilters={() => openInlineSettings(LIVE_DATA_SECTION.DEADLINES)}
                  headerActions={<>
                    <button type="button" onClick={() => openInlineSettings(LIVE_DATA_SECTION.DEADLINES)} aria-controls={`page-options-${LIVE_DATA_SECTION.DEADLINES}`} aria-expanded={inlineSettingsSection === LIVE_DATA_SECTION.DEADLINES} className={sectionActionClass}>
                      {inlineSettingsSection === LIVE_DATA_SECTION.DEADLINES ? <><ChevronDown size={14} className="rotate-180" /> Hide filters</> : <><SlidersHorizontal size={14} /> Filter conferences</>}
                    </button>
                    {appConfig.deadline_enabled !== false && (
                      <button type="button" onClick={handleRefreshDeadlines} disabled={isRefreshingDeadlines}
                        className={`flex size-9 items-center justify-center rounded-xl border border-[var(--dashboard-border)] transition-colors disabled:opacity-50 ${appConfig.theme === "light" ? "bg-white text-slate-600 hover:bg-slate-50" : "bg-white/5 text-slate-300 hover:bg-white/10"}`}
                        title="Refresh Deadlines" aria-label="Refresh Deadlines">
                        <RefreshCw size={14} className={isRefreshingDeadlines ? "animate-spin" : ""} />
                      </button>
                    )}
                    <span className="research-service-label text-[10px] font-semibold whitespace-nowrap text-slate-500">
                      {appConfig.deadline_enabled !== false ? "Service Enabled" : "Service Disabled"}
                    </span>
                    <MasterSwitch label="Deadline monitoring" enabled={appConfig.deadline_enabled !== false}
                      loading={checkServiceToggleBusy("deadline_enabled")} disabled={checkServiceToggleBusy("deadline_enabled")}
                      onToggle={val => handleMasterServiceToggle("deadline_enabled", val)} />
                  </>}>
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
                {renderInlineSettings(LIVE_DATA_SECTION.DEADLINES)}
                {paperSaveError && <p role="alert" className="mb-4 rounded-xl bg-red-500/10 px-4 py-3 text-xs text-red-500">Could not save conference preferences. Please try again.</p>}
                </DeadlineConferenceBrowser>
              </div>
            )}

            {activeTab === LIVE_DATA_SECTION.ARXIV && (
              <div
                key="arxiv"
              >
                <ResearchPageHeader title="arXiv Radar" headerRef={arxivHeaderRef}
                  tabs={<ResearchTabs value={arxivView} onChange={setArxivView} label="Paper views" idPrefix="arxiv" panelId="arxiv-results" isLight={appConfig.theme === "light"}
                    items={[
                      { value: "all", label: "All", count: allArxiv.loaded ? allArxiv.total : "…" },
                      { value: "unread", label: "To read", count: !hasReadingKeywords ? 0 : arxivDate ? matchedArxiv.loaded ? matchedArxiv.total : "…" : arxivPapers.length },
                      { value: "saved", label: "Saved", count: arxivSavedPapers.length },
                    ]} />}
                  toolbarActions={<>
                    <ResearchBulkToggle enabled={arxivSelection.enabled} onToggle={arxivSelection.toggleMode} isLight={appConfig.theme === "light"} disabled={arxivLibrary.busy} />
                    <ArxivSkippedDialog library={arxivLibrary} isLight={appConfig.theme === "light"} />
                  </>}
                  filter={(arxivView === "all" || (arxivView === "unread" && hasReadingKeywords)) && (
                    <ArxivDateFilter date={arxivDate} onChange={setArxivDate} buttonClass={`${sectionActionClass} w-full min-h-10`} isLight={appConfig.theme === "light"} language={resolveLanguage(appConfig.language)} />
                  )}
                  actions={<>
                    <button type="button" onClick={() => openInlineSettings(LIVE_DATA_SECTION.ARXIV)} aria-controls={`page-options-${LIVE_DATA_SECTION.ARXIV}`} aria-expanded={inlineSettingsSection === LIVE_DATA_SECTION.ARXIV} className={sectionActionClass}>
                      {inlineSettingsSection === LIVE_DATA_SECTION.ARXIV ? <><ChevronDown size={14} className="rotate-180" /> Hide filters</> : <><SlidersHorizontal size={14} /> Filter papers</>}
                    </button>
                    {appConfig.arxiv_enabled !== false && (arxivView !== "unread" || hasReadingKeywords) && (
                      <button type="button" onClick={pagedArxivView ? pagedArxiv.refresh : handleRefreshArxiv} disabled={refreshingArxivView}
                        className={`flex size-9 items-center justify-center rounded-xl border border-[var(--dashboard-border)] transition-colors disabled:opacity-50 ${appConfig.theme === "light" ? "bg-white text-slate-600 hover:bg-slate-50" : "bg-white/5 text-slate-300 hover:bg-white/10"}`}
                        title="Refresh papers" aria-label="Refresh papers">
                        <RefreshCw size={14} className={refreshingArxivView ? "animate-spin" : ""} />
                      </button>
                    )}
                    <span className="research-service-label text-[10px] font-semibold whitespace-nowrap text-slate-500">
                      {appConfig.arxiv_enabled !== false ? "Service Enabled" : "Service Disabled"}
                    </span>
                    <MasterSwitch label="Arxiv monitoring" enabled={appConfig.arxiv_enabled !== false}
                      loading={checkServiceToggleBusy("arxiv_enabled")} disabled={checkServiceToggleBusy("arxiv_enabled")}
                      onToggle={val => handleMasterServiceToggle("arxiv_enabled", val)} />
                  </>} />
                <div id="arxiv-results" role="tabpanel" aria-labelledby={`arxiv-tab-${arxivView}`}>
                {arxivLibrary.error && <div role="alert" className="mb-4 flex items-center justify-between gap-2 rounded-xl bg-red-500/10 px-4 py-3 text-xs text-red-500" title={arxivLibrary.error}>
                  <span>Could not update paper. Please try again.</span><button type="button" onClick={arxivLibrary.dismissError} aria-label="Dismiss error"><X size={14} /></button>
                </div>}
                <ServiceErrorBanners
                  backendError={pagedArxivView ? null : arxivError}
                  refreshError={arxivView === "unread" && !hasReadingKeywords ? null : pagedArxivView ? pagedArxiv.error : arxivRefreshError}
                  onDismissBackend={() => setArxivError(null)}
                  onDismissRefresh={pagedArxivView ? pagedArxiv.dismissError : () => setArxivRefreshError(null)}
                  theme={appConfig.theme}
                  showBackend={appConfig.arxiv_enabled !== false && (arxivView !== "unread" || hasReadingKeywords)}
                  backendCachedLabel={cachedLabelWhen(
                    arxivPapers.length > 0,
                    CACHED_LABELS.arxiv.backend
                  )}
                  refreshCachedLabel={cachedLabelWhen(
                    activeArxivPapers.length > 0,
                    CACHED_LABELS.arxiv.refresh
                  )}
                />
                {renderInlineSettings(LIVE_DATA_SECTION.ARXIV)}
                {inlineSettingsSection !== LIVE_DATA_SECTION.ARXIV && arxivFilterState !== "idle" && <div className="mb-4">
                  <FilterStatus state={arxivFilterState} progress="Saving filters and updating To read…"
                    applied={!hasReadingKeywords ? "To read is empty. Browse All without keywords."
                      : appConfig.arxiv_enabled === false ? "Filters saved. Enable monitoring to update To read." : "To read updated."}
                    error={arxivError} />
                </div>}
                {arxivSelection.enabled && <ResearchBulkControls total={activeArxivPapers.length} selected={arxivSelection.chosen.length} onToggleAll={arxivSelection.toggleAll} isLight={appConfig.theme === "light"} busy={arxivLibrary.busy} paged={pagedArxivView}>
                  <ArxivBulkActions chosen={arxivSelection.chosen} library={arxivLibrary} isLight={appConfig.theme === "light"} allowSkip={arxivView === "unread" && !arxivDate} onDone={arxivSelection.clear} />
                </ResearchBulkControls>}
                {pagedArxivView && (
                  <div className="mb-5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                    {pagedArxiv.data_date && <span><span>Submission date (UTC)</span><span data-no-localize> · {pagedArxiv.data_date}</span></span>}
                    {arxivView === "all" && <span>All papers in the selected categories, without keyword filtering.</span>}
                  </div>
                )}
                {pagedArxivView && pagedArxiv.total > 0 && (
                  <div className="mb-6">
                    <ArxivPagination page={pagedArxiv.page} pageSize={pagedArxiv.page_size} total={pagedArxiv.total} loading={pagedArxiv.loading} onPrevious={pagedArxiv.previousPage} onNext={pagedArxiv.nextPage} isLight={appConfig.theme === "light"} />
                  </div>
                )}
                {pagedArxivView && pagedArxiv.loading && activeArxivPapers.length === 0 ? (
                  <div role="status" className="flex items-center justify-center gap-2 py-16 text-xs text-slate-500">
                    <RefreshCw size={14} className="animate-spin" aria-hidden="true" />
                    Loading papers…
                  </div>
                ) : activeArxivPapers.length === 0 ? (
                  <SectionEmptyState
                    message={pagedArxivView
                      ? pagedArxiv.error ? "Could not load papers. Please retry." : arxivDate
                        ? arxivView === "unread" && (arxivConfig.keywords?.length ?? 0) > 0 ? "No papers matched your keywords on this submission date." : "No papers in the selected categories on this submission date."
                        : "No papers found in the selected categories."
                      : arxivView === "unread"
                      ? !hasReadingKeywords
                        ? "Add keywords to fill To read."
                        : "No papers to read. Adjust keywords or check back later."
                      : "No saved papers yet. Use Bookmark on a paper to keep it here."}
                    detail={arxivView === "unread" && !hasReadingKeywords ? "Without keywords, To read stays empty. Browse All to explore papers." : pagedArxivView && arxivDate && !pagedArxiv.error ? "Choose another date or view recent papers. Submissions not yet announced may appear later." : undefined}
                    action={pagedArxivView ? arxivDate && !pagedArxiv.error ? "Show recent papers" : "Refresh papers" : arxivView === "unread" ? (inlineSettingsSection === LIVE_DATA_SECTION.ARXIV ? "Hide filters" : "Filter papers") : "Show To read"}
                    onAction={pagedArxivView ? arxivDate && !pagedArxiv.error ? () => setArxivDate("") : pagedArxiv.refresh : arxivView === "unread"
                      ? () => openInlineSettings(LIVE_DATA_SECTION.ARXIV)
                      : () => setArxivView("unread")}
                  />
                ) : arxivView === "unread" ? (
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
                            <div className="p-5 pt-0 grid grid-cols-[repeat(auto-fit,minmax(min(100%,260px),1fr))] gap-4">
                              {group.papers.map((paper, idx) => renderArxivPaperCard(paper, idx))}
                            </div>
                          )}
                        </section>
                      );
                    })}
                  </div>
                ) : (
                  <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,260px),1fr))] gap-4">
                    {activeArxivPapers.map((paper, idx) => renderArxivPaperCard(paper, idx))}
                  </div>
                )}
                {pagedArxivView && pagedArxiv.total > 0 && (
                  <ArxivPagination page={pagedArxiv.page} pageSize={pagedArxiv.page_size} total={pagedArxiv.total} loading={pagedArxiv.loading} onPrevious={pagedArxiv.previousPage} onNext={pagedArxiv.nextPage} isLight={appConfig.theme === "light"} />
                )}
                </div>
              </div>
            )}

            {activeTab === LIVE_DATA_SECTION.QUOTA && (
              <div
                key="quota"
              >
                <div className="flex flex-wrap items-center justify-between gap-3 mb-8">
                  <h2
                    className={`text-2xl font-bold tracking-tight ${
                      appConfig.theme === "light" ? "text-slate-900" : "text-white"
                    }`}
                  >
                    Agent & API Quotas
                  </h2>
                  <div className="flex items-center gap-3">
                    <button type="button" onClick={() => openInlineSettings(LIVE_DATA_SECTION.QUOTA)} aria-expanded={inlineSettingsSection === LIVE_DATA_SECTION.QUOTA} className={sectionActionClass}>
                      {inlineSettingsSection === LIVE_DATA_SECTION.QUOTA ? <><ChevronDown size={14} className="rotate-180" /> Hide settings</> : <><Plus size={14} /> Add quota monitor</>}
                    </button>
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
                      label="Quota monitoring"
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
                {renderInlineSettings(LIVE_DATA_SECTION.QUOTA)}

                <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,340px),1fr))] items-start gap-6">
                  {visibleQuotaData.length === 0 ? (
                    <div className="col-span-full"><SectionEmptyState message="No quota sources configured yet." action={inlineSettingsSection === LIVE_DATA_SECTION.QUOTA ? "Hide settings" : "Add quota monitor"} onAction={() => openInlineSettings(LIVE_DATA_SECTION.QUOTA)} /></div>
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

                      const showBarReset =
                        q.provider === "codex" ||
                        q.provider === "antigravity" ||
                        q.provider === "claude-code";
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
                                {renderProviderIcon(q.provider, isManual, appConfig.theme === "light")}
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
                                    <div key={i} className="space-y-2">
                                      <div className="flex items-baseline justify-between gap-3">
                                        <span className={`min-w-0 break-words text-xs font-semibold ${appConfig.theme === "light" ? "text-slate-600" : "text-slate-300"}`}>
                                          {bar.name}
                                        </span>
                                        <span className="flex shrink-0 items-baseline gap-1.5">
                                          <span className="text-[10px] font-medium text-slate-500">Remaining</span>
                                          <span className={`tabular-nums text-base font-bold ${textClass}`}>
                                            {pct.toFixed(0)}%
                                          </span>
                                        </span>
                                      </div>
                                      <div className="w-full h-1.5 bg-black/20 rounded-full overflow-hidden border border-white/5">
                                        <div
                                          className={`h-full rounded-full transition-all duration-500 ${colorClass}`}
                                          style={{ width: `${pct}%` }}
                                        />
                                      </div>
                                      {showBarReset && bar.reset && (
                                        <div className="flex flex-wrap items-baseline gap-x-1 text-[11px] leading-4 text-slate-500">
                                          <span>Reset:</span><span className="tabular-nums">{bar.reset}</span>
                                        </div>
                                      )}
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

                            <div className="flex flex-wrap justify-between gap-x-4 gap-y-1 text-[10px] text-slate-500 pt-2 border-t border-[var(--dashboard-border)] mt-1">
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

                            <QuotaVisualizations
                              provider={q.provider}
                              analytics={q.analytics}
                              config={
                                quotaConfig?.items?.find((item) => item.id === q.id)?.visualizations
                                ?? q.visualizations
                                ?? quotaConfig?.visualizations
                              }
                              theme={{
                                accent: "#06b6d4",
                                subText: appConfig.theme === "light" ? "#64748b" : "#94a3b8",
                                mainText: appConfig.theme === "light" ? "#0f172a" : "#ffffff",
                                scheme: appConfig.theme === "light" ? "light" : "dark",
                                emptyCell:
                                  appConfig.theme === "light"
                                    ? "rgba(15,23,42,0.08)"
                                    : "rgba(255,255,255,0.08)",
                              }}
                            />
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            )}

            {activeTab === "settings" && renderSettingsPanel(settingsSection)}
          </>
        </div>
      </main>
      {paperPreferenceUndo && <ConferenceUndoNotice key={paperPreferenceUndo.id} isLight={appConfig.theme === "light"}
        onUndo={undoConferencePreference} onDismiss={() => setPaperPreferenceUndo(null)} />}
    </div>
  );
}

export default App;
