import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, LoaderCircle, Search, Server } from "lucide-react";

export function SshHostPicker({ aliases, value, placeholder, loading, isLight, onSelect }: {
  aliases: string[]; value: string; placeholder: string; loading: boolean; isLight: boolean;
  onSelect: (alias: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [position, setPosition] = useState<CSSProperties>({});
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const listId = useId();
  const matches = aliases.filter(alias => alias.toLowerCase().includes(query.trim().toLowerCase()));
  const close = (focusTrigger = false) => { setOpen(false); if (focusTrigger) trigger.current?.focus(); };
  const choose = (alias: string) => { close(true); onSelect(alias); };
  useEffect(() => { if (loading) setOpen(false); }, [loading]);
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = trigger.current?.getBoundingClientRect();
      if (!rect) return;
      const below = window.innerHeight - rect.bottom;
      const above = rect.top;
      const upward = below < 240 && above > below;
      setPosition({
        width: Math.min(rect.width, window.innerWidth - 24),
        left: Math.max(12, Math.min(rect.left, window.innerWidth - rect.width - 12)),
        ...(upward ? { bottom: window.innerHeight - rect.top + 8 } : { top: rect.bottom + 8 }),
        maxHeight: Math.max(100, Math.min(320, (upward ? above : below) - 20)),
      });
    };
    place();
    search.current?.focus();
    window.addEventListener("resize", place);
    const dismiss = (event: Event) => {
      const target = event.target as Node;
      if (trigger.current?.contains(target) || panel.current?.contains(target)) return;
      setOpen(false);
    };
    const scroll = (event: Event) => { if (!panel.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      event.preventDefault();
      close(true);
    };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("focusin", dismiss);
    document.addEventListener("scroll", scroll, true);
    document.addEventListener("keydown", escape, true);
    return () => {
      window.removeEventListener("resize", place);
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("focusin", dismiss);
      document.removeEventListener("scroll", scroll, true);
      document.removeEventListener("keydown", escape, true);
    };
  }, [open]);
  useEffect(() => {
    if (open) document.getElementById(`${listId}-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [active, open, query, listId]);
  const toggle = () => {
    setQuery("");
    setActive(Math.max(0, aliases.indexOf(value)));
    setOpen(previous => !previous);
  };
  return <>
    <button ref={trigger} type="button" aria-label="SSH host" aria-haspopup="listbox" aria-expanded={open}
      aria-controls={open ? listId : undefined} disabled={loading} onClick={toggle}
      onKeyDown={event => {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); if (!open) toggle(); }
      }}
      className={`flex min-w-0 flex-1 items-center gap-2 rounded-xl border px-3 py-2.5 text-left text-xs transition-colors disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-blue-500 ${
        open ? "border-blue-500" : "border-[var(--dashboard-border)]"
      } ${isLight ? "bg-slate-50 text-slate-700 hover:bg-blue-50/60" : "bg-white/5 text-slate-200 hover:bg-white/10"}`}>
      <Server size={14} className="shrink-0 text-blue-500" aria-hidden="true" />
      {value ? <span className="min-w-0 flex-1 truncate" data-no-localize>{value}</span>
        : <span className="min-w-0 flex-1 truncate text-slate-500">{placeholder}</span>}
      {loading ? <LoaderCircle size={14} className="shrink-0 animate-spin" aria-hidden="true" />
        : <ChevronDown size={14} className={`shrink-0 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true" />}
    </button>
    {open && createPortal(<div ref={panel} style={position} data-no-drag="true"
      className={`fixed z-[100] flex flex-col overflow-hidden rounded-xl border shadow-xl ${isLight ? "border-slate-200 bg-white text-slate-700" : "border-slate-700 bg-slate-900 text-slate-200"}`}>
      <div className={`relative shrink-0 border-b p-2 ${isLight ? "border-slate-100" : "border-white/10"}`}>
        <Search size={14} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
        <input ref={search} role="combobox" aria-label="Search SSH hosts" placeholder="Search SSH hosts" autoComplete="off"
          aria-expanded={open} aria-controls={listId} aria-autocomplete="list"
          aria-activedescendant={matches[active] ? `${listId}-${active}` : undefined} value={query}
          onChange={event => { setQuery(event.target.value); setActive(0); }}
          onKeyDown={event => {
            if (event.nativeEvent.isComposing || event.keyCode === 229) return;
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              setActive(previous => matches.length ? (previous + (event.key === "ArrowDown" ? 1 : -1) + matches.length) % matches.length : 0);
            } else if (event.key === "Enter") { event.preventDefault(); if (matches[active]) choose(matches[active]); }
          }}
          className={`w-full rounded-lg border border-transparent py-2 pl-8 pr-2 text-xs outline-none focus:border-blue-500 ${isLight ? "bg-slate-50 placeholder:text-slate-400" : "bg-white/5 placeholder:text-slate-500"}`} />
      </div>
      <div id={listId} role="listbox" aria-label="SSH hosts" className="min-h-0 overflow-y-auto p-1">
        {matches.length ? matches.map((alias, index) => <div key={alias} id={`${listId}-${index}`} role="option"
          aria-selected={alias === value} onMouseEnter={() => setActive(index)}
          onMouseDown={event => event.preventDefault()} onClick={() => choose(alias)}
          className={`flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2.5 text-xs ${index === active
            ? isLight ? "bg-blue-50 text-blue-700" : "bg-blue-500/15 text-blue-200" : ""}`}>
          <span className="min-w-0 flex-1 break-words [overflow-wrap:anywhere]" data-no-localize>{alias}</span>
          {alias === value && <Check size={14} className="shrink-0 text-blue-500" aria-hidden="true" />}
        </div>) : <p role="status" className="px-3 py-4 text-xs text-slate-500">{aliases.length ? "No matching SSH hosts" : "No SSH hosts found"}</p>}
      </div>
    </div>, document.body)}
  </>;
}
