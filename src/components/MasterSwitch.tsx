import { Loader2 } from "lucide-react";
import { motion } from "framer-motion";

interface MasterSwitchProps {
  enabled: boolean;
  onToggle: (val: boolean) => void;
  loading?: boolean;
  disabled?: boolean;
  label: string;
}

export function MasterSwitch({ enabled, onToggle, loading = false, disabled = false, label }: MasterSwitchProps) {
  const isDisabled = disabled || loading;

  return (
    <button
      type="button"
      onClick={() => !isDisabled && onToggle(!enabled)}
      disabled={isDisabled}
      role="switch"
      aria-label={label}
      aria-checked={enabled}
      aria-busy={loading}
      className={`w-11 h-6 rounded-full relative transition-all duration-300 flex-shrink-0 ${
        enabled ? "bg-emerald-500 shadow-[0_0_12px_rgba(16,185,129,0.3)]" : "bg-slate-700"
      } flex items-center px-1 disabled:opacity-60 disabled:cursor-not-allowed`}
    >
      {loading ? (
        <span className="absolute inset-0 flex items-center justify-center">
          <Loader2 size={12} className="text-white animate-spin" />
        </span>
      ) : (
        <motion.div
          animate={{ x: enabled ? 20 : 0 }}
          className="w-4 h-4 bg-white rounded-full shadow-lg"
        />
      )}
    </button>
  );
}
