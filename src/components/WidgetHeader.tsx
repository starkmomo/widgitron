import { createContext, useContext, type PointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";

export const SidebarWidgetHeaderContext = createContext<{
  target: HTMLDivElement | null;
  onMoveStart: (event: PointerEvent<HTMLDivElement>) => void;
} | null>(null);

export function WidgetHeader({ icon, title, status, actions, controls, color }: {
  icon: ReactNode;
  title: string;
  status?: ReactNode;
  actions?: ReactNode;
  controls?: ReactNode;
  color: string;
}) {
  const sidebar = useContext(SidebarWidgetHeaderContext);
  const header = <div className={sidebar
    ? "sidebar-widget-header flex h-6 min-w-0 items-center gap-1.5"
    : "widget-header relative z-20 mb-2 flex min-h-6 shrink-0 items-center gap-2"}
    onPointerDown={sidebar ? event => {
      if (!(event.target instanceof Element) || event.target.closest("button, a, input")) return;
      sidebar.onMoveStart(event);
    } : undefined}>
    <span className="shrink-0">{icon}</span>
    <span className={`min-w-0 flex-1 truncate font-bold ${sidebar ? "text-[11px]" : "text-xs"}`} style={{ color }}>{title}</span>
    {status}
    <div className="widget-header-actions flex shrink-0 items-center gap-1" data-no-drag="true"
      onPointerDown={event => event.stopPropagation()} onMouseDown={event => event.stopPropagation()}>{actions}{controls}</div>
  </div>;
  return sidebar ? (sidebar.target ? createPortal(header, sidebar.target) : null) : header;
}
