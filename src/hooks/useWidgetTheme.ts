import { isGlassMaterial } from "../utils/glassMaterial";
import { useState, useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { AppConfig } from "../types/config";
import type { WidgetTheme, WidgetThemeConfig } from "../types/theme";
import { resolveWidgetTheme, type WidgetThemeKind } from "../utils/widgetTheme";
import { isLightColor } from "../utils/color";
import { resolveSidebarTheme } from "../utils/sidebarTheme";
import { tauriInvoke } from "../utils/tauriInvoke";
import { tauriListen } from "../utils/tauriListen";
import { startWindowSnapshotSync } from "../utils/windowSnapshotSync";

export function useWidgetTheme(kind: WidgetThemeKind): WidgetTheme | null {
  const win = getCurrentWindow();
  const [currentTheme, setCurrentTheme] = useState<WidgetTheme | null>(null);

  useEffect(() => {
    let active = true;
    let unlistenSidebar: (() => void) | undefined;
    let latestThemeConfig: WidgetThemeConfig | null = null;
    let latestAppConfig: AppConfig | null = null;

    const updateTheme = () => {
      if (!active || !latestThemeConfig || !latestAppConfig) return;
      const sidebarTheme = resolveSidebarTheme(latestAppConfig?.sidebar_theme, latestAppConfig?.theme);
      const sidebarLight =
        win.label === "sidebar" &&
        isLightColor(sidebarTheme.background);
      const resolved = resolveWidgetTheme(latestThemeConfig, win.label, kind, {
        sidebarLight, sidebarGlass: isGlassMaterial(sidebarTheme.material), dashboardTheme: latestAppConfig?.theme,
      });
      setCurrentTheme(win.label === "sidebar" && isGlassMaterial(sidebarTheme.material) && resolved
        ? { ...resolved, material: sidebarTheme.material, bg_color: sidebarTheme.background, bg_opacity: sidebarTheme.background_opacity,
          card_background: sidebarTheme.card_background }
        : resolved);
    };

    const themeSync = startWindowSnapshotSync<WidgetThemeConfig>({
      listen: (onSnapshot) => tauriListen("theme_update", (event) => onSnapshot(event.payload)),
      read: () => tauriInvoke("get_theme_config"),
      apply: (config) => {
        latestThemeConfig = config;
        updateTheme();
      },
      onError: (error) => console.error("Widget theme sync failed", error),
    });
    const appSync = startWindowSnapshotSync<AppConfig>({
      listen: (onSnapshot) => tauriListen("app_config_update", (event) => onSnapshot(event.payload)),
      read: () => tauriInvoke("get_app_config"),
      apply: (config) => {
        latestAppConfig = config;
        updateTheme();
      },
      onError: (error) => console.error("Widget appearance sync failed", error),
    });

    if (win.label === "sidebar") {
      tauriListen("sidebar_state_update", (event) => {
        if (active && event.payload.expanded) void appSync.refresh();
      })
        .then((stop) => {
          if (!active) stop();
          else unlistenSidebar = stop;
        })
        .catch((error) => { if (active) console.error("Sidebar theme refresh failed", error); });
    }

    return () => {
      active = false;
      themeSync.stop();
      appSync.stop();
      unlistenSidebar?.();
    };
  }, [win.label, kind]);

  return currentTheme;
}
