import { useEffect, useRef, useState } from "react";
import { Lock, Pin, PinOff, Unlock, X } from "lucide-react";

interface FloatingWindowControlsProps {
  locked: boolean;
  pinned: boolean;
  light: boolean;
  onToggleLock: () => Promise<void>;
  onTogglePin: () => Promise<void>;
  onHide: () => Promise<void>;
}

export function FloatingWindowControls({
  locked, pinned, light, onToggleLock, onTogglePin, onHide,
}: FloatingWindowControlsProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const pending = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const run = async (action: () => Promise<void>) => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError(false);
    try {
      await action();
    } catch (cause) {
      console.error("Could not change floating window options", cause);
      if (mounted.current) setError(true);
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  };

  const iconClass = `flex h-6 w-6 shrink-0 items-center justify-center rounded-md transition-colors focus-visible:outline-2 focus-visible:outline-blue-500 ${light ? "text-slate-500 hover:bg-slate-900/10 hover:text-slate-900" : "text-slate-400 hover:bg-white/10 hover:text-white"}`;
  return (
    <div data-no-drag="true" data-floating-controls className="relative z-50 flex shrink-0 items-center gap-0.5">
        <button type="button" className={iconClass} onClick={() => run(onToggleLock)} disabled={busy}
          aria-pressed={locked} title={locked ? "Unlock to move" : "Lock position"} aria-label={locked ? "Unlock to move" : "Lock position"}>
          {locked ? <Lock size={13} /> : <Unlock size={13} />}
        </button>
        <button type="button" className={iconClass} onClick={() => run(onTogglePin)} disabled={busy}
          aria-pressed={pinned}
          title={pinned ? "Unpin (Embed in Desktop)" : "Keep above other windows"}
          aria-label={pinned ? "Unpin (Embed in Desktop)" : "Keep above other windows"}>
          {pinned ? <Pin size={13} /> : <PinOff size={13} />}
        </button>
      <button type="button" onClick={() => run(onHide)} disabled={busy} title="Hide widget" aria-label="Hide widget"
        className={`${iconClass} hover:!bg-red-500/15 hover:!text-red-500`}><X size={14} /></button>
      {error && <span role="alert" className="sr-only">Could not update window. Try again.</span>}
    </div>
  );
}
