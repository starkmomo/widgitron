import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Trash2 } from "lucide-react";

export function ConfirmDialog({ title, children, isLight, onConfirm, onCancel }: {
  title: string; children: ReactNode; isLight: boolean; onConfirm: () => void; onCancel: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const id = useId();
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const current = dialog.current;
    current?.showModal();
    heading.current?.focus({ preventScroll: true });
    return () => { current?.close(); if (previous?.isConnected) previous.focus({ preventScroll: true }); };
  }, []);
  return createPortal(<dialog ref={dialog} aria-labelledby={id} aria-describedby={`${id}-description`}
    onKeyDownCapture={event => { if (event.key === "Escape") event.stopPropagation(); }}
    onCancel={event => { event.preventDefault(); onCancel(); }}
    onClick={event => {
      if (event.target !== event.currentTarget) return;
      const rect = event.currentTarget.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onCancel();
    }}
    className={`reading-dialog m-auto w-[calc(100%_-_3rem)] max-w-sm rounded-2xl border p-6 shadow-2xl backdrop:bg-slate-950/40 ${
      isLight ? "border-slate-200 bg-white text-slate-900" : "border-slate-700 bg-slate-900 text-slate-100"
    }`}>
    <div className="mb-4 flex items-center gap-3"><div className="rounded-xl bg-red-500/10 p-2.5 text-red-500"><Trash2 size={18} /></div>
      <h2 ref={heading} tabIndex={-1} id={id} className="text-sm font-bold outline-none">{title}</h2></div>
    <div id={`${id}-description`} className="break-words text-xs leading-relaxed text-slate-500">{children}</div>
    <div className="mt-6 flex justify-end gap-2">
      <button type="button" onClick={onCancel} className={`rounded-xl border px-4 py-2 text-xs font-semibold hover:bg-slate-400/10 ${isLight ? "border-slate-200" : "border-slate-700"}`}>Cancel</button>
      <button type="button" onClick={onConfirm} className="rounded-xl bg-red-500 px-4 py-2 text-xs font-semibold text-white hover:bg-red-600">Delete</button>
    </div>
  </dialog>, document.body);
}
