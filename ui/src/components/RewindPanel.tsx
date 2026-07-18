import { useEffect, useState } from "react";
import { useProjectGateway } from "../lib/project_client";
import { pushToast } from "../stores/toasts";

interface Props {
  chatId: string;
  projectId?: string | null;
  open: boolean;
  onClose: () => void;
  onRestored?: () => void;
}

interface RewindSnap {
  prompt_index?: number;
  user_text?: string;
  message_count?: number;
  created_at?: number | string;
  [key: string]: unknown;
}

export function RewindPanel({ chatId, projectId = null, open, onClose, onRestored }: Props) {
  const client = useProjectGateway(projectId);
  const [rows, setRows] = useState<RewindSnap[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !client) return;
    setLoading(true);
    void client
      .listRewind({ projectId, chatId })
      .then((data) => setRows(Array.isArray(data.snapshots) ? (data.snapshots as RewindSnap[]) : []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, [open, client, chatId, projectId]);

  if (!open) return null;

  async function restore(promptIndex: number) {
    if (!client) return;
    if (!window.confirm(`Rewind workspace files to prompt #${promptIndex}?`)) return;
    try {
      const result = await client.rewindTo({
        prompt_index: promptIndex,
        project_id: projectId,
        chat_id: chatId,
      });
      if (result.ok === false) {
        pushToast(String(result.error || "Rewind failed"), "error");
        return;
      }
      pushToast(`Rewound to prompt #${promptIndex}`, "success");
      onRestored?.();
      onClose();
    } catch (e) {
      pushToast((e as Error).message, "error");
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="bg-white dark:bg-gray-900 rounded-lg shadow-xl w-full max-w-lg max-h-[80vh] overflow-hidden border border-gray-200 dark:border-gray-700"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700">
          <h2 className="font-medium text-gray-900 dark:text-gray-100">Session rewind</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-sm text-gray-500 hover:text-gray-800 dark:hover:text-gray-200"
          >
            Close
          </button>
        </div>
        <div className="p-4 overflow-y-auto max-h-[60vh] space-y-3">
          {loading && <div className="text-sm text-gray-500">Loading…</div>}
          {!loading && rows.length === 0 && (
            <div className="text-sm text-gray-500">
              No rewind snapshots yet — send a prompt that writes files to create one.
            </div>
          )}
          {[...rows].reverse().slice(0, 40).map((row) => {
            const idx = Number(row.prompt_index ?? -1);
            const preview = String(row.user_text || "").slice(0, 120);
            return (
              <div
                key={`${idx}-${preview}`}
                className="border border-gray-200 dark:border-gray-700 rounded-md p-3 text-sm"
              >
                <div className="font-mono text-xs text-gray-600 dark:text-gray-300 mb-1">
                  prompt #{idx >= 0 ? idx : "?"}
                  {row.message_count != null ? ` · ${row.message_count} msgs` : ""}
                </div>
                <div className="text-gray-800 dark:text-gray-100 mb-2">
                  {preview || "(no preview)"}
                  {preview.length >= 120 ? "…" : ""}
                </div>
                <button
                  type="button"
                  className="px-2 py-1 text-xs border rounded"
                  disabled={idx < 0}
                  onClick={() => void restore(idx)}
                >
                  Rewind here
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
