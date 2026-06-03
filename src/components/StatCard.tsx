import React from "react";

interface StatCardProps {
  label: string;
  value: string;
  icon: React.ReactNode;
  theme?: string;
}

export function StatCard({ label, value, icon, theme = "dark" }: StatCardProps) {
  return (
    <div className="glass-card p-6 flex items-center gap-6 border-none">
      <div
        className={`w-14 h-14 rounded-2xl flex items-center justify-center border ${
          theme === "light" ? "bg-slate-100 border-slate-200" : "bg-white/5 border-white/10"
        }`}
      >
        {icon}
      </div>
      <div>
        <div className="text-[10px] text-slate-500 font-black uppercase tracking-widest mb-1">{label}</div>
        <div className={`text-3xl font-black tracking-tighter ${theme === "light" ? "text-slate-900" : "text-white"}`}>
          {value}
        </div>
      </div>
    </div>
  );
}
