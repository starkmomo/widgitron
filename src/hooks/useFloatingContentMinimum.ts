import { useEffect, type RefObject } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { tauriInvoke } from "../utils/tauriInvoke";
import { observeFloatingContentMinimum } from "../utils/floatingContentMinimum";

/** Only independent widgets set native limits; sidebar tiles keep their own sizing. */
export function useFloatingContentMinimum(content: RefObject<HTMLElement | null>, ready: boolean) {
  const label = getCurrentWindow().label;
  useEffect(() => {
    if (!ready || !["widget-quota-default", "widget-gpu-default", "widget-deadlines-default"].includes(label)) return;
    const shell = content.current?.closest<HTMLElement>(".floating-window");
    if (!shell) return;
    let active = true;
    let pending: number | undefined;
    let latestHeight: number | undefined;
    let unlistenScale: (() => void) | undefined;
    let sending = false;
    const flush = async () => {
      if (sending) return;
      sending = true;
      while (active && pending !== undefined) {
        const height = pending;
        pending = undefined;
        try { await tauriInvoke("set_widget_content_minimum", { height }); }
        catch (error) { if (active) console.error("Widget content size update failed", error); }
      }
      sending = false;
    };
    const stop = observeFloatingContentMinimum(shell, (height) => { latestHeight = height; pending = height; void flush(); });
    getCurrentWindow().onScaleChanged(() => {
      if (active && latestHeight !== undefined) { pending = latestHeight; void flush(); }
    }).then((unlisten) => { if (active) unlistenScale = unlisten; else unlisten(); })
      .catch((error) => { if (active) console.error("Widget scale listener failed", error); });
    return () => { active = false; stop(); unlistenScale?.(); };
  }, [content, ready, label]);
}
