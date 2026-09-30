import { useState, useEffect } from "react";
import { Trophy, RefreshCw } from "lucide-react";
import { useWidgetTheme } from "../hooks/useWidgetTheme";
import { hexToRgba } from "../utils/color";
import { DeadlineCountdown } from "../components/DeadlineCountdown";
import { handleWidgetAppConfigUpdate } from "../utils/widgetLifecycle";
import { listenBackendServiceError } from "../utils/backendServiceError";
import { listenServiceUpdateEvents } from "../utils/serviceUpdateEvents";
import { LIVE_DATA_SECTION, refetchSectionLiveData } from "../utils/sectionLiveData";
import { CACHED_LABELS, cachedLabelWhen } from "../utils/cachedLabels";
import { ServiceErrorBanners } from "../components/ServiceErrorBanners";
import type { PaperConfig, PaperDeadlineInfo } from "../types/config";
import { deadlineInstanceKey, selectWidgetDeadlines } from "../utils/deadlineKeys";
import { tauriInvoke } from "../utils/tauriInvoke";
import { tauriListen } from "../utils/tauriListen";

export function DeadlineWidgetContent({ hideHeader = false }: { hideHeader?: boolean }) {
  const [deadlines, setDeadlines] = useState<PaperDeadlineInfo[]>([]);
  const [paperConfig, setPaperConfig] = useState<PaperConfig>({});
  const [paperBackendError, setPaperBackendError] = useState<string | null>(null);
  const [paperRefreshError, setPaperRefreshError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [serviceEnabled, setServiceEnabled] = useState(true);
  const [dashboardTheme, setDashboardTheme] = useState<"light" | "dark">("dark");
  const currentTheme = useWidgetTheme("deadline");

  useEffect(() => {
    let active = true;
    const unlisteners: (() => void)[] = [];

    const fetchConfig = async () => {
      try {
        const pc = await tauriInvoke("get_paper_config");
        if (!active) return;
        setPaperConfig(pc);

        const dl = await refetchSectionLiveData(LIVE_DATA_SECTION.DEADLINES);
        if (!active) return;
        setDeadlines(dl);
      } catch (e) {
        console.error("Deadline widget load failed", e);
      }
    };

    fetchConfig();

    const setup = async () => {
      try {
        const u1 = await listenServiceUpdateEvents(
          () => active,
          {
            paper: {
              clearRefresh: () => setPaperRefreshError(null),
              clearBackend: () => setPaperBackendError(null),
            },
          },
          { paperSetter: setDeadlines }
        );
        if (!active) {
          u1();
        } else {
          unlisteners.push(u1);
        }

        const u2 = await tauriListen("paper_config_update", (event) => {
          if (!active) return;
          setPaperConfig(event.payload);
        });
        if (!active) {
          u2();
        } else {
          unlisteners.push(u2);
        }

        const u3 = await listenBackendServiceError(
          "paper_error",
          setPaperBackendError,
          () => active
        );
        if (!active) {
          u3();
        } else {
          unlisteners.push(u3);
        }

        const appConfig = await tauriInvoke("get_app_config");
        let deadlineEnabled = appConfig?.deadline_enabled !== false;
        if (active) {
          setServiceEnabled(deadlineEnabled);
          setDashboardTheme(appConfig?.theme === "light" ? "light" : "dark");
        }

        const u5 = await tauriListen("app_config_update", async (event) => {
          if (!active) return;
          deadlineEnabled = await handleWidgetAppConfigUpdate(event.payload, deadlineEnabled, {
            serviceField: "deadline_enabled",
            setServiceEnabled: setServiceEnabled,
            setDashboardTheme: setDashboardTheme,
            disableClears: {
              clearData: () => setDeadlines([]),
              clearRefreshError: () => setPaperRefreshError(null),
              clearBackendError: () => setPaperBackendError(null),
            },
          });
        });
        if (!active) {
          u5();
        } else {
          unlisteners.push(u5);
        }
      } catch (e) {
        console.error("Failed to setup deadline listeners", e);
      }
    };

    setup();

    return () => {
      active = false;
      unlisteners.forEach((f) => f());
    };
  }, []);

  if (!currentTheme) return null;

  const getC = (name: string, fallback: string) => {
    const c = currentTheme.primary_colors.find((p) => p.name === name);
    return c ? hexToRgba(c.value, c.opacity ?? 1.0) : fallback;
  };
  const getT = (name: string, fallback: string) => {
    const c = currentTheme.text_colors?.find((p) => p.name === name);
    return c ? hexToRgba(c.value, c.opacity ?? 1.0) : fallback;
  };

  const accent = getC("Accent", "#8b5cf6");
  const highlight = getC("Highlight", "#f59e0b");
  const mainText = getT("Main Text", "#ffffff");
  const subText = getT("Sub Text", "#64748b");

  const displayList = selectWidgetDeadlines(deadlines, paperConfig);
  const hasSelections = Boolean(
    paperConfig.pinned_deadline_ids?.length || paperConfig.subscribed_titles?.length
  );

  const handleRefresh = async () => {
    if (isRefreshing || !serviceEnabled) return;
    setIsRefreshing(true);
    setPaperRefreshError(null);
    try {
      const items = await tauriInvoke("refresh_paper_deadlines");
      setDeadlines(items);
    } catch (e) {
      console.error("Deadline widget refresh failed", e);
      setPaperRefreshError(String(e));
    } finally {
      setIsRefreshing(false);
    }
  };

  return (
    <div className="h-full flex flex-col" style={{ color: mainText }}>
      {!hideHeader && (
        <div className="flex items-center justify-between gap-2 mb-4">
          <div className="flex items-center gap-2">
            <Trophy size={16} style={{ color: highlight }} />
            <span className="text-xs font-black uppercase tracking-widest" style={{ color: subText }}>
              Deadlines
            </span>
          </div>
          <button
            onClick={handleRefresh}
            disabled={isRefreshing || !serviceEnabled}
            className="p-1 hover:bg-white/10 rounded-md transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ color: subText }}
            title="Refresh Deadlines"
          >
            <RefreshCw size={12} className={isRefreshing ? "animate-spin" : "hover:rotate-45 transition-transform"} />
          </button>
        </div>
      )}

      <ServiceErrorBanners
        backendError={paperBackendError}
        refreshError={paperRefreshError}
        onDismissBackend={() => setPaperBackendError(null)}
        onDismissRefresh={() => setPaperRefreshError(null)}
        theme={dashboardTheme}
        showBackend={serviceEnabled}
        className="mb-2 space-y-2"
        backendCachedLabel={cachedLabelWhen(
          deadlines.length > 0,
          CACHED_LABELS.deadlines.backend
        )}
        refreshCachedLabel={cachedLabelWhen(
          deadlines.length > 0,
          CACHED_LABELS.deadlines.refresh
        )}
      />

      <div className="flex-1 overflow-y-auto custom-scrollbar pr-1 w-full space-y-2">
        {!serviceEnabled ? (
          <div
            className="flex flex-col items-center justify-center text-center py-10 px-4 rounded-xl border border-dashed"
            style={{ borderColor: `${subText}33`, color: subText }}
          >
            <span className="text-[10px] font-black uppercase tracking-widest">Service Disabled</span>
            <span className="text-[9px] opacity-70 mt-1">Enable monitoring on the module page.</span>
          </div>
        ) : displayList.length > 0 ? (
          displayList.map((dl) => (
            <div
              key={deadlineInstanceKey(dl)}
              className="bg-white/5 rounded-xl p-3 border border-white/5 relative overflow-hidden group transition-all hover:bg-white/10"
            >
              <div className="flex items-center justify-between relative z-10">
                <div className="flex flex-col min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-black truncate">
                      {dl.title} {dl.year}
                    </span>
                    <span
                      className="text-[8px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded-md bg-white/5"
                      style={{ color: subText }}
                    >
                      {dl.sub}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 mt-1">
                    <span className="text-[8px] font-bold truncate" style={{ color: subText }}>
                      📍 {dl.place || "Online"}
                    </span>
                  </div>
                </div>
                <div className="text-right flex-shrink-0 pl-2">
                  <div
                    className="text-[10px] font-black tabular-nums bg-white/5 px-2 py-1 rounded-lg border border-white/5"
                    style={{ color: highlight }}
                  >
                    <DeadlineCountdown date={dl.deadline_utc} />
                  </div>
                </div>
              </div>
              <div
                className="absolute top-0 right-0 w-16 h-16 rounded-full blur-xl -mr-8 -mt-8 pointer-events-none"
                style={{ backgroundColor: `${accent}22` }}
              />
            </div>
          ))
        ) : (
          <div
            className="flex flex-col items-center justify-center text-center mt-8 px-4 py-6 rounded-xl border border-dashed"
            style={{ borderColor: `${subText}33`, color: subText }}
          >
            <Trophy size={18} style={{ color: highlight, opacity: 0.5 }} className="mb-2" />
            <span className="text-[10px] font-black uppercase tracking-widest mb-1">
              {hasSelections ? "No Upcoming Deadlines" : "No Conferences Tracked"}
            </span>
            <span className="text-[9px] opacity-70 leading-relaxed">
              {hasSelections
                ? "No upcoming deadlines for the selected conferences."
                : "Select Remind me or pin a deadline on the main page."}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
