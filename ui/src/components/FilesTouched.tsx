import { useState } from "react";
import type { Message } from "../stores/chats";
import { useUI } from "../stores/ui";
import { modifiedFiles } from "../lib/touched_files";

interface Props {
  messages: Message[];
  projectId: string | null;
}

export function FilesTouched({ messages, projectId }: Props) {
  const [open, setOpen] = useState(false);
  const openFile = useUI((s) => s.openFileViewer);
  const files = modifiedFiles(messages);
  if (files.length === 0) return null;

  return (
    <div className="mb-3 inline-block">
      <button
        onClick={() => setOpen((o) => !o)}
        className="text-xs px-2 py-0.5 rounded border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800"
        title="Files modified by tools in this chat"
      >
        ✎ {files.length} file{files.length === 1 ? "" : "s"} modified {open ? "▾" : "▸"}
      </button>
      {open && (
        <div className="mt-1 max-w-md max-h-48 overflow-y-auto bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded shadow-sm">
          {files.map(({ path, count }) => (
            <button
              key={path}
              onClick={() => projectId && openFile(projectId, path)}
              disabled={!projectId}
              className="block w-full text-left px-2 py-1 text-xs font-mono truncate text-gray-700 dark:text-gray-200 hover:bg-blue-50 dark:hover:bg-blue-950/40 disabled:cursor-default disabled:hover:bg-transparent"
              title={projectId ? `Click to preview ${path}` : path}
            >
              {path}{count > 1 && <span className="ml-1 text-gray-400">×{count}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
