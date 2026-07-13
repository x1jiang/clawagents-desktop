import { useEffect, useState } from "react";
import { useRouter } from "@tanstack/react-router";
import { useProjects } from "../stores/projects";
import { useChats } from "../stores/chats";
import { saveDraft } from "../lib/drafts";

interface Template {
  name: string;
  description: string;
  body: string;
}

interface Props {
  /** Project to create the new chat in. null = projectless. */
  projectId: string | null;
  onClose: () => void;
}

/**
 * Lightweight picker shown when the user clicks "From template…".
 * Selecting a template:
 *   1. Creates a new chat (project-scoped or projectless),
 *   2. Pre-fills the composer draft with the template body,
 *   3. Navigates to the new chat.
 * The user can edit before sending.
 */
export function TemplatePicker({ projectId, onClose }: Props) {
  const client = useProjects((s) => s.client);
  const setChatList = useChats((s) => s.setChatList);
  const router = useRouter();
  const [templates, setTemplates] = useState<Template[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!client) return;
    (async () => {
      try { setTemplates(await client.listChatTemplates()); }
      catch (e) { setError((e as Error).message); }
    })();
  }, [client]);

  async function spawn(t: Template) {
    if (!client) return;
    setBusy(true);
    try {
      const created = projectId
        ? await client.createProjectChat(projectId, { title: t.name })
        : await client.createProjectlessChat({ title: t.name });
      saveDraft(created.chat_id, t.body);
      if (projectId) {
        setChatList(projectId, await client.listProjectChats(projectId));
        router.navigate({ to: "/project/$id/chat/$cid", params: { id: projectId, cid: created.chat_id } });
      } else {
        setChatList(null, await client.listProjectlessChats());
        router.navigate({ to: "/chat/$cid", params: { cid: created.chat_id } });
      }
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-start justify-center z-50 pt-24" onClick={onClose}>
      <div
        className="bg-white dark:bg-gray-900 rounded-lg shadow-lg w-[32rem] max-h-[70vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-2 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-100">Start chat from template</h2>
          <div className="flex items-center gap-3">
            <button
              onClick={() => { router.navigate({ to: "/templates" } as any); onClose(); }}
              className="text-xs text-blue-600 dark:text-blue-300 hover:underline"
            >
              Edit templates ↗
            </button>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 text-xl leading-none">×</button>
          </div>
        </div>
        <div className="overflow-y-auto flex-1">
          {error && <p className="px-4 py-3 text-xs text-red-600">{error}</p>}
          {templates === null && !error && <p className="px-4 py-6 text-xs text-gray-400">Loading…</p>}
          {templates && templates.length === 0 && (
            <p className="px-4 py-6 text-xs text-gray-400">
              No templates yet. Use the "Edit templates" link above to create your first one.
            </p>
          )}
          {templates?.map((t) => (
            <button
              key={t.name}
              disabled={busy}
              onClick={() => void spawn(t)}
              className="block w-full text-left px-4 py-2 text-xs border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50"
            >
              <div className="font-mono text-gray-800 dark:text-gray-100">{t.name}</div>
              <div className="text-gray-500 dark:text-gray-400 truncate">{t.description}</div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
