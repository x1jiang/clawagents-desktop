import { useEffect } from "react";
import { useUI } from "../stores/ui";

const SHORTCUTS: Array<{ keys: string[]; description: string }> = [
  { keys: ["⌘", "N"], description: "New chat" },
  { keys: ["⌘", "P"], description: "Search all chats" },
  { keys: ["⌘", "⇧", "P"], description: "Command palette" },
  { keys: ["⌘", "\\"], description: "Toggle sidebar" },
  { keys: ["⌘", ","], description: "Open Settings" },
  { keys: ["⌘", "K"], description: "Focus composer" },
  { keys: ["↵"], description: "Send message from composer" },
  { keys: ["⇧", "↵"], description: "Insert newline in composer" },
  { keys: ["⌘", "F"], description: "Find in this chat" },
  { keys: ["⌘", "`"], description: "Jump to previously viewed chat" },
  { keys: ["⌘", "⇧", "`"], description: "Jump 2 chats back in history" },
  { keys: ["J"], description: "Next chat in sidebar" },
  { keys: ["K"], description: "Previous chat in sidebar" },
  { keys: ["⌘", "1–9"], description: "Jump to Nth chat in sidebar" },
  { keys: ["⌘", "/"], description: "Show keyboard shortcuts" },
  { keys: ["↑", "↓"], description: "Recall previous prompts in empty composer" },
  { keys: ["@"], description: "Mention a project file in composer" },
  { keys: ["/"], description: "Slash command autocomplete in composer" },
  { keys: ["Esc"], description: "Cancel streaming / close modal" },
];

export function ShortcutsModal() {
  const open = useUI((s) => s.shortcutsModalOpen);
  const close = useUI((s) => s.closeShortcutsModal);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent): void {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 bg-black/40 flex items-center justify-center z-50"
      onClick={close}
    >
      <div
        className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg w-96 p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-semibold text-gray-800 dark:text-gray-100">Keyboard shortcuts</h2>
          <button
            className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 text-xl leading-none"
            onClick={close}
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <ul className="space-y-2">
          {SHORTCUTS.map((s) => (
            <li key={s.description} className="flex items-center justify-between text-sm text-gray-700 dark:text-gray-200">
              <span>{s.description}</span>
              <span className="flex gap-1">
                {s.keys.map((k) => (
                  <kbd
                    key={k}
                    className="px-1.5 py-0.5 text-xs font-mono border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-800 dark:text-gray-200 rounded shadow-sm"
                  >
                    {k}
                  </kbd>
                ))}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
