import { useState, useEffect } from "react";
import type { ReactNode } from "react";
import { WidgetHeader } from "../components/WidgetHeader";
import { Radar, Check, ChevronDown } from "lucide-react";
import { motion, AnimatePresence, type Variants } from "framer-motion";
import type { ArxivConfig, ArxivPaper } from "../types/config";
import { useWidgetTheme } from "../hooks/useWidgetTheme";
import { widgetCardStyle } from "../utils/glassCardBackground";
import { widgetKeywordSurface } from "../utils/widgetOverlaySurface";
import { hexToRgba, isLightColor } from "../utils/color";
import { handleWidgetAppConfigUpdate } from "../utils/widgetLifecycle";
import { listenBackendServiceError } from "../utils/backendServiceError";
import { listenServiceUpdateEvents } from "../utils/serviceUpdateEvents";
import { LIVE_DATA_SECTION, refetchSectionLiveData } from "../utils/sectionLiveData";
import { CACHED_LABELS, cachedLabelWhen } from "../utils/cachedLabels";
import { ALL_ARXIV_KEYWORDS, UNCATEGORIZED_ARXIV_KEYWORD, hasArxivKeywords, filterArxivPapersByKeywords, formatArxivKeywordLabel, getArxivKeywords, getPaperArxivKeywords } from "../utils/arxivKeywords";
import { ServiceErrorBanners } from "../components/ServiceErrorBanners";
import { tauriInvoke } from "../utils/tauriInvoke";
import { tauriListen } from "../utils/tauriListen";
import { arxivPaperLinks } from "../utils/arxivPaperLinks";
import { useArxivLibrary } from "../hooks/useArxivLibrary";
import { ArxivReadingActions } from "../components/ArxivReadingActions";
import { ArxivPaperActions } from "../components/ArxivPaperActions";
import { ArxivAbstractPreview } from "../components/ArxivAbstractPreview";

type SwipeDirection = "left" | "right" | "up";

type ArxivWidgetContentProps = {
  hideHeader?: boolean;
  headerControls?: ReactNode;
  appearance?: "light" | "dark";
};

const paperCardVariants: Variants = {
  initial: { scale: 0.9, opacity: 0, y: 20 },
  animate: { scale: 1, opacity: 1, y: 0 },
  exit: (custom: SwipeDirection | undefined) => ({
    x: custom === "left" ? -500 : custom === "right" ? 500 : 0,
    y: custom === "up" ? -500 : 0,
    opacity: 0,
    rotate: custom === "left" ? -20 : custom === "right" ? 20 : 0,
    transition: { duration: 0.4 },
  }),
};

export function ArxivWidgetContent({
  hideHeader = false,
  headerControls,
  appearance,
}: ArxivWidgetContentProps) {
  const library = useArxivLibrary();
  const [papers, setPapers] = useState<ArxivPaper[]>([]);
  const [arxivConfig, setArxivConfig] = useState<ArxivConfig>({});
  const [arxivBackendError, setArxivBackendError] = useState<string | null>(null);
  const [arxivRefreshError, setArxivRefreshError] = useState<string | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedKeywords, setSelectedKeywords] = useState<string[]>([]);
  const [keywordMenuOpen, setKeywordMenuOpen] = useState(false);
  const [exitDirection, setExitDirection] = useState<SwipeDirection | undefined>(undefined);
  const [serviceEnabled, setServiceEnabled] = useState(true);
  const [dashboardTheme, setDashboardTheme] = useState<"light" | "dark">("dark");
  const currentTheme = useWidgetTheme("arxiv");
  const arxivKeywords = getArxivKeywords(arxivConfig.keywords);
  const hasOtherArxivMatches = papers.some((paper) => getPaperArxivKeywords(paper, arxivConfig.keywords).length === 0);
  const arxivKeywordOptions = arxivKeywords.length === 0
    ? [ALL_ARXIV_KEYWORDS]
    : hasOtherArxivMatches ? [...arxivKeywords, UNCATEGORIZED_ARXIV_KEYWORD] : arxivKeywords;
  const visiblePapers = !hasArxivKeywords(arxivConfig.keywords) ? [] : filterArxivPapersByKeywords(papers, selectedKeywords, arxivConfig.keywords);
  const currentPaper = visiblePapers[currentIndex];

  useEffect(() => {
    setSelectedKeywords((prev) => prev.filter((keyword) => arxivKeywordOptions.includes(keyword)));
    setCurrentIndex(0);
  }, [arxivConfig.keywords, hasOtherArxivMatches]);

  useEffect(() => {
    if (visiblePapers.length > 0 && currentIndex >= visiblePapers.length) {
      setCurrentIndex(0);
    }
  }, [currentIndex, visiblePapers.length]);
  useEffect(() => {
    let active = true;
    const unlisteners: (() => void)[] = [];

    const load = async () => {
      try {
        const arxivPapers = await refetchSectionLiveData(LIVE_DATA_SECTION.ARXIV);
        if (!active) return;
        setPapers(arxivPapers);

        const configArxiv = await tauriInvoke("get_arxiv_config");
        if (!active) return;
        setArxivConfig(configArxiv);
      } catch (e) {
        console.error("Arxiv widget load failed", e);
      }
    };

    load();

    const setup = async () => {
      try {
        const u1 = await listenServiceUpdateEvents(
          () => active,
          {
            arxiv: {
              clearRefresh: () => setArxivRefreshError(null),
              clearBackend: () => setArxivBackendError(null),
            },
          },
          {
            onArxivUpdate: (payload) => {
              setPapers(payload);
              setCurrentIndex(0);
            },
          }
        );
        if (!active) {
          u1();
        } else {
          unlisteners.push(u1);
        }

        const u3 = await tauriListen("arxiv_config_update", (event) => {
          if (!active) return;
          setArxivConfig(event.payload);
          setArxivRefreshError(null);
          setCurrentIndex(0);
          // Saving filters already refreshes centrally and publishes arxiv_update.
        });
        if (!active) {
          u3();
        } else {
          unlisteners.push(u3);
        }

        const u4 = await listenBackendServiceError(
          "arxiv_error",
          setArxivBackendError,
          () => active
        );
        if (!active) {
          u4();
        } else {
          unlisteners.push(u4);
        }

        const appConfig = await tauriInvoke("get_app_config");
        let arxivEnabled = appConfig?.arxiv_enabled !== false;
        if (active) {
          setServiceEnabled(arxivEnabled);
          setDashboardTheme(appConfig?.theme === "light" ? "light" : "dark");
        }

        const u5 = await tauriListen("app_config_update", async (event) => {
          if (!active) return;
          arxivEnabled = await handleWidgetAppConfigUpdate(event.payload, arxivEnabled, {
            serviceField: "arxiv_enabled",
            setServiceEnabled: setServiceEnabled,
            setDashboardTheme: setDashboardTheme,
            disableClears: {
              clearData: () => setPapers([]),
              clearRefreshError: () => setArxivRefreshError(null),
              clearBackendError: () => setArxivBackendError(null),
              onExtra: () => {
                setCurrentIndex(0);
                setKeywordMenuOpen(false);
              },
            },
          });
        });
        if (!active) {
          u5();
        } else {
          unlisteners.push(u5);
        }
      } catch (e) {
        console.error("Failed to setup arxiv listeners", e);
      }
    };

    setup();

    return () => {
      active = false;
      unlisteners.forEach((f) => f());
    };
  }, []);

  if (!currentTheme) return null;

  const handleAction = async (direction: SwipeDirection) => {
    const paper = currentPaper;
    if (!paper) return;

    setExitDirection(direction);

    if (direction === "left") {
      if (!(await library.act(paper, "skip"))) setExitDirection(undefined);
    } else if (direction === "right") {
      if (!(await library.act(paper, "save"))) setExitDirection(undefined);
    } else if (direction === "up") {
      const links = arxivPaperLinks(paper);
      if (links) await tauriInvoke("open_link", { url: links.pageUrl });
    }
  };

  const getC = (name: string, fallback: string) => {
    const c = currentTheme.primary_colors.find((p) => p.name === name);
    return c ? hexToRgba(c.value, c.opacity ?? 1.0) : fallback;
  };
  const getT = (name: string, fallback: string) => {
    const c = currentTheme.text_colors?.find((p) => p.name === name);
    return c ? hexToRgba(c.value, c.opacity ?? 1.0) : fallback;
  };

  const accent = getC("Accent", "#ec4899");
  const mainText = getT("Main Text", "#ffffff");
  const subText = getT("Sub Text", "#94a3b8");
  const isLightAppearance = appearance
    ? appearance === "light"
    : isLightColor(currentTheme.bg_color);
  const { glass: keywordMenuGlass, translucent: keywordMenuTranslucent,
    backgroundColor: keywordMenuBackground, backdropFilter: keywordMenuBlur,
    color: keywordMenuText, borderColor: keywordMenuBorder } = widgetKeywordSurface(currentTheme, isLightAppearance);
  const keywordMenuActiveText = keywordMenuTranslucent ? keywordMenuText : accent;
  const keywordMenuCheckboxBorder = isLightAppearance
    ? "rgba(71, 85, 105, 0.42)"
    : "rgba(148, 163, 184, 0.38)";


  return (
    <div className="arxiv-widget h-full min-h-0 flex flex-col select-none" style={{ color: mainText }}>
      {!hideHeader && <WidgetHeader icon={<Radar size={16} style={{ color: accent }} />} title="Arxiv Radar" color={subText} controls={headerControls} />}

      <ServiceErrorBanners
        backendError={arxivBackendError}
        refreshError={arxivRefreshError}
        onDismissBackend={() => setArxivBackendError(null)}
        onDismissRefresh={() => setArxivRefreshError(null)}
        theme={dashboardTheme}
        showBackend={serviceEnabled}
        className="mb-2 space-y-2"
        backendCachedLabel={cachedLabelWhen(
          papers.length > 0,
          CACHED_LABELS.arxiv.backend
        )}
        refreshCachedLabel={cachedLabelWhen(
          papers.length > 0,
          CACHED_LABELS.arxiv.refresh
        )}
      />
      {serviceEnabled && arxivKeywordOptions.length > 0 && (
        <div className="relative z-[60] mb-3 shrink-0" data-no-drag="true">
          <button
            type="button"
            aria-expanded={keywordMenuOpen}
            onClick={() => setKeywordMenuOpen((open) => !open)}
            className="arxiv-keyword-control w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg text-[8px] font-black uppercase tracking-widest border transition-colors"
            style={{
              borderColor: keywordMenuOpen ? accent : keywordMenuBorder,
              backgroundColor: keywordMenuBackground,
              color: selectedKeywords.length > 0 ? accent : keywordMenuText,
            }}
            title={selectedKeywords.length === 0 ? "All keywords" : selectedKeywords.map(formatArxivKeywordLabel).join(", ")}
          >
            <span className="truncate">
              {selectedKeywords.length === 0
                ? "All keywords"
                : selectedKeywords.length === 1
                ? formatArxivKeywordLabel(selectedKeywords[0])
                : `${selectedKeywords.length} keywords selected`}
            </span>
            <ChevronDown
              size={12}
              className={`shrink-0 transition-transform ${keywordMenuOpen ? "rotate-180" : ""}`}
            />
          </button>
          {keywordMenuOpen && (
            <div
              data-glass-tone={keywordMenuGlass ? (isLightAppearance ? "light" : "dark") : undefined}
              className={`absolute left-0 right-0 top-full z-50 isolate mt-1 max-h-40 overflow-y-auto rounded-lg border ${keywordMenuGlass ? "glass-surface glass-menu" : ""}`}
              style={{
                borderColor: keywordMenuGlass ? "transparent" : keywordMenuBorder,
                backgroundColor: keywordMenuBackground,
                backdropFilter: keywordMenuBlur,
                WebkitBackdropFilter: keywordMenuBlur,
                textShadow: keywordMenuGlass ? undefined : "none",
                boxShadow: isLightAppearance
                  ? "0 8px 24px rgba(15, 23, 42, 0.12)"
                  : "0 8px 24px rgba(0, 0, 0, 0.24)",
              }}
            >
              <button
                type="button"
                onClick={() => {
                  setSelectedKeywords([]);
                  setCurrentIndex(0);
                  setKeywordMenuOpen(false);
                }}
                className={`arxiv-keyword-control w-full flex items-center gap-2 px-2.5 py-2 text-left text-[8px] font-black uppercase tracking-widest transition-colors ${
                  isLightAppearance ? "hover:bg-slate-900/5" : "hover:bg-white/10"
                }`}
                style={{ color: selectedKeywords.length === 0 ? keywordMenuActiveText : keywordMenuText }}
              >
                <span
                  className="w-3 h-3 rounded border flex items-center justify-center shrink-0"
                  style={{
                    borderColor:
                      selectedKeywords.length === 0 ? accent : keywordMenuCheckboxBorder,
                  }}
                >
                  {selectedKeywords.length === 0 && <Check size={9} />}
                </span>
                All keywords
              </button>
              {arxivKeywordOptions.map((keyword) => {
                const active = selectedKeywords.includes(keyword);
                return (
                  <button
                    key={keyword}
                    type="button"
                    onClick={() => {
                      setSelectedKeywords((prev) =>
                        prev.includes(keyword)
                          ? prev.filter((selected) => selected !== keyword)
                          : [...prev, keyword]
                      );
                      setCurrentIndex(0);
                    }}
                    className={`arxiv-keyword-control w-full flex items-center gap-2 px-2.5 py-2 text-left text-[8px] font-black uppercase tracking-widest transition-colors ${
                      isLightAppearance ? "hover:bg-slate-900/5" : "hover:bg-white/10"
                    }`}
                    style={{ color: active ? keywordMenuActiveText : keywordMenuText }}
                    title={keyword}
                  >
                    <span
                      className="w-3 h-3 rounded border flex items-center justify-center shrink-0"
                      style={{ borderColor: active ? accent : keywordMenuCheckboxBorder }}
                    >
                      {active && <Check size={9} />}
                    </span>
                    <span className="truncate">{formatArxivKeywordLabel(keyword)}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
      {library.error && <p role="alert" className="mb-2 text-[10px] text-red-500" title={library.error}>Could not update paper. Please try again.</p>}
      <div className="flex-1 min-h-0 relative z-0 perspective-1000" data-no-drag="true"
        style={keywordMenuOpen && keywordMenuTranslucent ? { filter: "blur(6px)", opacity: 0.55 } : undefined}>
        {!serviceEnabled ? (
          <div
            data-widget-surface="empty"
            className="absolute inset-0 flex flex-col items-center justify-center text-center px-4 rounded-xl border border-dashed"
            style={{ ...widgetCardStyle(currentTheme), borderColor: `${subText}33`, color: subText }}
          >
            <span className="text-[10px] font-black uppercase tracking-widest">Service Disabled</span>
            <span className="text-[9px] opacity-70 mt-1">Enable monitoring on the module page.</span>
          </div>
        ) : (
        <AnimatePresence>
          {currentPaper ? (
            <motion.div
              key={currentPaper.id}
              drag
              dragConstraints={{ left: 0, right: 0, top: 0, bottom: 0 }}
              onDragEnd={(_, info) => {
                if (info.offset.x < -100) handleAction("left");
                else if (info.offset.x > 100) handleAction("right");
                else if (info.offset.y < -100) handleAction("up");
              }}
              custom={exitDirection}
              variants={paperCardVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              onAnimationComplete={(definition) => {
                if (definition === "exit") setExitDirection(undefined);
              }}
              data-no-drag="true"
              className="widget-paper-card absolute inset-0 bg-white/5 rounded-2xl border border-white/10 p-3 flex flex-col shadow-[0_2px_8px_rgba(15,23,42,0.10)] backdrop-blur-md cursor-grab active:cursor-grabbing overflow-hidden"
              style={widgetCardStyle(currentTheme)}
            >
              <div className="flex flex-col flex-1 min-h-0 overflow-y-auto pr-1">
                <h3 className="arxiv-paper-title shrink-0 text-[10px] font-bold mb-2 leading-snug break-words">{currentPaper.title}</h3>
                <ArxivAbstractPreview paper={currentPaper} compact isLight={isLightAppearance} textColor={subText} theme={currentTheme} />
              </div>
              <div className="shrink-0 pt-2 border-t border-white/5 space-y-1.5">
                <div className="flex flex-wrap gap-1">
                  <span
                    className="arxiv-paper-meta text-[8px] bg-white/5 px-2 py-0.5 rounded-full font-medium"
                    style={{ color: subText }}
                  >
                    {currentPaper.authors.length > 0 ? (
                      <>
                        {currentPaper.authors[0]}
                        {currentPaper.authors.length > 1 ? " et al." : ""}
                      </>
                    ) : (
                      "Unknown Author"
                    )}
                  </span>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-1">
                  <ArxivReadingActions paper={currentPaper} library={library} allowSkip compact />
                  <ArxivPaperActions key={currentPaper.id} paper={currentPaper} compact />
                </div>
                {arxivConfig.show_card_hints !== false && (
                  <div className="arxiv-paper-hints flex items-center justify-between mt-2 text-[8px] font-black uppercase tracking-widest">
                    <span className="text-red-400">← Ignore</span>
                    <span className="text-blue-400">Open arXiv ↑</span>
                    <span className="text-emerald-400">Save →</span>
                  </div>
                )}
              </div>
              <div
                className="absolute top-0 right-0 w-24 h-24 rounded-full blur-3xl -mr-12 -mt-12 pointer-events-none opacity-20"
                style={{ backgroundColor: accent }}
              />
            </motion.div>
          ) : (
            <div data-widget-surface="empty" style={widgetCardStyle(currentTheme)} className="h-full min-h-0 flex flex-col items-center justify-center text-center p-4 space-y-2">
              <div className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center">
                <Check size={22} className="text-emerald-500" />
              </div>
              <div className="space-y-1">
                <div className="text-[10px] font-bold">{arxivKeywords.length === 0 ? "No keywords configured" : "All caught up!"}</div>
                <p className="text-[9px] text-slate-500">{arxivKeywords.length === 0 ? "Add keywords in Paper filters to fill To read." : "Check back later for matching papers."}</p>
              </div>
            </div>
          )}
        </AnimatePresence>
        )}
      </div>
    </div>
  );
}
