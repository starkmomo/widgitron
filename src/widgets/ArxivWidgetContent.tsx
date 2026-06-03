import { useState, useEffect } from "react";
import { Activity, Check } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { WidgetTheme, WidgetThemeConfig } from "../types/theme";
import { hexToRgba } from "../utils/color";

export function ArxivWidgetContent() {
  const [papers, setPapers] = useState<any[]>([]);
  const [arxivConfig, setArxivConfig] = useState<any>({});
  const [currentIndex, setCurrentIndex] = useState(0);
  const [currentTheme, setCurrentTheme] = useState<WidgetTheme | null>(null);
  const win = getCurrentWindow();

  useEffect(() => {
    let active = true;
    const unlisteners: (() => void)[] = [];

    const load = async () => {
      try {
        const arxivPapers = await invoke("get_arxiv_papers");
        if (!active) return;
        setPapers(arxivPapers as any[]);

        const configArxiv = await invoke("get_arxiv_config");
        if (!active) return;
        setArxivConfig(configArxiv);

        const config = (await invoke("get_theme_config")) as WidgetThemeConfig;
        if (!active) return;
        const themeId = config.assignments?.[win.label];
        const theme =
          config.themes.find((t) => t.id === themeId) || config.themes.find((t) => t.id === "theme-arxiv-default");
        setCurrentTheme(theme || null);
      } catch (e) {
        console.error("Arxiv widget load failed", e);
      }
    };

    load();

    const setup = async () => {
      try {
        const u1 = await listen<any[]>("arxiv_update", (event) => {
          if (!active) return;
          setPapers(event.payload);
        });
        if (!active) {
          u1();
        } else {
          unlisteners.push(u1);
        }

        const u2 = await listen("theme_update", (event: any) => {
          if (!active) return;
          const config = event.payload as WidgetThemeConfig;
          const themeId = config.assignments?.[win.label];
          const theme =
            config.themes.find((t) => t.id === themeId) || config.themes.find((t) => t.id === "theme-arxiv-default");
          setCurrentTheme(theme || null);
        });
        if (!active) {
          u2();
        } else {
          unlisteners.push(u2);
        }

        const u3 = await listen("arxiv_config_update", (event: any) => {
          if (!active) return;
          setArxivConfig(event.payload);
        });
        if (!active) {
          u3();
        } else {
          unlisteners.push(u3);
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

  const handleAction = async (direction: "left" | "right" | "up") => {
    const paper = papers[currentIndex];
    if (!paper) return;

    if (direction === "left") {
      await invoke("mark_arxiv_seen", { id: paper.id, saved: false });
      setCurrentIndex((prev) => prev + 1);
    } else if (direction === "right") {
      await invoke("mark_arxiv_seen", { id: paper.id, saved: true });
      setCurrentIndex((prev) => prev + 1);
    } else if (direction === "up") {
      await invoke("open_link", { url: paper.link });
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

  const currentPaper = papers[currentIndex];

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

      <div className="flex-1 relative perspective-1000" data-no-drag="true">
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
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={
                ((custom: any) => ({
                  x: custom === "left" ? -500 : custom === "right" ? 500 : 0,
                  y: custom === "up" ? -500 : 0,
                  opacity: 0,
                  rotate: custom === "left" ? -20 : custom === "right" ? 20 : 0,
                  transition: { duration: 0.4 }
                })) as any
              }
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
      </div>
    </div>
  );
}
