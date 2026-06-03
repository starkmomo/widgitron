import React from "react";

interface WindowButtonProps {
  icon: React.ReactNode;
  onClick: () => void;
  hoverColor?: string;
  theme?: string;
}

export function WindowButton({
  icon,
  onClick,
  hoverColor = "hover:bg-white/10",
  theme = "dark"
}: WindowButtonProps) {
  const defaultHover = theme === "light" ? "hover:bg-black/10" : "hover:bg-white/10";
  return (
    <button
      data-no-drag="true"
      onClick={onClick}
      className={`w-12 h-10 flex items-center justify-center transition-all rounded-md ${
        hoverColor === "hover:bg-white/10" ? defaultHover : hoverColor
      } active:scale-95 z-50 pointer-events-auto`}
    >
      {icon}
    </button>
  );
}
