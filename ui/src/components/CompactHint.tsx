import type { ChatUsage } from "../stores/chats";
import { compactHint } from "../lib/context_window";

interface Props {
  usage: ChatUsage | undefined;
  onCompact: () => void;
}

/**
 * Renders a small "Consider /compact" prompt when the latest turn used more
 * than 75% of the model's context window. Hidden when there's no usage data
 * or the model is unknown.
 */
export function CompactHint({ usage, onCompact }: Props) {
  if (!usage) return null;
  const hint = compactHint(usage.model, usage.last_input_tokens);
  if (!hint) return null;
  const pct = Math.round(hint.ratio * 100);
  return (
    <button
      onClick={onCompact}
      title={`Last turn used ${pct}% of the ${hint.window.toLocaleString()}-token context window`}
      className="text-xs px-2 py-0.5 rounded border border-yellow-300 dark:border-yellow-800 bg-yellow-50 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-200 hover:bg-yellow-100 dark:hover:bg-yellow-800"
    >
      {pct}% context · /compact?
    </button>
  );
}
