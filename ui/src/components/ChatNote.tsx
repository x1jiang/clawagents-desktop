import { useEffect, useState } from "react";
import { useProjectGateway } from "../lib/project_client";
import { pushToast } from "../stores/toasts";
import { Markdown } from "../lib/markdown";

interface Props {
  chatId: string;
  initialNote: string;
  /** Project id, if any — enables @-mention links inside the rendered note. */
  projectId?: string | null;
}

/**
 * Sticky note at the top of a chat. Free-form text the user wants to keep
 * visible across turns — context, TODOs, scratch. Persisted as part of
 * `chat_meta`. Collapsed by default when empty; expands inline when set.
 */
export function ChatNote({ chatId, initialNote, projectId = null }: Props) {
  const client = useProjectGateway(projectId);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(initialNote);
  const [saved, setSaved] = useState(initialNote);

  useEffect(() => {
    setDraft(initialNote);
    setSaved(initialNote);
  }, [initialNote, chatId]);

  async function save() {
    if (!client) return;
    try {
      await client.patchChat(chatId, { note: draft });
      setSaved(draft);
      setEditing(false);
      pushToast("Note saved.", "success");
    } catch (e) {
      pushToast(`Save failed: ${(e as Error).message}`, "error");
    }
  }

  if (!editing && !saved) {
    return (
      <button
        onClick={() => setEditing(true)}
        className="block text-[10px] text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 mb-2"
      >
        + add a note for this chat
      </button>
    );
  }

  if (editing) {
    return (
      <div className="mb-3 border border-yellow-300 dark:border-yellow-800 bg-yellow-50 dark:bg-yellow-900/30 rounded p-2">
        <textarea
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={3}
          placeholder="Sticky note for this chat — context, TODOs, scratch…"
          className="w-full text-xs bg-transparent dark:text-gray-100 outline-none resize-y"
          onKeyDown={(e) => {
            if (e.key === "Escape") { e.preventDefault(); setDraft(saved); setEditing(false); }
            else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void save(); }
          }}
        />
        <div className="flex justify-end gap-2 text-xs mt-1">
          <button onClick={() => { setDraft(saved); setEditing(false); }} className="text-gray-500 hover:text-gray-800 dark:text-gray-300">
            Cancel
          </button>
          <button onClick={save} className="px-2 py-0.5 bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 rounded">
            Save
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      onClick={() => setEditing(true)}
      className="mb-3 border border-yellow-300 dark:border-yellow-800 bg-yellow-50 dark:bg-yellow-900/30 rounded p-2 text-xs text-gray-800 dark:text-gray-200 cursor-text"
      title="Click to edit"
    >
      <Markdown projectId={projectId}>{saved}</Markdown>
    </div>
  );
}
