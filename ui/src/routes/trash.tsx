import { useEffect, useState } from "react";
import { createRoute, useRouter } from "@tanstack/react-router";
import { Route as RootRoute } from "./__root";
import { useProjects } from "../stores/projects";
import { useChats } from "../stores/chats";
import { pushToast } from "../stores/toasts";

interface TrashedItem {
  chat_id: string;
  project_id: string | null;
  trashed_at: number;
  filename: string;
}

export const Route = createRoute({
  getParentRoute: () => RootRoute,
  path: "/trash",
  component: function Trash() {
    const client = useProjects((s) => s.client);
    const projects = useProjects((s) => s.projects);
    const setChatList = useChats((s) => s.setChatList);
    const router = useRouter();
    const [items, setItems] = useState<TrashedItem[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

    async function reload() {
      if (!client) return;
      try { setItems(await client.listTrashedChats()); }
      catch (e) { setError((e as Error).message); }
    }
    useEffect(() => { reload(); }, [client]);

    async function restoreOne(item: TrashedItem) {
      if (!client) return;
      setBusy(true);
      try {
        await client.restoreChat(item.chat_id);
        // Refresh the relevant chat list so the chat reappears.
        if (item.project_id) {
          setChatList(item.project_id, await client.listProjectChats(item.project_id));
          router.navigate({ to: "/project/$id/chat/$cid", params: { id: item.project_id, cid: item.chat_id } });
        } else {
          setChatList(null, await client.listProjectlessChats());
          router.navigate({ to: "/chat/$cid", params: { cid: item.chat_id } });
        }
        pushToast(`Restored ${item.chat_id}.`, "success");
      } catch (e) {
        pushToast(`Restore failed: ${(e as Error).message}`, "error");
        await reload();
      } finally {
        setBusy(false);
      }
    }

    function projectName(projectId: string | null): string {
      if (!projectId) return "Projectless";
      return projects.find((p) => p.id === projectId)?.name ?? "(unknown project)";
    }

    return (
      <div className="p-6 max-w-3xl">
        <div className="flex items-center justify-between mb-2">
          <h1 className="text-lg font-semibold text-gray-800 dark:text-gray-100">Trash</h1>
          {items && items.length > 0 && (
            <button
              onClick={async () => {
                if (!client) return;
                if (!window.confirm(`Permanently delete ${items.length} trashed chat${items.length === 1 ? "" : "s"}? This cannot be undone.`)) return;
                setBusy(true);
                try {
                  await client.emptyTrash();
                  await reload();
                  pushToast("Trash emptied.", "success");
                } catch (e) {
                  pushToast(`Empty failed: ${(e as Error).message}`, "error");
                } finally {
                  setBusy(false);
                }
              }}
              disabled={busy}
              className="px-2 py-1 text-xs border border-red-300 dark:border-red-800 text-red-700 dark:text-red-200 bg-white dark:bg-red-950/40 rounded hover:bg-red-50 dark:hover:bg-red-900/40 disabled:opacity-50"
            >
              Empty trash
            </button>
          )}
        </div>
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
          Deleted chats stay here for 30 days before being purged. Restore any of them back to the live list.
        </p>
        {error && <p className="text-xs text-red-600 mb-2">{error}</p>}
        {items === null && <p className="text-xs text-gray-400">Loading…</p>}
        {items !== null && items.length === 0 && (
          <p className="text-xs text-gray-400">Trash is empty.</p>
        )}
        {items && items.length > 0 && (
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
                <th className="px-2 py-1 font-normal">Chat id</th>
                <th className="px-2 py-1 font-normal">Project</th>
                <th className="px-2 py-1 font-normal">Trashed</th>
                <th className="px-2 py-1 font-normal text-right"></th>
              </tr>
            </thead>
            <tbody className="text-gray-700 dark:text-gray-200">
              {items.map((it) => (
                <tr key={it.filename} className="border-b border-gray-100 dark:border-gray-800">
                  <td className="px-2 py-1 font-mono truncate max-w-[18ch]">{it.chat_id}</td>
                  <td className="px-2 py-1">{projectName(it.project_id)}</td>
                  <td className="px-2 py-1">{new Date(it.trashed_at * 1000).toLocaleString()}</td>
                  <td className="px-2 py-1 text-right">
                    <button
                      disabled={busy}
                      onClick={() => void restoreOne(it)}
                      className="px-2 py-0.5 text-xs border border-gray-300 dark:border-gray-700 rounded hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50"
                    >
                      Restore
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    );
  },
});
