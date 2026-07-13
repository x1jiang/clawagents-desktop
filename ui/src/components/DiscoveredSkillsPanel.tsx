import { useEffect, useState } from "react";
import { useProjectGateway } from "../lib/project_client";
import { useUI } from "../stores/ui";

interface Skill {
  name: string;
  description: string;
  source_dir: string;
  path: string;
}

interface Props {
  projectId: string;
}

/**
 * Shows the skills the agent auto-loaded for this project. Skills come
 * from any `SKILL.md` under `skills/`, `.agents/skills/`, `.cursor/skills/`
 * (and a few legacy variants). Pulled fresh each mount — the directory is
 * scanned on demand, not cached server-side, so dropping a new skill in
 * the project root only takes a panel refresh to surface.
 */
export function DiscoveredSkillsPanel({ projectId }: Props) {
  const client = useProjectGateway(projectId);
  const openFile = useUI((s) => s.openFileViewer);
  const [skills, setSkills] = useState<Skill[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  async function reload() {
    if (!client) return;
    setRefreshing(true);
    setError(null);
    try {
      const out = await client.discoveredSkills(projectId);
      setSkills(out.skills);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRefreshing(false);
    }
  }

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, projectId]);

  return (
    <div className="mt-6">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200">Agent skills</h2>
        <button
          onClick={reload}
          disabled={refreshing}
          className="text-xs text-blue-600 dark:text-blue-300 hover:underline disabled:opacity-50"
        >
          {refreshing ? "Refreshing…" : "Refresh"}
        </button>
      </div>
      <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
        Loaded automatically from <code className="font-mono">.agents/skills/</code>,{" "}
        <code className="font-mono">.cursor/skills/</code>,{" "}
        <code className="font-mono">skills/</code> (and a few other names) under the project root.
        The agent picks them based on the description below — there's no opt-in checkbox.
      </p>
      {error && <p className="text-xs text-red-600 mb-2">{error}</p>}
      {skills === null && !error && (
        <p className="text-xs text-gray-400">Loading…</p>
      )}
      {skills !== null && skills.length === 0 && !error && (
        <p className="text-xs text-gray-400">
          No skills found under this project's root. Drop a <code>SKILL.md</code> into{" "}
          <code>.agents/skills/&lt;name&gt;/</code> and click Refresh.
        </p>
      )}
      {skills && skills.length > 0 && (
        <ul className="space-y-1">
          {skills.map((s) => (
            <li key={s.name}>
              <button
                type="button"
                onClick={() => openFile(projectId, s.path)}
                title={`Open ${s.path}`}
                className="w-full text-left px-2 py-1.5 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
              >
                <div className="flex items-baseline gap-2">
                  <span className="font-mono text-xs text-gray-800 dark:text-gray-100">{s.name}</span>
                  <span className="text-[10px] text-gray-400 font-mono">{s.source_dir}</span>
                </div>
                <div className="text-xs text-gray-600 dark:text-gray-400 mt-0.5 line-clamp-2">
                  {s.description || "(no description)"}
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
