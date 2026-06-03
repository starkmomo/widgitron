import { ChevronRight } from "lucide-react";

interface WidgetPreviewCardProps {
  title: string;
  status: string; // kept in props for compatibility but not rendered as a badge
  detail: string;
  trend: string;
  color: string; // kept for compatibility
  theme?: string;
  onLaunch: () => void;
}

export function WidgetPreviewCard({
  title,
  status,
  detail,
  trend,
  color: _color,
  theme = "dark",
  onLaunch
}: WidgetPreviewCardProps) {
  const isLight = theme === "light";
  const isActive = status === "Active";

  return (
    <div
      className={`p-6 rounded-2xl border transition-all duration-300 group shadow-sm flex flex-col justify-between cursor-pointer ${
        isLight
          ? isActive
            ? "bg-blue-50/50 border-blue-200 hover:border-blue-300"
            : "bg-slate-50 border-slate-200 hover:bg-slate-100 hover:border-slate-300"
          : isActive
            ? "bg-blue-600/5 border-blue-500/30 hover:border-blue-400/40 shadow-[0_0_20px_rgba(59,130,246,0.05)]"
            : "bg-white/5 border-white/5 hover:bg-white/10 hover:border-white/15"
      }`}
      onClick={onLaunch}
    >
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className={`font-bold text-base tracking-tight transition-colors ${
            isLight 
              ? isActive ? "text-blue-600" : "text-slate-800"
              : isActive ? "text-blue-400" : "text-white"
          }`}>
            {title}
          </h3>
        </div>
        <div className={`text-xs mb-6 font-medium leading-relaxed h-10 ${isLight ? "text-slate-500" : "text-slate-400"}`}>
          {detail}
        </div>
      </div>
      
      <div className="flex items-center justify-between">
        <button
          onClick={(e) => { e.stopPropagation(); onLaunch(); }}
          className={`text-[10px] font-black tracking-wider uppercase px-4 py-2 rounded-xl transition-all cursor-pointer ${
            isLight
              ? isActive
                ? "bg-blue-600 text-white hover:bg-blue-700 shadow-md shadow-blue-600/10"
                : "bg-slate-200/50 text-slate-700 hover:bg-slate-200"
              : isActive
                ? "bg-blue-600 text-white hover:bg-blue-500 shadow-lg shadow-blue-600/20"
                : "bg-white/10 text-slate-300 hover:bg-white/20 hover:text-white"
          }`}
        >
          {trend}
        </button>
        <div
          className={`w-7 h-7 rounded-full flex items-center justify-center transition-all ${
            isLight
              ? isActive
                ? "bg-blue-100 text-blue-600"
                : "bg-slate-200/30 text-slate-400 group-hover:bg-slate-200/60 group-hover:text-slate-600"
              : isActive
                ? "bg-blue-500/10 text-blue-400"
                : "bg-white/5 text-slate-500 group-hover:bg-white/10 group-hover:text-slate-300"
          }`}
        >
          <ChevronRight size={14} className="group-hover:translate-x-0.5 transition-transform" />
        </div>
      </div>
    </div>
  );
}
