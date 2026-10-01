import { useState, useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { AppConfig } from "../types/config";
import type { WidgetTheme, WidgetThemeConfig } from "../types/theme";
import { resolveWidgetTheme, type WidgetThemeKind } from "../utils/widgetTheme";
import { isLightColor } from "../utils/color";
import { resolveSidebarTheme } from "../utils/sidebarTheme";
import { tauriInvoke } from "../utils/tauriInvoke";
import { tauriListen } from "../utils/tauriListen";

export function useWidgetTheme(kind: WidgetThemeKind): WidgetTheme | null {
  const win = getCurrentWindow();
  const [currentTheme, setCurrentTheme] = useState<WidgetTheme | null>(null);

  useEffect(() => {
    let active = true;
    const unlisteners: (() => void)[] = [];
    let latestThemeConfig: WidgetThemeConfig | null = null;
    let latestAppConfig: AppConfig | null = null;
    let appConfigEventRevision = 0;

    const updateTheme = () => {
      if (!active || !latestThemeConfig) return;
      const sidebarLight =
        win.label === "sidebar" &&
        isLightColor(resolveSidebarTheme(latestAppConfig?.sidebar_theme).background);
      setCurrentTheme(resolveWidgetTheme(latestThemeConfig, win.label, kind, { sidebarLight }));
    };

    const load = async () => {
      try {
        const [themeConfig, appConfig] = await Promise.all([
          tauriInvoke("get_theme_config"),
          tauriInvoke("get_app_config"),
        ]);
        if (!active) return;
        latestThemeConfig = themeConfig;
        latestAppConfig = appConfig;
        updateTheme();

        const unlistenTheme = await tauriListen("theme_update", (event) => {
          if (!active) return;
          latestThemeConfig = event.payload;
          updateTheme();
        });
        unlisteners.push(() => unlistenTheme());

        const unlistenApp = await tauriListen("app_config_update", (event) => {
          if (!active) return;
          appConfigEventRevision += 1;
          latestAppConfig = event.payload;
          updateTheme();
        });
        unlisteners.push(() => unlistenApp());

        if (win.label === "sidebar") {
          const unlistenSidebar = await tauriListen("sidebar_state_update", (event) => {
            if (!event.payload.expanded) return;
            const revision = appConfigEventRevision;
            tauriInvoke("get_app_config")
              .then((config) => {
                if (!active || revision !== appConfigEventRevision) return;
                latestAppConfig = config;
                updateTheme();
              })
              .catch((error) => console.error("Sidebar theme refresh failed", error));
          });
          unlisteners.push(() => unlistenSidebar());
        }
      } catch (e) {
        console.error("Widget theme load failed", e);
      }
    };

    load();

    return () => {
      active = false;
      unlisteners.forEach((unlisten) => unlisten());
    };
  }, [win.label, kind]);

  return currentTheme;
}
