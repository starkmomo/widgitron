import type { ReactNode, Ref } from "react";

export function ResearchPageHeader({ title, tabs, toolbarActions, filter, actions, headerRef }: {
  title: string; tabs: ReactNode; toolbarActions?: ReactNode; filter?: ReactNode; actions: ReactNode; headerRef?: Ref<HTMLDivElement>;
}) {
  return (
    <div ref={headerRef} className="research-page-header relative z-20 mb-6 space-y-4 scroll-mt-8">
      <div className="research-page-heading">
        <h2 className="text-2xl font-bold tracking-tight text-[var(--dashboard-text)]">{title}</h2>
        <div className="research-page-actions">{actions}</div>
      </div>
      <div className="research-page-toolbar">
        <div className="research-page-views">{tabs}{toolbarActions}</div>
        <div className="research-page-filter">{filter}</div>
      </div>
    </div>
  );
}

export function ResearchTabs<Value extends string>({ value, items, onChange, label, idPrefix, panelId, isLight }: {
  value: Value; items: { value: Value; label: string; count?: number | "…" }[]; onChange: (value: Value) => void;
  label: string; idPrefix: string; panelId?: string; isLight: boolean;
}) {
  return (
    <div role="tablist" aria-label={label} className={`research-view-tabs rounded-xl p-1 ${isLight ? "bg-slate-100" : "bg-white/5"}`}>
      {items.map((item, index) => (
        <button key={item.value} id={`${idPrefix}-tab-${item.value}`} type="button" role="tab"
          aria-selected={value === item.value} aria-controls={panelId} tabIndex={value === item.value ? 0 : -1}
          onClick={() => onChange(item.value)} onKeyDown={event => {
            const target = event.key === "ArrowRight" ? (index + 1) % items.length
              : event.key === "ArrowLeft" ? (index + items.length - 1) % items.length
              : event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : undefined;
            if (target !== undefined) {
              event.preventDefault();
              onChange(items[target].value);
              document.getElementById(`${idPrefix}-tab-${items[target].value}`)?.focus();
            }
          }}
          className={`inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-blue-500 ${value === item.value ? isLight ? "bg-white text-slate-900 shadow-sm" : "bg-white/10 text-white shadow-sm" : "text-slate-500 hover:text-blue-500"}`}>
          <span>{item.label}</span>{item.count !== undefined && <span className="tabular-nums opacity-65">({item.count})</span>}
        </button>
      ))}
    </div>
  );
}
