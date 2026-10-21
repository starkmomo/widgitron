import { useEffect, useRef, useState } from "react";
import { Maximize2 } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isMacOS } from "../utils/platform";

export function WidgetResizeHandle() {
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const [nativeGripSize, setNativeGripSize] = useState(16);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const showCurrentSize = useRef<() => void>(() => {});

  useEffect(() => {
    let active = true;
    let dpi = 1;
    const unlisteners: (() => void)[] = [];
    const win = getCurrentWindow();
    const showSize = (width: number, height: number) => {
      if (!active) return;
      // Show screen coordinates (logical pixels), independent of WebView zoom.
      setSize({ width: Math.round(width / dpi), height: Math.round(height / dpi) });
      clearTimeout(hideTimer.current);
      hideTimer.current = setTimeout(() => { if (active) setSize(null); }, 1200);
    };
    const attach = async () => {
      const [factor, initialSize] = await Promise.all([win.scaleFactor(), win.innerSize()]);
      if (!active) return;
      dpi = factor;
      let latestSize = initialSize;
      const syncGripSize = () => {
        // AppKit's edge target is 16 logical screen points. Keep the visible
        // grip inside it even when the user changes WebView UI zoom or DPI.
        if (active && isMacOS && latestSize.width > 0) setNativeGripSize(16 * window.innerWidth * dpi / latestSize.width);
      };
      syncGripSize();
      window.addEventListener("resize", syncGripSize);
      unlisteners.push(() => window.removeEventListener("resize", syncGripSize));
      showCurrentSize.current = () => showSize(latestSize.width, latestSize.height);
      const unscale = await win.onScaleChanged(event => {
        dpi = event.payload.scaleFactor;
        latestSize = event.payload.size;
        syncGripSize();
      });
      if (!active) { unscale(); return; }
      unlisteners.push(unscale);
      const unresize = await win.onResized(event => {
        latestSize = event.payload;
        syncGripSize();
        showSize(latestSize.width, latestSize.height);
      });
      if (!active) { unresize(); return; }
      unlisteners.push(unresize);
    };
    attach().catch(error => console.error("Widget size indicator failed", error));
    return () => {
      active = false;
      clearTimeout(hideTimer.current);
      unlisteners.forEach(stop => stop());
    };
  }, []);

  return <>
    {size && <div aria-hidden="true" data-no-localize
      className="pointer-events-none absolute bottom-1 right-6 z-[60] rounded-md border border-white/20 bg-slate-950/85 px-2 py-1 font-mono text-[11px] leading-none text-white shadow-sm">
      {size.width} × {size.height}
    </div>}
    {isMacOS ? <span aria-hidden="true" data-no-drag="true"
      style={{ width: nativeGripSize, height: nativeGripSize }}
      className="widget-resize-handle pointer-events-none absolute bottom-0 right-0 z-50 flex opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity items-center justify-center text-slate-400/70">
      <Maximize2 className="h-3/4 w-3/4" />
    </span> : <button type="button" data-no-drag="true" aria-label="Resize widget" title="Resize widget"
      onPointerDown={event => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        showCurrentSize.current();
        getCurrentWindow().startResizeDragging("SouthEast").catch(console.error);
      }}
      className="widget-resize-handle absolute bottom-0 right-0 z-50 flex h-5 w-5 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity items-center justify-center rounded-md text-slate-400/70 hover:bg-white/10 hover:text-white cursor-se-resize">
      <Maximize2 size={12} />
    </button>}
  </>;
}
