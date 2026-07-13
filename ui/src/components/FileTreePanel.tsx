import { useEffect, useRef, useState } from "react";
import { useUI } from "../stores/ui";
import { useProjectGateway } from "../lib/project_client";
import { formatErr } from "../lib/format_err";
import type { TreeNode } from "../lib/gateway";

interface Props {
  projectId: string;
  /**
   * Called with a relative path when a file is double-clicked. The chat
   * surface inserts an `@<path>` mention in the composer.
   */
  onInsertPath: (path: string) => void;
}

interface NodeProps {
  node: TreeNode;
  path: string;
  depth: number;
  onInsertPath: (path: string) => void;
  onPreview: (path: string) => void;
}

function Node({ node, path, depth, onInsertPath, onPreview }: NodeProps) {
  const [open, setOpen] = useState(depth < 1);
  const clickTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  if (node.type === "file") {
    return (
      <button
        onClick={() => {
          // Delay preview so a double-click can cancel it and insert @path instead.
          if (clickTimer.current) clearTimeout(clickTimer.current);
          clickTimer.current = setTimeout(() => {
            clickTimer.current = null;
            onPreview(path);
          }, 220);
        }}
        onDoubleClick={(e) => {
          e.preventDefault();
          if (clickTimer.current) {
            clearTimeout(clickTimer.current);
            clickTimer.current = null;
          }
          onInsertPath(path);
        }}
        draggable
        onDragStart={(e) => {
          // Mark with both text/plain (raw path) and our custom MIME so the
          // composer's drop handler can distinguish in-app from external drops.
          e.dataTransfer.setData("text/plain", path);
          e.dataTransfer.setData("application/x-clawagents-path", path);
          e.dataTransfer.effectAllowed = "copy";
        }}
        title={`Click to preview · double-click to insert @${path}`}
        className="block w-full text-left px-1 py-0.5 text-xs font-mono text-gray-700 dark:text-gray-300 hover:bg-blue-50 dark:hover:bg-blue-950 rounded truncate cursor-grab active:cursor-grabbing"
        style={{ paddingLeft: `${depth * 12 + 12}px` }}
      >
        {node.name}
      </button>
    );
  }

  // Directory
  return (
    <div>
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full text-left px-1 py-0.5 text-xs font-mono text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded truncate"
        style={{ paddingLeft: `${depth * 12}px` }}
      >
        {open ? "▾" : "▸"} {node.name}/
      </button>
      {open && node.children?.map((child, i) => (
        <Node
          key={`${path}/${child.name}|${i}`}
          node={child}
          // Skip the root's name in the relative path we report.
          path={path === "" ? child.name : `${path}/${child.name}`}
          depth={depth + 1}
          onInsertPath={onInsertPath}
          onPreview={onPreview}
        />
      ))}
    </div>
  );
}

export function FileTreePanel({ projectId, onInsertPath }: Props) {
  const client = useProjectGateway(projectId);
  const openFileViewer = useUI((s) => s.openFileViewer);
  const [tree, setTree] = useState<TreeNode | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    if (!client) return;
    try { setTree(await client.projectTree(projectId)); }
    catch (e) { setError(formatErr(e)); }
  }
  useEffect(() => { reload(); }, [client, projectId]);

  const onPreview = (path: string) => openFileViewer(projectId, path);

  return (
    <div className="h-full flex flex-col bg-white dark:bg-gray-950 border-l border-gray-200 dark:border-gray-800">
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200 dark:border-gray-800">
        <span className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Files</span>
        <button
          onClick={reload}
          title="Refresh tree"
          className="text-xs text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
        >
          ↻
        </button>
      </div>
      <div className="flex-1 overflow-y-auto py-1">
        {error && <p className="px-3 py-2 text-xs text-red-600">{error}</p>}
        {!tree && !error && <p className="px-3 py-2 text-xs text-gray-400">Loading…</p>}
        {tree && <Node node={tree} path="" depth={0} onInsertPath={onInsertPath} onPreview={onPreview} />}
      </div>
    </div>
  );
}
