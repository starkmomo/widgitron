import { useState, useEffect } from "react";
import { Activity, Check, ChevronDown } from "lucide-react";
import { motion, AnimatePresence, type Variants } from "framer-motion";
import type { ArxivConfig, ArxivPaper } from "../types/config";
import { useWidgetTheme } from "../hooks/useWidgetTheme";
import { hexToRgba } from "../utils/color";
import { handleWidgetAppConfigUpdate } from "../utils/widgetLifecycle";
import { listenBackendServiceError } from "../utils/backendServiceError";
import { listenServiceUpdateEvents } from "../utils/serviceUpdateEvents";
import { LIVE_DATA_SECTION, refetchSectionLiveData } from "../utils/sectionLiveData";
import { CACHED_LABELS, cachedLabelWhen } from "../utils/cachedLabels";
import { UNCATEGORIZED_ARXIV_KEYWORD, filterArxivPapersByKeywords, formatArxivKeywordLabel, getArxivKeywords, getPaperArxivKeywords } from "../utils/arxivKeywords";
import { ServiceErrorBanners } from "../components/ServiceErrorBanners";
import { tauriInvoke } from "../utils/tauriInvoke";
import { tauriListen } from "../utils/tauriListen";

type SwipeDirection = "left" | "right" | "up";

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

export function ArxivWidgetContent() {
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
  const arxivKeywordOptions = hasOtherArxivMatches ? [...arxivKeywords, UNCATEGORIZED_ARXIV_KEYWORD] : arxivKeywords;
  const visiblePapers = filterArxivPapersByKeywords(papers, selectedKeywords, arxivConfig.keywords);
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

        const u3 = await tauriListen("arxiv_config_update", async (event) => {
          if (!active) return;
          setArxivConfig(event.payload);
          setArxivRefreshError(null);
          setCurrentIndex(0);
          try {
            const papers = await tauriInvoke("refresh_arxiv");
            if (active) {
              setPapers(papers);
            }
          } catch (e) {
            console.error("Arxiv widget refresh after config change failed", e);
            if (active) setArxivRefreshError(String(e));
          }
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
      await tauriInvoke("mark_arxiv_seen", { id: paper.id, saved: false });
      setCurrentIndex((prev) => prev + 1);
    } else if (direction === "right") {
      await tauriInvoke("mark_arxiv_seen", { id: paper.id, saved: true });
      setCurrentIndex((prev) => prev + 1);
    } else if (direction === "up") {
      await tauriInvoke("open_link", { url: paper.link });
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


  return (
    <div className={`h-full flex flex-col p-2 select-none`} style={{ color: mainText }}>
      <div className="flex items-center gap-2 mb-4">
        <Activity size={16} style={{ color: accent }} className="pointer-events-none" />
        <span
          className="text-xs font-black uppercase tracking-widest pointer-events-none"
          style={{ color: subText }}
        >
          Arxiv Radar
        </span>
      </div>

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
        <div className="relative mb-3" data-no-drag="true">
          <button
            type="button"
            onClick={() => setKeywordMenuOpen((open) => !open)}
            className="w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg text-[8px] font-black uppercase tracking-widest border transition-colors"
            style={{
              borderColor: keywordMenuOpen ? accent : `${subText}33`,
              backgroundColor: keywordMenuOpen ? `${accent}18` : "rgba(255,255,255,0.04)",
              color: selectedKeywords.length > 0 ? accent : subText,
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
              className="absolute left-0 right-0 top-full z-50 mt-1 max-h-40 overflow-y-auto rounded-lg border shadow-2xl backdrop-blur-md"
              style={{
                borderColor: `${subText}33`,
                backgroundColor: "rgba(15, 23, 42, 0.94)",
              }}
            >
              <button
                type="button"
                onClick={() => {
                  setSelectedKeywords([]);
                  setCurrentIndex(0);
                  setKeywordMenuOpen(false);
                }}
                className="w-full flex items-center gap-2 px-2.5 py-2 text-left text-[8px] font-black uppercase tracking-widest hover:bg-white/10 transition-colors"
                style={{ color: selectedKeywords.length === 0 ? accent : subText }}
              >
                <span
                  className="w-3 h-3 rounded border flex items-center justify-center shrink-0"
                  style={{ borderColor: selectedKeywords.length === 0 ? accent : `${subText}55` }}
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
                    className="w-full flex items-center gap-2 px-2.5 py-2 text-left text-[8px] font-black uppercase tracking-widest hover:bg-white/10 transition-colors"
                    style={{ color: active ? accent : subText }}
                    title={keyword}
                  >
                    <span
                      className="w-3 h-3 rounded border flex items-center justify-center shrink-0"
                      style={{ borderColor: active ? accent : `${subText}55` }}
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
      <div className="flex-1 relative perspective-1000" data-no-drag="true">
        {!serviceEnabled ? (
          <div
            className="absolute inset-0 flex flex-col items-center justify-center text-center px-4 rounded-xl border border-dashed"
            style={{ borderColor: `${subText}33`, color: subText }}
          >
            <span className="text-[10px] font-black uppercase tracking-widest">Service Disabled</span>
            <span className="text-[9px] opacity-70 mt-1">Enable Arxiv Radar in the dashboard.</span>
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
              className="absolute inset-0 bg-white/5 rounded-2xl border border-white/10 p-5 flex flex-col shadow-2xl backdrop-blur-md cursor-grab active:cursor-grabbing overflow-hidden"
            >
              <h3 className="text-sm font-bold mb-3 leading-relaxed">{currentPaper.title}</h3>
              <p
                className="text-[10px] opacity-60 mb-4 line-clamp-10 leading-relaxed"
                style={{ color: subText }}
              >
                {currentPaper.summary}
              </p>
              <div className="mt-auto pt-4 border-t border-white/5">
                <div className="flex flex-wrap gap-1">
                  <span
                    className="text-[8px] bg-white/5 px-2 py-0.5 rounded-full font-medium"
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
                {arxivConfig.show_card_hints !== false && (
                  <div className="flex items-center justify-between mt-3 text-[8px] font-black uppercase tracking-widest">
                    <span className="text-red-400">← Discard</span>
                    <span className="text-blue-400">Open PDF ↑</span>
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
            <div className="h-full flex flex-col items-center justify-center text-center p-8 space-y-4">
              <div className="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center">
                <Check size={32} className="text-emerald-500" />
              </div>
              <div className="space-y-1">
                <div className="text-sm font-bold">All caught up!</div>
                <p className="text-[10px] text-slate-500">Check back later for new papers in CS.</p>
              </div>
            </div>
          )}
        </AnimatePresence>
        )}
      </div>
    </div>
  );
}
