import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Maximize2, X } from "lucide-react";
import type { CSSProperties } from "react";
import type { ArxivPaper } from "../types/config";
import type { WidgetTheme } from "../types/theme";
import { widgetOverlaySurface } from "../utils/widgetOverlaySurface";
import { ArxivPaperMetadata } from "./ArxivPaperMetadata";

export function ArxivAbstractPreview({ paper, compact = false, isLight, textColor, theme }: {
  paper: Pick<ArxivPaper, "title" | "summary" | "authors" | "published">;
  compact?: boolean;
  isLight: boolean;
  textColor?: string;
  theme?: WidgetTheme;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const initialFocusRef = useRef<HTMLHeadingElement>(null);
  const previewBoxRef = useRef<HTMLDivElement>(null);
  const previewTextRef = useRef<HTMLParagraphElement>(null);
  const [previewLines, setPreviewLines] = useState(6);
  const [reading, setReading] = useState(false);
  const titleId = useId();
  const overlay = theme ? widgetOverlaySurface(theme, isLight) : null;

  useLayoutEffect(() => {
    const box = previewBoxRef.current;
    const text = previewTextRef.current;
    if (!box || !text) return;
    const measure = () => {
      const lineHeight = Number.parseFloat(getComputedStyle(text).lineHeight);
      if (!Number.isFinite(lineHeight) || lineHeight <= 0) return;
      const lines = Math.max(1, Math.floor(box.clientHeight / lineHeight));
      setPreviewLines((previous) => previous === lines ? previous : lines);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    return () => observer.disconnect();
  }, [compact]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (reading) {
      dialog?.showModal();
      initialFocusRef.current?.focus({ preventScroll: true });
    }
    return () => dialog?.close();
  }, [reading]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        ref={previewBoxRef}
        className={`arxiv-abstract-preview relative flex-1 overflow-hidden leading-relaxed ${compact ? "min-h-[1.625em] text-[9px]" : "min-h-[9.75em] text-[10px]"}`}
      >
        {/* Six lines establish the dashboard row's natural height. Absolute
            text fills spare space without increasing that height on resize. */}
        <p
          ref={previewTextRef}
          className={`arxiv-abstract-text absolute inset-x-0 top-0 overflow-hidden break-words ${compact ? "opacity-60" : "text-slate-500"}`}
          style={{ color: textColor, display: "-webkit-box", WebkitBoxOrient: "vertical", WebkitLineClamp: previewLines }}
        >
          {paper.summary}
        </p>
      </div>
      <button
        ref={triggerRef}
        type="button"
        data-no-drag="true"
        className={`arxiv-abstract-action mt-2 inline-flex shrink-0 self-start items-center gap-1 rounded text-blue-500 hover:text-blue-600 hover:underline focus-visible:outline-2 focus-visible:outline-blue-500 ${compact ? "text-[9px]" : "text-[10px]"}`}
        onPointerDownCapture={(event) => event.stopPropagation()}
        onClick={() => setReading(true)}
        aria-haspopup="dialog"
      >
        <span>Full abstract</span>
        <Maximize2 size={compact ? 10 : 11} aria-hidden="true" />
      </button>
      {reading && createPortal(
        <dialog
          ref={dialogRef}
          data-compact={compact ? "true" : undefined}
          data-translucent={overlay?.translucent ? "true" : undefined}
          aria-labelledby={titleId}
          data-no-drag="true"
          className="reading-dialog fixed inset-0 m-0 h-full max-h-none w-full max-w-none items-center justify-center overflow-hidden border-0 p-4 outline-none"
          onPointerDownCapture={(event) => event.stopPropagation()}
          onKeyDownCapture={(event) => {
            // Let the dialog handle Escape without hiding the sidebar window.
            if (event.key === "Escape") event.stopPropagation();
          }}
          onClose={() => {
            setReading(false);
            triggerRef.current?.focus({ preventScroll: true });
          }}
          onClick={(event) => {
            if (event.target === event.currentTarget) event.currentTarget.close();
          }}
        >
          <div
            data-glass-tone={overlay?.glass ? (isLight ? "light" : "dark") : undefined}
            className={`relative flex w-full max-w-2xl max-h-[calc(100dvh_-_2rem)] flex-col overflow-hidden rounded-2xl border p-0 shadow-2xl ${overlay?.glass ? "glass-surface glass-menu" : ""} ${isLight ? "border-slate-200 bg-white text-slate-900" : "border-slate-700 bg-slate-900 text-slate-100"}`}
            style={overlay?.translucent ? {
              backgroundColor: overlay.backgroundColor,
              borderColor: overlay.glass ? "transparent" : overlay.borderColor,
              color: overlay.color, backdropFilter: overlay.backdropFilter,
              WebkitBackdropFilter: overlay.backdropFilter, "--glass-radius": "16px",
            } as CSSProperties : undefined}
          >
            <header className={`flex shrink-0 items-start ${compact ? "gap-2 p-3 pb-2" : "gap-4 p-5 pb-4"}`}>
              <div className="min-w-0 flex-1 max-h-[30dvh] overflow-y-auto">
                <h2 ref={initialFocusRef} tabIndex={-1} id={titleId} data-no-localize className={`outline-none font-bold break-words ${compact ? "text-sm leading-snug" : "text-base leading-relaxed"}`}>
                  {paper.title}
                </h2>
              </div>
              <button
                type="button"
                data-dialog-close
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-red-500 hover:bg-red-500/10 focus-visible:outline-2 focus-visible:outline-red-500"
                title="Close abstract"
                aria-label="Close abstract"
                onClick={() => dialogRef.current?.close()}
              >
                <X size={18} aria-hidden="true" />
              </button>
            </header>
            <div tabIndex={0} className={`min-h-0 overflow-y-auto overscroll-contain ${compact ? "px-3 pb-3 text-sm leading-[1.5]" : "px-5 pb-5 text-sm leading-7"} ${overlay?.translucent ? "" : isLight ? "text-slate-600" : "text-slate-300"}`}>
              <ArxivPaperMetadata paper={paper} full isLight={isLight} color={overlay?.translucent ? overlay.color : undefined} className="mb-3" />
              <p data-no-localize className="whitespace-pre-line break-words">{paper.summary}</p>
            </div>
          </div>
        </dialog>,
        document.body,
      )}
    </div>
  );
}
