import { useEffect, useState } from "react";
import { useProjects } from "../stores/projects";

interface Props {
  projectId: string;
}

/**
 * Inline editor for the project-level system prompt. The value is sent as an
 * `<project_system_prompt>` block prepended to the first user message of each
 * chat in this project, so it acts like a per-project persona / persistent
 * instruction set.
 */
export function ProjectSystemPromptPanel({ projectId }: Props) {
  const client = useProjects((s) => s.client);
  const project = useProjects((s) => s.projects.find((p) => p.id === projectId));
  const refresh = useProjects((s) => s.refresh);
  const [draft, setDraft] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    setDraft(project?.system_prompt ?? "");
  }, [project?.system_prompt, projectId]);

  if (!project) return null;

  const dirty = draft !== (project.system_prompt ?? "");

  async function save() {
    if (!client) return;
    setBusy(true);
    setStatus(null);
    try {
      // Empty string clears the field (we send null to the API).
      await client.patchProject(projectId, { system_prompt: draft.trim() || null });
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
    setDraft(project?.system_prompt ?? "");
  }

  return (
    <div className="mt-6">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200">Project system prompt</h2>
        {status && <span className="text-xs text-gray-400">{status}</span>}
      </div>
      <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
        Prepended to the first user message of every chat in this project. Stays in conversation history
        after that — no per-turn token cost.
        A {" "}<code className="font-mono">CLAUDE.md</code> in the project root is appended after this.
      </p>
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        rows={6}
        placeholder="You are working in a Rust monorepo. Prefer ?-propagation over panics. Use serde for serialization."
        className="w-full px-2 py-1 text-sm font-mono border border-gray-300 dark:border-gray-700 rounded bg-white dark:bg-gray-900 dark:text-gray-100"
      />
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
