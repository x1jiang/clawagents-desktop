import { useToasts } from "../stores/toasts";

const COLORS = {
  info:    "bg-gray-800 text-gray-50 dark:bg-gray-700",
  success: "bg-emerald-600 text-white",
  error:   "bg-red-600 text-white",
} as const;

/**
 * Bottom-right stack of dismissible toasts. Mounted once at the root; any
 * code calls `useToasts.getState().push("...", "success")` to emit one.
 * Toasts can carry an optional action button (e.g. "Undo") that's also
 * rendered inline.
 */
export function ToastStack() {
  const toasts = useToasts((s) => s.toasts);
  const dismiss = useToasts((s) => s.dismiss);

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 pointer-events-none">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`pointer-events-auto px-3 py-2 rounded shadow-lg text-xs flex items-start gap-2 max-w-xs ${COLORS[t.variant]}`}
        >
          <span className="flex-1 break-words">{t.message}</span>
          {t.action && (
            <button
              onClick={async () => { await t.action!.run(); dismiss(t.id); }}
              className="px-2 py-0.5 rounded bg-white/20 hover:bg-white/30 text-current"
            >
              {t.action.label}
            </button>
          )}
          <button
            onClick={() => dismiss(t.id)}
            className="text-current opacity-70 hover:opacity-100 leading-none"
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
