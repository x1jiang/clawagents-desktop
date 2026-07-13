import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useProjectGateway } from "../lib/project_client";
import { useUI } from "../stores/ui";
import type { Chat } from "../stores/chats";

interface Props {
  projectId: string;
}

interface GitSummary {
  is_repo: boolean;
  branch?: string;
  status?: string;
  diff?: string;
}

const MAX_RECENT = 5;

/**
 * Side-by-side snapshot of recent chats and current git status for a project.
 * Shown on the project landing page so the user doesn't stare at a bare
 * "pick a chat from the sidebar" prompt.
 */
export function ProjectActivityWidget({ projectId }: Props) {
  const client = useProjectGateway(projectId);
  const openFileViewer = useUI((s) => s.openFileViewer);
  const [chats, setChats] = useState<Chat[] | null>(null);
  const [git, setGit] = useState<GitSummary | null>(null);
  const [recentFiles, setRecentFiles] = useState<Array<{ path: string; mtime: number }> | null>(null);

  useEffect(() => {
    if (!client) return;
    let cancelled = false;
    (async () => {
      try {
        const list = await client.listProjectChats(projectId);
        if (!cancelled) setChats(list.slice(0, MAX_RECENT));
      } catch {
        if (!cancelled) setChats([]);
      }
      try {
        const g = await client.projectGitStatus(projectId);
        if (!cancelled) setGit(g);
      } catch {
        if (!cancelled) setGit({ is_repo: false });
      }
      try {
        const files = await client.listRecentProjectFiles(projectId);
        if (!cancelled) setRecentFiles(files.slice(0, 8));
      } catch {
        if (!cancelled) setRecentFiles([]);
      }
    })();
    return () => { cancelled = true; };
  }, [client, projectId]);

  function relativeTime(unix: number): string {
    const diff = (Date.now() / 1000) - unix;
    if (diff < 60) return "just now";
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
  }

  return (
    <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-4">
      <section>
        <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-2">Recent chats</h2>
        {chats === null && <p className="text-xs text-gray-400">Loading…</p>}
        {chats !== null && chats.length === 0 && (
          <p className="text-xs text-gray-400">No chats yet — create one from the sidebar.</p>
        )}
        <ul className="space-y-1">
          {chats?.map((c) => (
            <li key={c.id}>
              <Link
                to="/project/$id/chat/$cid"
                params={{ id: projectId, cid: c.id }}
                className="block px-2 py-1 text-xs rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-200 truncate"
                title={c.last_message_at}
              >
                {c.pinned && <span className="text-yellow-500 mr-1">★</span>}
                {c.title}
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-2">Working tree</h2>
        {git === null && <p className="text-xs text-gray-400">Loading…</p>}
        {git && !git.is_repo && (
          <p className="text-xs text-gray-400">Not a git repository.</p>
        )}
        {git && git.is_repo && (
          <>
            <p className="text-xs font-mono text-gray-600 dark:text-gray-300 mb-1">
              On {git.branch ?? "(unknown)"}
            </p>
            {git.status?.trim() ? (
              <pre className="text-[10px] font-mono whitespace-pre-wrap bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded p-2 max-h-40 overflow-auto text-gray-700 dark:text-gray-300">
                {git.status}
              </pre>
            ) : (
              <p className="text-xs text-gray-400">Clean.</p>
            )}
          </>
        )}
      </section>

      <section>
        <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-2">Recently modified</h2>
        {recentFiles === null && <p className="text-xs text-gray-400">Loading…</p>}
        {recentFiles !== null && recentFiles.length === 0 && (
          <p className="text-xs text-gray-400">No files found.</p>
        )}
        <ul className="space-y-1">
          {recentFiles?.map((f) => (
            <li key={f.path}>
              <button
                onClick={() => openFileViewer(projectId, f.path)}
                title={`Preview ${f.path}`}
                className="block w-full text-left px-2 py-1 text-xs font-mono rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-200 truncate"
              >
                <span>{f.path}</span>
                <span className="ml-2 text-gray-400 dark:text-gray-500 font-sans text-[10px]">
                  {relativeTime(f.mtime)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
