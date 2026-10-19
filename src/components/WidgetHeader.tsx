import type { ReactNode } from "react";

export function WidgetHeader({ icon, title, status, actions, controls, color }: {
  icon: ReactNode;
  title: string;
  status?: ReactNode;
  actions?: ReactNode;
  controls?: ReactNode;
  color: string;
}) {
  return <div className="widget-header relative z-20 mb-2 flex min-h-6 shrink-0 items-center gap-2">
    <span className="shrink-0">{icon}</span>
    <span className="min-w-0 flex-1 truncate text-xs font-bold" style={{ color }}>{title}</span>
    {status}
    <div className="flex shrink-0 items-center gap-1" data-no-drag="true" onMouseDown={(event) => event.stopPropagation()}>{actions}{controls}</div>
  </div>;
}
