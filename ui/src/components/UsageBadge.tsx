import type { ChatUsage } from "../stores/chats";
import { estimateCostUsd, formatCostUsd } from "../lib/pricing";

interface Props {
  /** Cumulative chat usage (session). */
  usage: ChatUsage | undefined;
  /** Current / last turn usage (run). */
  runUsage?: ChatUsage | undefined;
  /** Prefer this model id for pricing when usage.model is missing. */
  modelOverride?: string;
}

function formatTokens(n: number): string {
  if (n < 1000) return n.toString();
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

function costFor(usage: ChatUsage | undefined, modelOverride?: string): number | null {
  if (!usage || usage.total_tokens === 0) return null;
  return estimateCostUsd(modelOverride || usage.model, {
    input_tokens: usage.input_tokens,
    output_tokens: usage.output_tokens,
    cached_input_tokens: usage.cached_input_tokens,
  });
}

/**
 * VS Code–style run + session cost chips.
 * Always reserves space once a model is known so the header matches the
 * extension layout even before the first usage event arrives.
 */
export function UsageBadge({ usage, runUsage, modelOverride }: Props) {
  const model = modelOverride || usage?.model;
  const sessionCost = costFor(usage, model);
  const runCost = costFor(runUsage, model);
  const showSession = Boolean(usage && usage.total_tokens > 0);
  const showRun = Boolean(runUsage && runUsage.total_tokens > 0);

  // Keep a stable header footprint once the user has picked a model, matching
  // VS Code's always-visible cost meta (values fill in after the first turn).
  if (!showSession && !showRun && !model) return null;

  const tooltipLines: string[] = [];
  if (showRun && runUsage) {
    tooltipLines.push(
      `Run: ${formatTokens(runUsage.input_tokens)} in / ${formatTokens(runUsage.output_tokens)} out` +
        (runCost != null ? ` · ${formatCostUsd(runCost)}` : ""),
    );
  }
  if (showSession && usage) {
    tooltipLines.push(
      `Session: ${formatTokens(usage.input_tokens)} in / ${formatTokens(usage.output_tokens)} out` +
        (sessionCost != null ? ` · ${formatCostUsd(sessionCost)}` : ""),
    );
  }
  if (model) tooltipLines.push(`Model: ${model}`);
  if (!showSession && !showRun) {
    tooltipLines.push("Cost appears after the first successful model reply.");
  }

  return (
    <span
      className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-300 shrink-0"
      title={tooltipLines.join("\n")}
    >
      <span className="px-2 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200 dark:bg-blue-950/40 dark:text-blue-200 dark:border-blue-800">
        {showRun && runUsage
          ? `${formatTokens(runUsage.total_tokens)} tok · run ~${runCost != null ? formatCostUsd(runCost) : "—"}`
          : "run ~—"}
      </span>
      <span className="px-2 py-0.5 rounded bg-gray-100 text-gray-600 border border-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700">
        {showSession && usage
          ? `${formatTokens(usage.total_tokens)} tok · session ~${sessionCost != null ? formatCostUsd(sessionCost) : "—"}`
          : "session ~—"}
      </span>
    </span>
  );
}
