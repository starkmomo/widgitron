import { useState, useEffect } from "react";
import type { CSSProperties, ReactNode } from "react";
import { WidgetContentList } from "../components/WidgetContentList";
import { WidgetHeader } from "../components/WidgetHeader";
import { Trophy, RefreshCw, MapPin, ChevronDown } from "lucide-react";
import { useWidgetTheme } from "../hooks/useWidgetTheme";
import { widgetCardStyle } from "../utils/glassCardBackground";
import { hexToRgba } from "../utils/color";
import { DeadlineCountdown } from "../components/DeadlineCountdown";
import { DeadlineStageDetails } from "../components/DeadlineStageDetails";
import { DeadlineTimeline } from "../components/DeadlineTimeline";
import { useDeadlineConferences } from "../hooks/useDeadlineConferences";
import { handleWidgetAppConfigUpdate } from "../utils/widgetLifecycle";
import { listenBackendServiceError } from "../utils/backendServiceError";
import { listenServiceUpdateEvents } from "../utils/serviceUpdateEvents";
import { LIVE_DATA_SECTION, refetchSectionLiveData } from "../utils/sectionLiveData";
import { CACHED_LABELS, cachedLabelWhen } from "../utils/cachedLabels";
import { ServiceErrorBanners } from "../components/ServiceErrorBanners";
import type { PaperConfig, PaperDeadlineInfo } from "../types/config";
import type { UiLanguage } from "../utils/localization";
import { deadlineConferenceKey, selectWidgetDeadlines } from "../utils/deadlineKeys";
import { tauriInvoke } from "../utils/tauriInvoke";
import { tauriListen } from "../utils/tauriListen";

export function DeadlineWidgetContent({ hideHeader = false, language, headerControls }: { hideHeader?: boolean; language: UiLanguage; headerControls?: ReactNode }) {
  const [deadlines, setDeadlines] = useState<PaperDeadlineInfo[]>([]);
  const { conferences, now } = useDeadlineConferences(deadlines);
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

  const displayList = selectWidgetDeadlines(conferences, paperConfig, now);
  const hasSelections = Boolean(
    paperConfig.followed_conference_ids?.length || paperConfig.pinned_deadline_ids?.length || paperConfig.pinned_titles?.length || paperConfig.subscribed_titles?.length
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
    <div data-widget-kind="deadline" className="h-full min-h-0 flex flex-col" style={{ color: mainText, "--widget-secondary-color": subText } as CSSProperties}>
      {!hideHeader && <WidgetHeader icon={<Trophy size={16} style={{ color: highlight }} />} title="Deadlines" color={subText} controls={headerControls}
        actions={<button
            onClick={handleRefresh}
            disabled={isRefreshing || !serviceEnabled}
            className="p-1 hover:bg-white/10 rounded-md transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ color: subText }}
            title="Refresh Deadlines"
          >
            <RefreshCw size={12} className={isRefreshing ? "animate-spin" : "hover:rotate-45 transition-transform"} />
          </button>} />}

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

      <WidgetContentList className="pr-1 w-full">
        {!serviceEnabled ? (
          <div
            data-widget-surface="empty"
            className="flex flex-col items-center justify-center text-center py-10 px-4 rounded-xl border border-dashed"
            style={{ ...widgetCardStyle(currentTheme), borderColor: `${subText}33`, color: subText }}
          >
            <span className="text-[10px] font-black uppercase tracking-widest">Service Disabled</span>
            <span className="text-[9px] opacity-70 mt-1">Enable monitoring on the module page.</span>
          </div>
        ) : displayList.length > 0 ? (
          displayList.map((dl) => (
            <div
              key={deadlineConferenceKey(dl)}
              className="widget-item-card bg-white/5 rounded-xl p-3 border border-white/5 relative overflow-hidden group transition-all hover:bg-white/10"
              style={widgetCardStyle(currentTheme)}
            >
              <div className="relative z-10 min-w-0">
                <div className="flex items-start gap-2">
                  <span className="min-w-0 flex-1 break-words text-[13px] font-bold leading-snug">
                    {dl.title} {dl.year}
                  </span>
                  <span
                    className="deadline-widget-category shrink-0 font-bold px-1.5 py-0.5 rounded-md bg-white/5"
                    style={{ color: subText }}
                  >
                    {dl.sub}
                  </span>
                </div>
                <div className="deadline-widget-location flex min-w-0 items-center gap-1 mt-1" style={{ color: subText }}>
                  <MapPin size={11} className="shrink-0" aria-hidden="true" />
                  <span className="min-w-0 truncate">
                    {dl.place || "Online"}
                  </span>
                </div>
                <div className="deadline-widget-stage">
                  <DeadlineStageDetails deadline={dl} compact color={subText} isLight={dashboardTheme === "light"} />
                </div>
              </div>
              <details className="group/timeline relative z-10 mt-2 text-[11px]" data-no-drag="true">
                <summary className="flex list-none cursor-pointer items-center justify-between gap-2 [&::-webkit-details-marker]:hidden" style={{ color: subText }}>
                  <span className="inline-flex min-w-0 items-center gap-1">
                    <ChevronDown size={11} className="shrink-0 transition-transform group-open/timeline:rotate-180" aria-hidden="true" />
                    <span>View timeline</span>
                  </span>
                  <span className="deadline-widget-countdown shrink-0 whitespace-nowrap tabular-nums" style={{ color: highlight }}>
                    {dl.deadline_utc ? <DeadlineCountdown date={dl.deadline_utc} /> : "TBD"}
                  </span>
                </summary>
                <DeadlineTimeline deadline={dl} now={now} language={language} compact />
              </details>
              <div
                className="absolute top-0 right-0 w-16 h-16 rounded-full blur-xl -mr-8 -mt-8 pointer-events-none"
                style={{ backgroundColor: `${accent}22` }}
              />
            </div>
          ))
        ) : (
          <div
            data-widget-surface="empty"
            className="flex flex-col items-center justify-center text-center mt-8 px-4 py-6 rounded-xl border border-dashed"
            style={{ ...widgetCardStyle(currentTheme), borderColor: `${subText}33`, color: subText }}
          >
            <Trophy size={18} style={{ color: highlight, opacity: 0.5 }} className="mb-2" />
            <span className="text-[10px] font-black uppercase tracking-widest mb-1">
              {hasSelections ? "No Upcoming Deadlines" : "No Conferences Tracked"}
            </span>
            <span className="text-[9px] opacity-70 leading-relaxed">
              {hasSelections
                ? "No upcoming deadlines for the selected conferences."
                : "Follow a conference on the main page to show it here."}
            </span>
          </div>
        )}
      </WidgetContentList>
    </div>
  );
}
