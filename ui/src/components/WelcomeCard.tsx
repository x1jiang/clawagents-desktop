import { useEffect, useState } from "react";

const STORAGE_KEY = "clawagents:welcomed";

/**
 * One-time welcome panel shown on the index route until the user dismisses
 * it. Pure local state — nothing persisted server-side. The "Got it" button
 * sets a localStorage flag so it never appears again on this machine.
 */
export function WelcomeCard() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    try {
      setShow(window.localStorage.getItem(STORAGE_KEY) !== "1");
    } catch {
      setShow(true);
    }
  }, []);

  function dismiss() {
    try { window.localStorage.setItem(STORAGE_KEY, "1"); } catch { /* ignore */ }
    setShow(false);
  }

  if (!show) return null;

  return (
    <div className="w-full max-w-2xl border border-gray-200 dark:border-gray-700 bg-blue-50 dark:bg-blue-950/40 rounded-lg p-5 text-sm text-gray-700 dark:text-gray-200 mb-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-base font-semibold mb-2">Welcome to ClawAgents Desktop</h3>
          <p className="mb-3">
            A coding agent that lives on your machine. Point it at a project folder, drop
            in your model API keys, and chat with it the way you'd chat with a teammate
            who has full shell + file-system access (within the guardrails you choose).
          </p>
          <ul className="text-xs space-y-1 list-disc list-inside text-gray-600 dark:text-gray-300">
            <li><span className="font-mono">⌘ N</span> new chat · <span className="font-mono">⌘ P</span> search · <span className="font-mono">⌘ ⇧ P</span> palette · <span className="font-mono">⌘ ,</span> settings · <span className="font-mono">⌘ /</span> all shortcuts</li>
            <li><span className="font-mono">@</span> mentions a project file · <span className="font-mono">/</span> slash commands (<span className="font-mono">/help</span> lists them, including any you've authored)</li>
            <li>Drop a <span className="font-mono">CLAUDE.md</span> in the project root, or set a workspace prompt in Settings, for persistent context across chats</li>
            <li>Per-chat mode: <span className="font-mono">read_only</span> (no writes) · <span className="font-mono">ask</span> (prompt each write) · <span className="font-mono">auto</span> (auto-allow inside project root) · <span className="font-mono">full_access</span> (no prompts)</li>
            <li><span className="font-mono">/compact</span> when context fills · <span className="font-mono">/fork</span> to branch · double-click a sidebar chat to rename · click <span className="font-mono">📋</span> in the footer to manage chat templates</li>
          </ul>
        </div>
        <button
          onClick={dismiss}
          className="shrink-0 px-3 py-1 text-xs bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 rounded hover:bg-gray-700 dark:hover:bg-gray-300"
        >
          Got it
        </button>
      </div>
    </div>
  );
}
