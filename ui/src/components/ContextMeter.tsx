import type { ChatUsage } from "../stores/chats";
import { contextUsage } from "../lib/context_window";

interface Props {
  usage: ChatUsage | undefined;
}

/**
 * Tiny live bar showing how much of the model's context window the last turn
 * consumed. The bar's colour ramps green → amber → red so you don't need to
 * read the percentage to know it's getting tight.
 *
 * Hidden entirely when there's no usage yet or the model isn't in the
 * context-window catalog — the existing CompactHint button still appears at
 * >75% as a discrete affordance.
 */
export function ContextMeter({ usage }: Props) {
  if (!usage) return null;
  const u = contextUsage(usage.model, usage.last_input_tokens);
  if (u === null) return null;

  const pct = Math.round(u.ratio * 100);
  // green under 50%, amber 50–80%, red over 80%
  const colour =
    u.ratio < 0.5
      ? "bg-emerald-500 dark:bg-emerald-400"
      : u.ratio < 0.8
        ? "bg-amber-500 dark:bg-amber-400"
        : "bg-red-500 dark:bg-red-400";

  return (
    <div
      title={`Last turn: ${usage.last_input_tokens.toLocaleString()} / ${u.window.toLocaleString()} tokens (${pct}%)`}
      className="flex items-center gap-1.5 text-[10px] text-gray-500 dark:text-gray-400 select-none"
    >
      <div className="w-16 h-1.5 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
        <div
          className={`h-full ${colour} transition-[width] duration-300`}
          style={{ width: `${Math.max(2, pct)}%` }}
        />
      </div>
      <span className="font-mono">{pct}%</span>
    </div>
  );
}
