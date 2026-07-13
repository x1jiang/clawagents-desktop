import { useEffect, useState } from "react";
import { useProjects } from "../stores/projects";

interface Props {
  projectId: string;
}

/**
 * Per-project default mode/model. When a new chat is created in this project,
 * these override the workspace-level defaults. Either or both may be left
 * blank to fall back to the workspace setting.
 */
export function ProjectDefaultsPanel({ projectId }: Props) {
  const client = useProjects((s) => s.client);
  const project = useProjects((s) => s.projects.find((p) => p.id === projectId));
  const refresh = useProjects((s) => s.refresh);
  const [mode, setMode] = useState<string>("");
  const [model, setModel] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [availableModels, setAvailableModels] = useState<string[]>([]);

  useEffect(() => {
    setMode(project?.default_mode ?? "");
    setModel(project?.default_model ?? "");
  }, [project?.default_mode, project?.default_model, projectId]);

  useEffect(() => {
    if (!client) return;
    void client.listProviders()
      .then((providers) => setAvailableModels(
        providers.flatMap((p) => p.models.filter((m) => m.available).map((m) => m.id)),
      ))
      .catch(() => setAvailableModels([]));
  }, [client]);

  if (!project) return null;

  const dirty =
    mode !== (project.default_mode ?? "") ||
    model !== (project.default_model ?? "");

  async function save() {
    if (!client) return;
    setBusy(true);
    setStatus(null);
    try {
      await client.patchProject(projectId, {
        default_mode: mode || undefined,
        default_model: model || undefined,
      });
      await refresh();
      setStatus("Saved.");
      setTimeout(() => setStatus(null), 1500);
    } catch (e) {
      setStatus(`Save failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setMode(project?.default_mode ?? "");
    setModel(project?.default_model ?? "");
  }

  return (
    <div className="mt-6">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200">Project defaults</h2>
        {status && <span className="text-xs text-gray-400">{status}</span>}
      </div>
      <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
        Override workspace defaults for chats created inside this project. Leave blank to inherit.
      </p>
      <div className="grid grid-cols-2 gap-3">
        <label className="block text-xs">
          <span className="text-gray-600 dark:text-gray-400">Default mode</span>
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value)}
            className="mt-1 w-full px-2 py-1 text-sm border border-gray-300 dark:border-gray-700 rounded bg-white dark:bg-gray-800 dark:text-gray-100"
          >
            <option value="">(inherit)</option>
            <option value="read_only">Read-only</option>
            <option value="ask">Ask</option>
            <option value="auto">Auto</option>
            <option value="full_access">Full access</option>
          </select>
        </label>
        <label className="block text-xs">
          <span className="text-gray-600 dark:text-gray-400">Default model</span>
          <select
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className="mt-1 w-full px-2 py-1 text-sm border border-gray-300 dark:border-gray-700 rounded bg-white dark:bg-gray-800 dark:text-gray-100"
          >
            <option value="">(inherit)</option>
            {availableModels.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </label>
      </div>
      <div className="mt-2 flex gap-2">
        <button
          onClick={save}
          disabled={!dirty || busy}
          className="px-3 py-1 text-sm bg-gray-900 text-white rounded hover:bg-gray-700 disabled:opacity-50 dark:bg-gray-100 dark:text-gray-900"
        >
          Save
        </button>
        {dirty && (
          <button
            onClick={reset}
            disabled={busy}
            className="px-3 py-1 text-sm text-gray-500 hover:text-gray-800 dark:text-gray-300"
          >
            Reset
          </button>
        )}
      </div>
    </div>
  );
}
