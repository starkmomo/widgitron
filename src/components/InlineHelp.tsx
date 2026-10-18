import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { CircleHelp } from "lucide-react";

/** Supplemental help takes no space in the control row. */
export function InlineHelp({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const pinned = useRef(false);
  const root = useRef<HTMLSpanElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      if (root.current?.contains(event.target as Node)) return;
      pinned.current = false;
      setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      pinned.current = false;
      setOpen(false);
    };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", escape, true);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", escape, true);
    };
  }, [open]);
  return <span ref={root} className="relative inline-flex shrink-0 items-center"
    onMouseEnter={() => setOpen(true)}
    onMouseLeave={() => { if (!pinned.current && !root.current?.contains(document.activeElement)) setOpen(false); }}
    onFocus={() => setOpen(true)}
    onBlur={event => {
      if (!event.currentTarget.contains(event.relatedTarget)) { pinned.current = false; setOpen(false); }
    }}>
    <button type="button" aria-label={label} aria-expanded={open} aria-describedby={open ? id : undefined}
      onClick={event => { event.stopPropagation(); pinned.current = !pinned.current; setOpen(pinned.current); }}
      className="inline-flex size-7 items-center justify-center rounded-full text-slate-400 hover:text-blue-500 focus-visible:outline-2 focus-visible:outline-blue-500">
      <CircleHelp size={15} />
    </button>
    {open && <span id={id} role="tooltip"
      className="absolute bottom-full left-1/2 z-50 mb-2 w-64 -translate-x-1/2 rounded-xl border border-[var(--dashboard-border)] bg-[var(--dashboard-bg)] p-3 text-xs font-normal normal-case leading-5 tracking-normal text-[var(--dashboard-text)] shadow-xl">
      {children}
    </span>}
  </span>;
}
