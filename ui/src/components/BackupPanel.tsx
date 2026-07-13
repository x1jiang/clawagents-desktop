import { useRef, useState } from "react";
import { useProjects } from "../stores/projects";
import { pushToast } from "../stores/toasts";

export function BackupPanel() {
  const client = useProjects((s) => s.client);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function exportNow() {
    if (!client) return;
    setBusy(true);
    setStatus(null);
    try {
      const blob = await client.exportBackup();
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `clawagents-backup-${stamp}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setStatus("Exported.");
      pushToast("Backup exported.", "success");
    } catch (e) {
      const msg = `Export failed: ${(e as Error).message}`;
      setStatus(msg);
      pushToast(msg, "error");
    } finally {
      setBusy(false);
    }
  }

  async function importChosen(file: File) {
    if (!client) return;
    setBusy(true);
    setStatus(null);
    try {
      const result = await client.importBackup(file);
      const msg = `Restored: ${result.chats_restored} chats, ${result.projects_added} projects, ${result.commands_restored} commands.`;
      setStatus(msg);
      pushToast(msg, "success");
    } catch (e) {
      const msg = `Import failed: ${(e as Error).message}`;
      setStatus(msg);
      pushToast(msg, "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-2 mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
      <h3 className="text-sm font-medium text-gray-700 dark:text-gray-200">Backup &amp; restore</h3>
      <p className="text-xs text-gray-500 dark:text-gray-400">
        Bundles all chat history, projects metadata, and custom commands into one zip.
        Restore merges into the current state; existing chat ids are overwritten.
      </p>
      <div className="flex gap-2">
        <button
          onClick={exportNow}
          disabled={busy}
          className="px-3 py-1 text-sm border border-gray-300 dark:border-gray-700 rounded bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50"
        >
          Export backup…
        </button>
        <button
          onClick={() => fileInput.current?.click()}
          disabled={busy}
          className="px-3 py-1 text-sm border border-gray-300 dark:border-gray-700 rounded bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50"
        >
          Restore from zip…
        </button>
        <input
          ref={fileInput}
          type="file"
          accept=".zip,application/zip"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void importChosen(f);
            e.target.value = "";
          }}
        />
      </div>
      {status && <p className="text-xs text-gray-500 dark:text-gray-400">{status}</p>}
    </section>
  );
}
