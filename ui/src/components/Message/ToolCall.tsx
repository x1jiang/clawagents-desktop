import { memo, useEffect, useState } from "react";
import clsx from "clsx";
import { ToolResultPreview } from "./ToolResultPreview";
import { equalIgnoringFunctionProps } from "../../lib/memo_ignoring_callbacks";

const READ_ONLY_TOOLS = new Set(["read_file", "list_dir", "stat", "glob", "search_files"]);

/**
 * Glyph per tool name so a glance at the chat surface tells you what kind of
 * work happened. Read-only inspection, mutation, shell execution, and web
 * fetches each get a distinct mark; unknown tools fall back to a wrench.
 */
function iconFor(name: string): string {
  if (READ_ONLY_TOOLS.has(name)) return "👁";
  if (/^(edit|write|patch|apply_patch|append|delete)/.test(name)) return "✎";
  if (/^(run|shell|bash|exec|task_create|background)/.test(name)) return "⚙";
  if (/^(fetch|http|browse|web_)/.test(name)) return "🌐";
  if (/^(git|svn)/.test(name)) return "⎇";
  return "🔧";
}

interface Props {
  name: string;
  args: unknown;
  running: boolean;
  success?: boolean;
  result?: string;
  startedAt?: number;
  elapsedMs?: number;
  pinned?: boolean;
  onPinToggle?: () => void;
  /** Propagated to ToolResultPreview so list_dir entries can link to the
   *  file viewer. Null = projectless chat → no links. */
  projectId?: string | null;
}

function formatElapsed(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  return `${m}m${Math.round(s - m * 60)}s`;
}

function ToolCallImpl({ name, args, running, success, result, startedAt, elapsedMs, pinned, onPinToggle, projectId = null }: Props) {
  const isReadOnly = READ_ONLY_TOOLS.has(name);
  const [open, setOpen] = useState(running || !isReadOnly);

  // While the tool is running, tick once per second so the elapsed time
  // updates live. Cheap re-render; one cell on screen.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!running || !startedAt) return;
    setOpen(true);
    const id = setInterval(() => setTick((n) => n + 1), 500);
    return () => clearInterval(id);
  }, [running, startedAt]);

  const liveElapsed =
    elapsedMs ??
    (startedAt ? Date.now() - startedAt : undefined);

  const status = running ? (
    <span aria-label="running" className="rounded-full bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-700 dark:bg-blue-900/40 dark:text-blue-200">Running</span>
  ) : success === true ? (
    <span className="rounded-full bg-green-50 px-1.5 py-0.5 text-[10px] font-medium text-green-700 dark:bg-green-900/40 dark:text-green-200">Done</span>
  ) : success === false ? (
    <span className="rounded-full bg-red-50 px-1.5 py-0.5 text-[10px] font-medium text-red-700 dark:bg-red-900/40 dark:text-red-200">Failed</span>
  ) : null;

  const argSummary = typeof args === "object" && args !== null
    ? Object.entries(args as Record<string, unknown>).slice(0, 2).map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`).join(" ")
    : String(args);

  return (
    <div className="my-2 overflow-hidden rounded-md border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-900">
      <button
        className="w-full text-left px-3 py-2 text-xs flex items-center justify-between gap-3 hover:bg-gray-50 dark:hover:bg-gray-800"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <span className="min-w-0 truncate">
          {open ? "▾" : "▸"} <span className="mr-0.5" aria-hidden>{iconFor(name)}</span>
          <strong className="text-gray-800 dark:text-gray-100">{name}</strong>{" "}
          <span className="text-gray-500 dark:text-gray-400 font-mono">{argSummary}</span>
        </span>
        <span className="ml-2 flex shrink-0 items-center gap-2">
          {liveElapsed !== undefined && (
            <span className="text-gray-400 dark:text-gray-500 font-mono text-[10px]">
              {formatElapsed(liveElapsed)}
            </span>
          )}
          <span className="text-[10px] text-gray-400 dark:text-gray-500">
            {open ? "Hide" : "Show"}
          </span>
          {!!result && onPinToggle && (
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => { e.stopPropagation(); onPinToggle(); }}
              onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); onPinToggle(); } }}
              title={pinned ? "Unpin from this chat" : "Pin so this stays visible while scrolling"}
              className={"text-xs " + (pinned ? "text-yellow-500" : "text-gray-300 hover:text-yellow-500")}
            >
              📌
            </span>
          )}
          {status}
        </span>
      </button>
      {open && (
        <div className="px-3 py-2 bg-gray-50 dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700">
          {result ? (
            <ToolResultPreview name={name} args={args} result={result} projectId={projectId} />
          ) : (
            <>
              <pre className={clsx("text-xs font-mono whitespace-pre-wrap break-words text-gray-400 dark:text-gray-500")}>
                {running ? "(running — no output yet)" : "(no output)"}
              </pre>
              {running && liveElapsed !== undefined && liveElapsed >= 30_000 && (
                <p className="mt-1 text-[10px] text-amber-700 dark:text-amber-300">
                  Taking a while ({formatElapsed(liveElapsed)}) — common when a tool installs deps (e.g. <code className="font-mono">pip install</code>) or runs a build on first use. Press <kbd className="font-mono px-1 py-0.5 border border-amber-300 dark:border-amber-800 rounded">Esc</kbd> in the chat to cancel.
                </p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// See lib/memo_ignoring_callbacks. The component's own internal tick timer
// (setInterval above) still re-renders itself normally — memo only gates
// re-renders triggered by the parent, not a component's own state updates.
export const ToolCall = memo(ToolCallImpl, equalIgnoringFunctionProps);
