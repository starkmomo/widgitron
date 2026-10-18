import type { ReactNode } from "react";

export function FilterChoice({ selected, isLight, label, onClick, children, compact = false, className = "" }: {
  selected: boolean; isLight: boolean; label?: string;
  onClick: () => void; children: ReactNode; compact?: boolean; className?: string;
}) {
  return <button type="button" aria-pressed={selected} aria-label={label} onClick={onClick}
    className={`flex min-h-9 min-w-0 items-center justify-center whitespace-nowrap rounded-lg border ${compact ? "px-1 py-2 text-[10px]" : "px-2 py-2 text-[11px]"} font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 ${
      selected ? "border-blue-600 bg-blue-600 text-white hover:bg-blue-700"
        : isLight ? "border-slate-200 bg-slate-50 text-slate-600 hover:border-blue-300 hover:bg-blue-50"
          : "border-white/10 bg-white/5 text-slate-300 hover:border-blue-400/50 hover:bg-white/10"
    } ${className}`}>
    {children}
  </button>;
}
