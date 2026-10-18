import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

export function ResearchListDialog({ title, label, closeLabel, count, isLight, compact = false, tools, toolbar, error, onClose, children }: {
  title: string; label: string; closeLabel: string; count: number; isLight: boolean; compact?: boolean;
  tools?: ReactNode; toolbar?: ReactNode; error?: ReactNode; onClose?: () => void; children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const initialFocus = useRef<HTMLHeadingElement>(null);
  const titleId = useId();
  useEffect(() => {
    if (open) {
      dialog.current?.showModal();
      initialFocus.current?.focus({ preventScroll: true });
    }
    return () => dialog.current?.close();
  }, [open]);
  return <>
    {(count > 0 || open) && <button ref={trigger} type="button" data-no-drag="true" onPointerDownCapture={event => event.stopPropagation()}
      className={`inline-flex min-h-8 items-center gap-1 text-slate-500 underline decoration-slate-400/50 underline-offset-4 hover:text-blue-500 ${compact ? "text-[10px]" : "text-xs"}`}
      aria-haspopup="dialog" onClick={() => setOpen(true)}><span>{label}</span><span className="tabular-nums">({count})</span></button>}
    {open && createPortal(<dialog ref={dialog} aria-labelledby={titleId} data-no-drag="true"
      className={`reading-dialog m-auto w-[calc(100%_-_2rem)] max-w-2xl max-h-[calc(100dvh_-_3rem)] overflow-hidden rounded-2xl border p-0 shadow-2xl backdrop:bg-slate-950/40 ${isLight ? "border-slate-200 bg-white text-slate-900" : "border-slate-700 bg-slate-900 text-slate-100"}`}
      onPointerDownCapture={event => event.stopPropagation()} onKeyDownCapture={event => { if (event.key === "Escape") event.stopPropagation(); }}
      onClose={() => { setOpen(false); onClose?.(); trigger.current?.focus({ preventScroll: true }); }}
      onClick={event => {
        if (event.target !== event.currentTarget) return;
        const rect = event.currentTarget.getBoundingClientRect();
        if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.current?.close();
      }}>
      <div className="flex max-h-[calc(100dvh_-_3rem)] flex-col">
        <header className={`flex shrink-0 flex-wrap items-center justify-between gap-3 border-b ${compact ? "px-3 py-2" : "px-5 py-4"} ${isLight ? "border-slate-100" : "border-slate-800"}`}>
          <h2 ref={initialFocus} tabIndex={-1} id={titleId} className="outline-none mr-auto flex items-center gap-2 text-sm font-semibold"><span>{title}</span><span className="text-xs font-normal text-slate-500">({count})</span></h2>
          {tools}
          <button type="button" data-dialog-close className="flex h-8 w-8 items-center justify-center rounded-lg text-red-500 hover:bg-red-500/10" aria-label={closeLabel} title={closeLabel} onClick={() => dialog.current?.close()}><X size={18} /></button>
        </header>
        {error}
        {toolbar && <div className="shrink-0 px-4 pt-3">{toolbar}</div>}
        <div className="min-h-0 overflow-y-auto overscroll-contain px-4">{children}</div>
      </div>
    </dialog>, document.body)}
  </>;
}
