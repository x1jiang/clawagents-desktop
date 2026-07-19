import { useEffect, useState } from "react";
import { useProjectGateway } from "../lib/project_client";
import { pushToast } from "../stores/toasts";
import { checkpointTs, formatCheckpointWhen } from "../lib/formatTime";

interface CheckpointRow {
  sha?: string;
  label?: string;
  tool?: string;
  message_count?: number;
  created_at?: number | string;
  [key: string]: unknown;
}

interface Props {
  chatId: string;
  projectId?: string | null;
  open: boolean;
  onClose: () => void;
}

export function CheckpointsPanel({ chatId, projectId = null, open, onClose }: Props) {
  const client = useProjectGateway(projectId);
  const [rows, setRows] = useState<CheckpointRow[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !client) return;
    setLoading(true);
    void client.listCheckpoints(chatId)
      .then((data) => setRows(Array.isArray(data) ? data as CheckpointRow[] : []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, [open, client, chatId]);

  if (!open) return null;

  async function restore(sha: string, mode: "files" | "conversation" | "both") {
    if (!client || !sha) return;
    const scope =
      mode === "files" ? "workspace files" : mode === "conversation" ? "the conversation" : "workspace files and the conversation";
    if (
      !window.confirm(
        `Restore ${scope} from checkpoint ${sha.slice(0, 12)}? This overwrites current state.`,
      )
    ) {
      return;
    }
    try {
      await client.restoreCheckpoint(chatId, sha, mode);
      pushToast(`Restored checkpoint (${mode})`, "success");
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
          <h2 className="font-medium text-gray-900 dark:text-gray-100">Checkpoints</h2>
          <button type="button" onClick={onClose} className="text-sm text-gray-500 hover:text-gray-800 dark:hover:text-gray-200">Close</button>
        </div>
        <div className="p-4 overflow-y-auto max-h-[60vh] space-y-3">
          {loading && <div className="text-sm text-gray-500">Loading…</div>}
          {!loading && rows.length === 0 && (
            <div className="text-sm text-gray-500">No checkpoints yet. They appear after the agent writes files.</div>
          )}
          {rows.map((row) => {
            const sha = String(row.sha || "");
            return (
              <div key={sha || JSON.stringify(row)} className="border border-gray-200 dark:border-gray-700 rounded-md p-3 text-sm">
                <div className="font-mono text-xs text-gray-600 dark:text-gray-300 mb-1">{sha.slice(0, 12) || "—"}</div>
                <div className="text-gray-800 dark:text-gray-100 mb-2">
                  {row.label || row.tool || "checkpoint"}
                  {row.message_count != null ? ` · ${row.message_count} msgs` : ""}
                  {(() => {
                    const label = formatCheckpointWhen(checkpointTs(row));
                    return label ? ` · ${label}` : "";
                  })()}
                </div>
                <div className="flex flex-wrap gap-2">
                  <button type="button" className="px-2 py-1 text-xs border rounded" onClick={() => void restore(sha, "files")}>Files</button>
                  <button type="button" className="px-2 py-1 text-xs border rounded" onClick={() => void restore(sha, "conversation")}>Chat</button>
                  <button type="button" className="px-2 py-1 text-xs border rounded" onClick={() => void restore(sha, "both")}>Both</button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
