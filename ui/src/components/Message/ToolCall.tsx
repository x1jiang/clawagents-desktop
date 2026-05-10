import { useState } from "react";
import clsx from "clsx";

const READ_ONLY_TOOLS = new Set(["read_file", "list_dir", "stat", "glob", "search_files"]);

interface Props {
  name: string;
  args: unknown;
  running: boolean;
  success?: boolean;
  result?: string;
}

export function ToolCall({ name, args, running, success, result }: Props) {
  const isReadOnly = READ_ONLY_TOOLS.has(name);
  const [open, setOpen] = useState(!isReadOnly);

  const status = running ? (
    <span aria-label="running" className="text-blue-600">⟳</span>
  ) : success === true ? (
    <span className="text-green-600">✓</span>
  ) : success === false ? (
    <span className="text-red-600">✗</span>
  ) : null;

  const argSummary = typeof args === "object" && args !== null
    ? Object.entries(args as Record<string, unknown>).slice(0, 2).map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`).join(" ")
    : String(args);

  return (
    <div className="mb-2 border border-gray-200 rounded-md bg-white overflow-hidden">
      <button
        className="w-full text-left px-3 py-1.5 text-xs flex items-center justify-between hover:bg-gray-50"
        onClick={() => setOpen((o) => !o)}
      >
        <span className="truncate">
          {open ? "▾" : "▸"} <strong className="text-gray-800">{name}</strong>{" "}
          <span className="text-gray-500 font-mono">{argSummary}</span>
        </span>
        <span className="ml-2">{status}</span>
      </button>
      {open && (
        <div className="px-3 py-2 bg-gray-50 border-t border-gray-200">
          <pre className={clsx("text-xs font-mono whitespace-pre-wrap break-words", !result && "text-gray-400")}>
            {result ?? "(no output yet)"}
          </pre>
        </div>
      )}
    </div>
  );
}
