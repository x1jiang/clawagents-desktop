import type { AutoApprove } from "../lib/gateway";

interface Props {
  value: AutoApprove;
  onChange: (next: AutoApprove) => void;
  caveman: boolean;
  onCavemanChange: (next: boolean) => void;
  goal: boolean;
  onGoalChange: (next: boolean) => void;
  disabled?: boolean;
}

const LABELS: Array<{ key: keyof AutoApprove; label: string }> = [
  { key: "edit", label: "Edit" },
  { key: "execute", label: "Execute" },
  { key: "web", label: "Web" },
  { key: "browser", label: "Browser" },
];

export function AutoApproveBar({
  value,
  onChange,
  caveman,
  onCavemanChange,
  goal,
  onGoalChange,
  disabled,
}: Props) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-[11px] text-gray-600 dark:text-gray-300 mb-1">
      <span className="uppercase tracking-wide text-gray-400">Auto-approve</span>
      {LABELS.map(({ key, label }) => (
        <label key={key} className="inline-flex items-center gap-1 cursor-pointer">
          <input
            type="checkbox"
            disabled={disabled}
            checked={Boolean(value[key])}
            onChange={(e) => onChange({ ...value, [key]: e.target.checked })}
          />
          {label}
        </label>
      ))}
      <span className="text-gray-300 dark:text-gray-600">|</span>
      <label className="inline-flex items-center gap-1 cursor-pointer">
        <input
          type="checkbox"
          disabled={disabled}
          checked={caveman}
          onChange={(e) => onCavemanChange(e.target.checked)}
        />
        Caveman
      </label>
      <label
        className="inline-flex items-center gap-1 cursor-pointer"
        title="Keep working until the goal is met instead of stopping at the first plausible answer. Costs more tokens."
      >
        <input
          type="checkbox"
          disabled={disabled}
          checked={goal}
          onChange={(e) => onGoalChange(e.target.checked)}
        />
        Goal
      </label>
    </div>
  );
}
