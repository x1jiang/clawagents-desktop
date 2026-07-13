import type { ChatUsage } from "../stores/chats";
import { contextUsage } from "../lib/context_window";

interface Props {
  usage: ChatUsage | undefined;
  modelOverride?: string;
  compacting?: boolean;
  onCompact: () => void;
}

/**
 * Always-visible Compact chip with an embedded context-window meter —
 * matches the VS Code extension header affordance.
 *
 * Shows `—%` until the first usage event arrives so the control is
 * discoverable even on a fresh chat.
 */
export function CompactChip({ usage, modelOverride, compacting, onCompact }: Props) {
  const model = modelOverride || usage?.model;
  const u =
    usage && usage.last_input_tokens > 0
      ? contextUsage(model, usage.last_input_tokens)
      : null;
  const pct = u ? Math.round(u.ratio * 100) : null;
  const colour =
    u == null
      ? "bg-gray-400"
      : u.ratio < 0.5
        ? "bg-emerald-500 dark:bg-emerald-400"
        : u.ratio < 0.8
          ? "bg-amber-500 dark:bg-amber-400"
          : "bg-red-500 dark:bg-red-400";

  const title =
    compacting
      ? "Compacting…"
      : u && pct != null
        ? `Context ~${pct}% (${usage!.last_input_tokens.toLocaleString()} / ${u.window.toLocaleString()} tokens). Click to compact.`
        : "Context % appears after the first model reply. Click to compact (/compact).";

  return (
    <button
      type="button"
      onClick={onCompact}
      disabled={compacting}
      title={title}
      className={
        "flex items-center gap-1.5 text-xs px-2 py-1 border rounded shrink-0 " +
        (compacting
          ? "border-blue-300 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-200"
          : "border-gray-300 bg-white text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800")
      }
    >
      {compacting ? "Compacting…" : "Compact"}
      {!compacting && (
        <span className="flex items-center gap-1 text-[10px] text-gray-500 dark:text-gray-400 font-mono">
          <span className="inline-block w-10 h-1.5 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
            <span
              className={`block h-full ${colour} transition-[width] duration-300`}
              style={{ width: `${Math.max(2, pct ?? 0)}%` }}
            />
          </span>
          {pct != null ? `${pct}%` : "—%"}
        </span>
      )}
    </button>
  );
}
