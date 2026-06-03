import { useState, useEffect } from "react";
import { Trophy } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { WidgetTheme, WidgetThemeConfig } from "../types/theme";
import { hexToRgba } from "../utils/color";
import { DeadlineCountdown } from "../components/DeadlineCountdown";

export function DeadlineWidgetContent() {
  const [deadlines, setDeadlines] = useState<any[]>([]);
  const [paperConfig, setPaperConfig] = useState<any>({});
  const [currentTheme, setCurrentTheme] = useState<WidgetTheme | null>(null);
  const win = getCurrentWindow();

  useEffect(() => {
    let active = true;
    const unlisteners: (() => void)[] = [];

    const fetchConfig = async () => {
      try {
        const pc = await invoke("get_paper_config");
        if (!active) return;
        setPaperConfig(pc);

        const dl = await invoke("get_deadlines");
        if (!active) return;
        setDeadlines(dl as any[]);

        const config = (await invoke("get_theme_config")) as WidgetThemeConfig;
        if (!active) return;
        const themeId = config.assignments?.[win.label];
        const theme =
          config.themes.find((t) => t.id === themeId) || config.themes.find((t) => t.id === "theme-deadline-default");
        setCurrentTheme(theme || null);
      } catch (e) {
        console.error("Deadline widget load failed", e);
      }
    };

    fetchConfig();

    const setup = async () => {
      try {
        const u1 = await listen<any[]>("paper_update", (event) => {
          if (!active) return;
          setDeadlines(event.payload);
        });
        if (!active) {
          u1();
        } else {
          unlisteners.push(u1);
        }

        const u2 = await listen<any>("paper_config_update", (event) => {
          if (!active) return;
          setPaperConfig(event.payload);
        });
        if (!active) {
          u2();
        } else {
          unlisteners.push(u2);
        }

        const u3 = await listen("theme_update", (event: any) => {
          if (!active) return;
          const config = event.payload as WidgetThemeConfig;
          const themeId = config.assignments?.[win.label];
          const theme =
            config.themes.find((t) => t.id === themeId) || config.themes.find((t) => t.id === "theme-deadline-default");
          setCurrentTheme(theme || null);
        });
        if (!active) {
          u3();
        } else {
          unlisteners.push(u3);
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

  const pinnedTitles = paperConfig.pinned_titles || [];
  const pinnedList = deadlines.filter((d) => pinnedTitles.includes(d.title));
  const displayList = pinnedList.length > 0 ? pinnedList : deadlines.length > 0 ? [deadlines[0]] : [];

  return (
    <div className="h-full flex flex-col" style={{ color: mainText }}>
      <div className="flex items-center gap-2 mb-4">
        <Trophy size={16} style={{ color: highlight }} />
        <span className="text-xs font-black uppercase tracking-widest" style={{ color: subText }}>
          Deadlines
        </span>
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar pr-1 w-full space-y-2">
        {displayList.length > 0 ? (
          displayList.map((dl, idx) => (
            <div
              key={idx}
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
          <div className="text-[10px] italic text-center mt-8" style={{ color: subText }}>
            No conferences tracked.
          </div>
        )}
      </div>
    </div>
  );
}
