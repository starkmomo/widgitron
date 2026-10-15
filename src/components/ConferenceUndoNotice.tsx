import { useEffect, useRef, useState } from "react";
import { Undo2, X } from "lucide-react";

export function ConferenceUndoNotice({ isLight, onUndo, onDismiss }: {
  isLight: boolean; onUndo: () => void; onDismiss: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const dismiss = useRef(onDismiss);
  dismiss.current = onDismiss;
  useEffect(() => {
    if (hovered || focused) return;
    const timer = window.setTimeout(() => dismiss.current(), 8000);
    return () => window.clearTimeout(timer);
  }, [hovered, focused]);

  return (
    <aside aria-label="Conference changes" onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
      onFocusCapture={() => setFocused(true)} onBlurCapture={event => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false);
      }}
      className={`absolute bottom-5 right-5 z-[70] flex max-w-[calc(100%-2.5rem)] items-center gap-4 rounded-xl border p-3 pl-4 shadow-lg ${isLight ? "border-slate-200 bg-white text-slate-700 shadow-slate-900/10" : "border-white/15 bg-slate-800 text-slate-100 shadow-black/25"}`}>
      <p role="status" className="text-xs">Conference selection updated</p>
      <button type="button" onClick={onUndo} className="inline-flex min-h-8 shrink-0 items-center gap-1.5 rounded-lg px-2 text-xs font-semibold text-blue-500 hover:bg-blue-500/10">
        <Undo2 size={14} /><span>Undo</span>
      </button>
      <button type="button" onClick={onDismiss} aria-label="Dismiss" title="Dismiss" className="flex size-8 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-500/10 hover:text-red-500">
        <X size={14} />
      </button>
    </aside>
  );
}
