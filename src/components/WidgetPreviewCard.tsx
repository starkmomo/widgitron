import { Loader2, Settings2 } from "lucide-react";

interface WidgetPreviewCardProps {
  title: string;
  detail: string;
  theme?: string;
  enabled: boolean;
  sidebarVisible: boolean;
  floatingVisible: boolean;
  loading?: boolean;
  onToggleSidebar: () => void;
  onToggleFloating: () => void;
  onConfigure: () => void;
}

export function WidgetPreviewCard({
  title, detail, theme = "dark", enabled, sidebarVisible, floatingVisible,
  loading = false, onToggleSidebar,
  onToggleFloating, onConfigure,
}: WidgetPreviewCardProps) {
  const isLight = theme === "light";
  const buttonClass = `min-w-0 rounded-lg px-2 py-2 text-xs font-semibold whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 ${
    isLight ? "bg-slate-100 text-slate-700 hover:bg-slate-200" : "bg-white/10 text-slate-200 hover:bg-white/20"
  }`;
  const stateClass = (active: boolean) =>
    `${buttonClass} ${active ? (isLight ? "!bg-blue-100 !text-blue-800" : "!bg-blue-500/25 !text-blue-100") : ""} disabled:opacity-50 disabled:cursor-not-allowed`;

  return (
    <section className={`min-w-0 rounded-2xl border p-4 ${isLight ? "bg-white border-slate-200" : "bg-white/5 border-white/10"}`}>
      <div className="flex items-center justify-between gap-3">
        <h3 title={detail} className={`min-w-0 truncate text-base font-bold ${isLight ? "text-slate-900" : "text-white"}`}>{title}</h3>
        <button type="button" onClick={onConfigure} className={buttonClass} title="Configure" aria-label="Configure">
          <Settings2 size={16} />
        </button>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <button type="button" onClick={onToggleSidebar} aria-pressed={sidebarVisible}
          aria-label={sidebarVisible ? "Sidebar: Shown" : "Sidebar: Hidden"}
          title={sidebarVisible ? "Sidebar: Shown" : "Sidebar: Hidden"}
          className={stateClass(sidebarVisible)}>
          {sidebarVisible ? "Sidebar On" : "Sidebar Off"}
        </button>
        <button type="button" onClick={onToggleFloating} disabled={!enabled || loading}
          aria-pressed={floatingVisible}
          aria-label={floatingVisible ? "Floating window: On" : "Floating window: Off"}
          title={floatingVisible ? "Floating window: On" : "Floating window: Off"}
          className={stateClass(floatingVisible)}>
          {loading ? <Loader2 size={14} className="mx-auto animate-spin" /> : floatingVisible ? "Window On" : "Window Off"}
        </button>
      </div>

    </section>
  );
}
