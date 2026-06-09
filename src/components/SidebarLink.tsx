import React from "react";
import { motion } from "framer-motion";

interface SidebarLinkProps {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
  theme?: string;
  badge?: React.ReactNode;
}

export function SidebarLink({ icon, label, active, onClick, theme = "dark", badge }: SidebarLinkProps) {
  const isLight = theme === "light";
  return (
    <button
      data-no-drag="true"
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-4 py-3.5 rounded-2xl transition-all duration-300 group ${
        active
          ? isLight
            ? "bg-blue-600 text-white shadow-lg shadow-blue-600/20"
            : "bg-blue-600/20 text-blue-400 border border-blue-500/20"
          : isLight
          ? "hover:bg-slate-100 text-slate-500 hover:text-slate-900"
          : "hover:bg-white/5 text-slate-500 hover:text-slate-200"
      }`}
    >
      <span
        className={`${
          active
            ? isLight
              ? "text-white"
              : "text-blue-400"
            : isLight
            ? "text-slate-400 group-hover:text-blue-600"
            : "group-hover:text-blue-400/80"
        }`}
      >
        {icon}
      </span>
      <span className={`font-bold text-sm ${active ? (isLight ? "text-white" : "text-white") : ""}`}>{label}</span>
      {badge && <div className="ml-auto flex items-center">{badge}</div>}
      {active && !badge && (
        <motion.div
          layoutId="active-indicator"
          className={`ml-auto w-1.5 h-1.5 rounded-full ${isLight ? "bg-white" : "bg-blue-400"}`}
        />
      )}
    </button>
  );
}
