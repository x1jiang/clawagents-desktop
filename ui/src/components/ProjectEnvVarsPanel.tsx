import { useEffect, useState } from "react";
import { useProjects } from "../stores/projects";

interface Props {
  projectId: string;
}

/**
 * KEY=VALUE editor. Stored as a JSON object on the project; applied to
 * `os.environ` inside the gateway for the duration of each agent invoke.
 * Useful for things like DATABASE_URL or API_BASE_URL that the agent's
 * shell tools or imported SDKs read at runtime.
 */
export function ProjectEnvVarsPanel({ projectId }: Props) {
  const client = useProjects((s) => s.client);
  const project = useProjects((s) => s.projects.find((p) => p.id === projectId));
  const refresh = useProjects((s) => s.refresh);
  const [draft, setDraft] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    setDraft(serialize(project?.env_vars ?? null));
  }, [project?.env_vars, projectId]);

  if (!project) return null;

  function parse(text: string): { ok: true; value: Record<string, string> } | { ok: false; error: string } {
    const out: Record<string, string> = {};
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i].trim();
      if (!raw || raw.startsWith("#")) continue;
      const eq = raw.indexOf("=");
      if (eq === -1) {
        return { ok: false, error: `Line ${i + 1}: expected KEY=VALUE` };
      }
      const key = raw.slice(0, eq).trim();
      const value = raw.slice(eq + 1);
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
        return { ok: false, error: `Line ${i + 1}: invalid env var name "${key}"` };
      }
      out[key] = value;
    }
    return { ok: true, value: out };
  }

  function serialize(envVars: Record<string, string> | null): string {
    if (!envVars) return "";
    return Object.entries(envVars).map(([k, v]) => `${k}=${v}`).join("\n");
  }

  const parsed = parse(draft);
  const dirty = serialize(project?.env_vars ?? null) !== draft;

  async function save() {
    if (!client || !parsed.ok) return;
    setBusy(true);
    setStatus(null);
    try {
      const next = Object.keys(parsed.value).length === 0 ? null : parsed.value;
      await client.patchProject(projectId, { env_vars: next });
      await refresh();
      setStatus("Saved.");
      setTimeout(() => setStatus(null), 1500);
    } catch (e) {
      setStatus(`Save failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-6">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200">Project environment variables</h2>
        {status && <span className="text-xs text-gray-400">{status}</span>}
      </div>
      <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
        One <span className="font-mono">KEY=VALUE</span> per line. Applied to the agent's process env each turn, then restored.
        Comments (lines starting with <span className="font-mono">#</span>) are ignored.
      </p>
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        rows={6}
        placeholder={`DATABASE_URL=postgres://localhost/myapp\nFEATURE_FLAG=on`}
        className="w-full px-2 py-1 text-sm font-mono border border-gray-300 dark:border-gray-700 rounded bg-white dark:bg-gray-900 dark:text-gray-100"
      />
      {!parsed.ok && (
        <p className="text-xs text-red-600 mt-1">{parsed.error}</p>
      )}
      <div className="mt-2 flex gap-2">
        <button
          onClick={save}
          disabled={!dirty || !parsed.ok || busy}
          className="px-3 py-1 text-sm bg-gray-900 text-white rounded hover:bg-gray-700 disabled:opacity-50 dark:bg-gray-100 dark:text-gray-900"
        >
          Save
        </button>
        {dirty && (
          <button
            onClick={() => setDraft(serialize(project?.env_vars ?? null))}
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
