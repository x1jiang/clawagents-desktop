import { useTheme } from "../stores/theme";

// Cycle: light → dark → system → light. The system slot lets the OS drive
// theme (e.g. night-shift auto-flip).
const NEXT_LABEL = { light: "dark", dark: "system", system: "light" } as const;
const GLYPH = { light: "☾", dark: "⌬", system: "☀︎" } as const;

export function ThemeToggle() {
  const mode = useTheme((s) => s.mode);
  const toggle = useTheme((s) => s.toggle);

  return (
    <button
      onClick={toggle}
      title={`Theme: ${mode} (click for ${NEXT_LABEL[mode]})`}
      className="px-2 py-1 text-sm text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-100"
    >
      {GLYPH[mode]}
    </button>
  );
}
