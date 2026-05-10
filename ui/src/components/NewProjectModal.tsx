import { useState, type FormEvent } from "react";
import { tauriApi } from "../lib/tauri";
import { useProjects } from "../stores/projects";

interface Props {
  onClose: () => void;
}

export function NewProjectModal({ onClose }: Props) {
  const create = useProjects((s) => s.create);
  const [name, setName] = useState("");
  const [rootPath, setRootPath] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function pickFolder() {
    const picked = await tauriApi.pickFolder();
    if (!picked) return;
    setRootPath(picked);
    // Auto-fill name from folder basename if the user hasn't typed one yet.
    if (name.trim() === "") {
      const basename = picked.replace(/\/+$/, "").split("/").pop() ?? "";
      if (basename) setName(basename);
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await create(name.trim(), rootPath.trim());
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
      <form
        onSubmit={submit}
        className="bg-white rounded-lg shadow-xl p-5 w-96 space-y-3"
      >
        <h2 className="text-base font-semibold text-gray-800">New project</h2>

        <label className="block text-sm">
          <span className="text-gray-600">Name</span>
          <input
            className="mt-1 w-full border border-gray-300 rounded px-2 py-1 text-sm"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            autoFocus
          />
        </label>

        <label className="block text-sm">
          <span className="text-gray-600">Folder</span>
          <div className="flex gap-2 mt-1">
            <input
              className="flex-1 border border-gray-300 rounded px-2 py-1 text-sm font-mono"
              value={rootPath}
              onChange={(e) => setRootPath(e.target.value)}
              placeholder="/Users/you/code/my-project"
              required
            />
            <button
              type="button"
              onClick={pickFolder}
              className="px-2 py-1 text-sm border border-gray-300 rounded hover:bg-gray-50"
            >
              Choose…
            </button>
          </div>
        </label>

        {error && (
          <div className="text-xs text-red-600">{error}</div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1 text-sm text-gray-600 hover:text-gray-800"
            disabled={submitting}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="px-3 py-1 text-sm bg-gray-900 text-white rounded hover:bg-gray-700"
            disabled={submitting}
          >
            {submitting ? "Creating…" : "Create"}
          </button>
        </div>
      </form>
    </div>
  );
}
