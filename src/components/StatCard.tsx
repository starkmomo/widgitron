import React from "react";

interface StatCardProps {
  label: string;
  value: string;
  icon: React.ReactNode;
  theme?: string;
  hint?: string;
  hintTone?: "default" | "warning";
  onClick?: () => void;
}

export function StatCard({
  label,
  value,
  icon,
  theme = "dark",
  hint,
  hintTone = "default",
  onClick,
}: StatCardProps) {
  const content = (
    <>
      <div
        className={`w-12 h-12 rounded-xl flex items-center justify-center border ${
          theme === "light" ? "bg-slate-100 border-slate-200" : "bg-white/5 border-white/10"
        }`}
      >
        {icon}
      </div>
      <div>
        <div className={`text-xs font-bold mb-1 ${theme === "light" ? "text-slate-500" : "text-slate-300"}`}>{label}</div>
        <div className={`text-3xl font-black tracking-tighter ${theme === "light" ? "text-slate-900" : "text-white"}`}>
          {value}
        </div>
        {hint && (
          <div className={`text-xs font-medium mt-1 ${hintTone === "warning" ? "text-amber-500" : theme === "light" ? "text-slate-500" : "text-slate-400"}`}>
            {hint}
          </div>
        )}
      </div>
    </>
  );
  return (
    onClick ? (
      <button type="button" onClick={onClick} className="glass-card p-4 flex items-center gap-4 border-none text-left w-full hover:ring-2 hover:ring-blue-500/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 transition-shadow">
        {content}
      </button>
    ) : (
      <div className="glass-card p-4 flex items-center gap-4 border-none">{content}</div>
    )
  );
}
