import { motion } from "framer-motion";

interface MasterSwitchProps {
  enabled: boolean;
  onToggle: (val: boolean) => void;
}

export function MasterSwitch({ enabled, onToggle }: MasterSwitchProps) {
  return (
    <button
      onClick={() => onToggle(!enabled)}
      className={`w-11 h-6 rounded-full relative transition-all duration-300 flex-shrink-0 ${
        enabled ? "bg-emerald-500 shadow-[0_0_12px_rgba(16,185,129,0.3)]" : "bg-slate-700"
      } flex items-center px-1`}
    >
      <motion.div
        animate={{ x: enabled ? 20 : 0 }}
        className="w-4 h-4 bg-white rounded-full shadow-lg"
      />
    </button>
  );
}
