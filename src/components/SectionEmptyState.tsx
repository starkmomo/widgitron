interface SectionEmptyStateProps {
  message: string;
  action: string;
  onAction: () => void;
}

export function SectionEmptyState({ message, action, onAction }: SectionEmptyStateProps) {
  return (
    <div className="p-10 text-center rounded-3xl border border-dashed border-[var(--dashboard-border)] bg-[var(--card-bg)]">
      <p className="text-sm text-[var(--dashboard-text)] opacity-70 mb-4">{message}</p>
      <button
        type="button"
        onClick={onAction}
        className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
      >
        {action}
      </button>
    </div>
  );
}
