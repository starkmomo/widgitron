import { useId, useRef, type ClipboardEvent } from "react";
import { Plus, X } from "lucide-react";
import { appendArxivKeywords } from "../utils/arxivKeywords";

export function KeywordTagsInput({ keywords, draft, onDraftChange, onKeywordsChange, isLight }: {
  keywords: string[];
  draft: string;
  onDraftChange: (value: string) => void;
  onKeywordsChange: (keywords: string[]) => void;
  isLight: boolean;
}) {
  const id = useId();
  const composing = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const add = (value = draft) => {
    onKeywordsChange(appendArxivKeywords(keywords, value));
    onDraftChange("");
  };
  const change = (value: string) => {
    if (composing.current) { onDraftChange(value); return; }
    const parts = value.split(/[,，;；\r\n]/);
    if (parts.length === 1) { onDraftChange(value); return; }
    const remaining = parts.pop() ?? "";
    onKeywordsChange(appendArxivKeywords(keywords, parts.join(",")));
    onDraftChange(remaining);
  };
  const paste = (event: ClipboardEvent<HTMLInputElement>) => {
    const text = event.clipboardData.getData("text/plain");
    if (composing.current || !/[,，;；\r\n]/.test(text)) return;
    event.preventDefault();
    const field = event.currentTarget;
    add(field.value.slice(0, field.selectionStart ?? field.value.length)
      + text + field.value.slice(field.selectionEnd ?? field.value.length));
  };
  return <div className="space-y-2">
    <label htmlFor={id} className="text-[10px] font-black uppercase tracking-widest text-slate-500">Keywords</label>
    <div className={`flex min-h-12 flex-wrap items-center gap-2 rounded-xl border p-2.5 transition-colors focus-within:border-blue-500 ${
      isLight ? "border-slate-200 bg-slate-50" : "border-white/10 bg-black/40"
    }`}>
      {keywords.map((keyword, index) => <span key={keyword}
        className={`inline-flex max-w-full items-center gap-1 rounded-lg border py-1 pl-2.5 pr-1 text-xs ${
          isLight ? "border-blue-100 bg-blue-50 text-blue-700" : "border-blue-500/20 bg-blue-500/15 text-blue-200"
        }`}>
        <span id={`${id}-${index}`} className="min-w-0 break-words [overflow-wrap:anywhere]" data-no-localize>{keyword}</span>
        <button type="button" aria-label="Remove keyword" title="Remove keyword" aria-describedby={`${id}-${index}`}
          className="flex size-6 shrink-0 items-center justify-center rounded-md hover:bg-blue-500/15 focus-visible:outline-2 focus-visible:outline-blue-500"
          onClick={() => onKeywordsChange(keywords.filter((_, current) => current !== index))}>
          <X size={12} aria-hidden="true" />
        </button>
      </span>)}
      <div className="flex min-w-40 flex-1 items-center gap-1">
        <input id={id} ref={input} type="text" autoComplete="off" value={draft}
          placeholder="Type a keyword, then Enter" onChange={event => change(event.target.value)} onPaste={paste}
          onCompositionStart={() => { composing.current = true; }}
          onCompositionEnd={event => { composing.current = false; change(event.currentTarget.value); }}
          onKeyDown={event => {
            // WebKit can report isComposing=false on the Enter that selects an IME candidate.
            if (composing.current || event.nativeEvent.isComposing || event.keyCode === 229) return;
            if (event.key === "Enter") { event.preventDefault(); add(); }
          }}
          className={`min-w-0 flex-1 bg-transparent px-1 py-1.5 text-xs outline-none ${isLight ? "text-slate-900 placeholder:text-slate-400" : "text-white placeholder:text-slate-500"}`}
        />
        <button type="button" aria-label="Add keyword" title="Add keyword" disabled={!draft.trim()}
          className="flex size-7 shrink-0 items-center justify-center rounded-lg text-blue-500 hover:bg-blue-500/10 disabled:opacity-30 focus-visible:outline-2 focus-visible:outline-blue-500"
          onClick={() => { add(); input.current?.focus(); }}>
          <Plus size={15} aria-hidden="true" />
        </button>
      </div>
    </div>
  </div>;
}
