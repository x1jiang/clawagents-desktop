import type { ExecMode } from "../stores/settings";

const LABELS: Record<ExecMode, string> = {
  read_only: "Read-only",
  ask: "Ask",
  auto: "Auto",
  full_access: "Full access",
};

const COLORS: Record<ExecMode, string> = {
  read_only: "bg-blue-50 text-blue-700 border-blue-200",
  ask: "bg-yellow-50 text-yellow-700 border-yellow-200",
  auto: "bg-gray-100 text-gray-700 border-gray-300",
  full_access: "bg-red-50 text-red-700 border-red-200",
};

interface Props {
  mode: ExecMode;
  onChange: (mode: ExecMode) => void;
}

export function ModeChip({ mode, onChange }: Props) {
  return (
    <select
      className={`text-xs border rounded-md px-2 py-1 outline-none ${COLORS[mode]}`}
      value={mode}
      onChange={(e) => onChange(e.target.value as ExecMode)}
    >
      {(Object.keys(LABELS) as ExecMode[]).map((m) => (
        <option key={m} value={m}>{LABELS[m]}</option>
      ))}
    </select>
  );
}
