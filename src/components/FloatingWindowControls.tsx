import { useEffect, useRef, useState } from "react";
import { CheckMenuItem, Menu, PredefinedMenuItem } from "@tauri-apps/api/menu";
import { PhysicalPosition } from "@tauri-apps/api/dpi";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Lock, MoreHorizontal, Pin, PinOff, Unlock, X } from "lucide-react";
import type { UiLanguage } from "../utils/localization";

export type WidgetDisplayMode = "normal" | "topmost" | "desktop";

interface FloatingWindowControlsProps {
  macOS: boolean;
  language: UiLanguage;
  locked: boolean;
  pinned: boolean;
  desktopFixed: boolean;
  light: boolean;
  onToggleLock: () => Promise<void>;
  onTogglePin: () => Promise<void>;
  onDisplayModeChange: (mode: WidgetDisplayMode) => Promise<void>;
  onHide: () => Promise<void>;
}

const DISPLAY_MODES: { value: WidgetDisplayMode; en: string; zh: string }[] = [
  { value: "normal", en: "Normal floating window", zh: "普通浮窗" },
  { value: "topmost", en: "Always on top", zh: "始终置顶" },
  { value: "desktop", en: "Desktop layer", zh: "置于桌面层" },
];

export function FloatingWindowControls({
  macOS, language, locked, pinned, desktopFixed, light,
  onToggleLock, onTogglePin, onDisplayModeChange, onHide,
}: FloatingWindowControlsProps) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const menuOpening = useRef(false);
  const mounted = useRef(true);
  const mode = desktopFixed ? "desktop" : pinned ? "topmost" : "normal";
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const run = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError(false);
    try {
      await action();
    } catch (cause) {
      console.error("Could not change floating window options", cause);
      if (mounted.current) setError(true);
    } finally {
      if (mounted.current) setBusy(false);
    }
  };

  const showNativeMenu = async () => {
    if (menuOpening.current || busy) return;
    menuOpening.current = true;
    setOpen(true);
    setError(false);
    const resources: (Menu | CheckMenuItem | PredefinedMenuItem)[] = [];
    try {
      const items: (CheckMenuItem | PredefinedMenuItem)[] = [];
      for (const option of DISPLAY_MODES) {
        const item = await CheckMenuItem.new({
          text: language === "zh-CN" ? option.zh : option.en,
          checked: mode === option.value,
          action: () => { void run(() => onDisplayModeChange(option.value)); },
        });
        resources.push(item);
        items.push(item);
      }
      const separator = await PredefinedMenuItem.new({ item: "Separator" });
      resources.push(separator);
      items.push(separator);
      const lockItem = await CheckMenuItem.new({
        text: language === "zh-CN" ? "锁定位置" : "Lock position",
        checked: locked,
        action: () => { void run(onToggleLock); },
      });
      resources.push(lockItem);
      items.push(lockItem);
      const menu = await Menu.new({ items });
      resources.push(menu);
      if (!mounted.current) return;
      const rect = trigger.current?.getBoundingClientRect();
      const position = rect ? new PhysicalPosition(
        Math.round(rect.left * window.devicePixelRatio),
        Math.round(rect.bottom * window.devicePixelRatio),
      ) : undefined;
      // AppKit draws this menu outside the webview, constrained by the screen
      // rather than the floating card. No extra widget height is needed.
      await menu.popup(position, getCurrentWindow());
    } catch (cause) {
      console.error("Could not open floating window options", cause);
      if (mounted.current) setError(true);
    } finally {
      // Native popup is modal on macOS; release every menu/item resource once
      // it closes, including partial creation failures and unmounted windows.
      for (const resource of resources.reverse()) {
        await resource.close().catch(console.error);
      }
      menuOpening.current = false;
      if (mounted.current) setOpen(false);
    }
  };

  const iconClass = `flex h-6 w-6 shrink-0 items-center justify-center rounded-md transition-colors focus-visible:outline-2 focus-visible:outline-blue-500 ${light ? "text-slate-500 hover:bg-slate-900/10 hover:text-slate-900" : "text-slate-400 hover:bg-white/10 hover:text-white"}`;
  return (
    <div data-no-drag="true" className={`relative z-50 flex shrink-0 items-center gap-0.5 transition-opacity ${open ? "opacity-100" : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"}`}>
      {macOS ? <button ref={trigger} type="button" className={`${iconClass} ${error ? "!text-red-500" : ""}`}
        title={error ? "Could not update window. Try again." : "Window options"} aria-label="Window options"
        aria-haspopup="menu" aria-expanded={open} disabled={busy} onClick={() => { void showNativeMenu(); }}>
        <MoreHorizontal size={16} />
      </button> : <>
        <button type="button" className={iconClass} onClick={() => run(onToggleLock)} disabled={busy}
          title={locked ? "Unlock to move" : "Lock position"} aria-label={locked ? "Unlock to move" : "Lock position"}>
          {locked ? <Lock size={13} /> : <Unlock size={13} />}
        </button>
        <button type="button" className={iconClass} onClick={() => run(onTogglePin)} disabled={busy}
          title={pinned ? "Unpin (Embed in Desktop)" : "Keep above other windows"}
          aria-label={pinned ? "Unpin (Embed in Desktop)" : "Keep above other windows"}>
          {pinned ? <Pin size={13} /> : <PinOff size={13} />}
        </button>
      </>}
      <button type="button" onClick={onHide} title="Hide widget" aria-label="Hide widget"
        className={`${iconClass} hover:!bg-red-500/15 hover:!text-red-500`}><X size={14} /></button>
      {error && <span role="alert" className="sr-only">Could not update window. Try again.</span>}
    </div>
  );
}
