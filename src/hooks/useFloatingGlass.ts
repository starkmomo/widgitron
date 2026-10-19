import { useEffect, useRef, useState } from "react";
import { tauriInvoke } from "../utils/tauriInvoke";
import { supportsFloatingGlass } from "../utils/platform";
import { tauriListen } from "../utils/tauriListen";
import type { SidebarDockState } from "../types/tauri";

/** Serialize native material changes so a late response cannot restore an old preset. */
export function useFloatingGlass(widget: boolean, ready: boolean, enabled: boolean, dark: boolean,
  dockEdge: SidebarDockState["edge"] | null = null) {
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const [result, setResult] = useState<{ key: string; applied: boolean } | null>(null);
  const key = `${enabled}:${dark}:${dockEdge ?? ""}`;
  useEffect(() => {
    if (!supportsFloatingGlass || !widget || !ready) return;
    let active = true;
    let unlisten: (() => void) | undefined;
    let updates = 0;
    queue.current = queue.current.catch(() => undefined).then(async () => {
      if (!active) return;
      try {
        const stop = await tauriListen("widget_glass_update", ({ payload }) => {
          if (active && `${payload.enabled}:${payload.dark}:${payload.dock_edge ?? ""}` === key) {
            updates += 1;
            setResult({ key, applied: payload.applied });
          }
        });
        if (!active) { stop(); return; }
        unlisten = stop;
        const beforeInvoke = updates;
        const applied = await tauriInvoke("set_widget_glass", { enabled, dark, dockEdge });
        // A newer reparent/resize event wins over an older command response.
        if (active && updates === beforeInvoke) setResult({ key, applied });
      } catch (error) {
        console.error("Could not apply native window glass", error);
        if (active) setResult({ key, applied: false });
      }
    });
    return () => { active = false; unlisten?.(); };
  }, [widget, ready, enabled, dark, dockEdge, key]);
  return enabled && result?.key === key && result.applied;
}
