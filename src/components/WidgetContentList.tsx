import type { ReactNode } from "react";

/** Keep the list's intrinsic height measurable independently of its viewport. */
export function WidgetContentList({ children, className = "", spacing = "space-y-2" }: {
  children: ReactNode;
  className?: string;
  spacing?: string;
}) {
  return <div className={`widget-content-list flex-1 min-h-0 overflow-y-auto custom-scrollbar ${className}`}>
    <div data-widget-natural-content className={`flow-root ${spacing}`}>{children}</div>
  </div>;
}
