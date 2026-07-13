import { useEffect, useState } from "react";
import { useProjectGateway } from "../lib/project_client";

interface Grant {
  project_id: string;
  path_pattern: string;
  scope: string;
  granted_at: string;
}

interface Props {
  projectId: string;
}

export function PermissionGrantsPanel({ projectId }: Props) {
  const client = useProjectGateway(projectId);
  const [grants, setGrants] = useState<Grant[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newPattern, setNewPattern] = useState("");
  const [newScope, setNewScope] = useState<"read" | "write">("write");

  async function reload() {
    if (!client) return;
    try {
      setGrants(await client.listPermissionGrants(projectId));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  useEffect(() => {
    reload();
  }, [client, projectId]);

  async function revokeOne(pattern: string, scope: string) {
    if (!client) return;
    try {
      await client.revokePermissionGrant(projectId, pattern, scope);
      await reload();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function addGrant() {
    if (!client) return;
    const pattern = newPattern.trim();
    if (!pattern) return;
    setError(null);
    try {
      await client.addPermissionGrant(projectId, pattern, newScope);
      setNewPattern("");
      await reload();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function revokeAll() {
    if (!client) return;
    if (!window.confirm("Revoke all permission grants for this project?")) return;
    try {
      await client.revokeAllPermissionGrants(projectId);
      await reload();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="mt-6">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-sm font-semibold text-gray-700">Permission grants</h2>
        {grants && grants.length > 0 && (
          <button
            onClick={revokeAll}
            className="text-xs text-red-600 hover:text-red-800"
          >
            Revoke all
          </button>
        )}
      </div>
      {error && <p className="text-xs text-red-600 mb-2">{error}</p>}
      <form
        className="flex items-center gap-2 mb-3"
        onSubmit={(e) => { e.preventDefault(); void addGrant(); }}
      >
        <input
          type="text"
          value={newPattern}
          onChange={(e) => setNewPattern(e.target.value)}
          placeholder="src/**/*.py"
          className="flex-1 px-2 py-1 text-xs font-mono border border-gray-300 dark:border-gray-700 rounded bg-white dark:bg-gray-900 dark:text-gray-100"
        />
        <select
          value={newScope}
          onChange={(e) => setNewScope(e.target.value as "read" | "write")}
          className="text-xs border border-gray-300 dark:border-gray-700 rounded px-1 py-1 bg-white dark:bg-gray-900 dark:text-gray-100"
        >
          <option value="write">write</option>
          <option value="read">read</option>
        </select>
        <button
          type="submit"
          disabled={!newPattern.trim()}
          className="text-xs px-2 py-1 bg-gray-900 text-white rounded hover:bg-gray-700 disabled:opacity-50 dark:bg-gray-100 dark:text-gray-900"
        >
          + Add
        </button>
      </form>
      {grants === null ? (
        <p className="text-xs text-gray-400">Loading…</p>
      ) : grants.length === 0 ? (
        <p className="text-xs text-gray-400">
          No grants yet. The agent will ask the next time it wants to write to a
          file in this project. Choosing "Allow always" persists a grant here.
        </p>
      ) : (
        <ul className="space-y-1">
          {grants.map((g) => (
            <li
              key={`${g.path_pattern}|${g.scope}`}
              className="flex items-center justify-between text-xs bg-gray-50 border border-gray-200 rounded px-3 py-2"
            >
              <div className="flex flex-col">
                <span className="font-mono text-gray-700">{g.path_pattern}</span>
                <span className="text-gray-400">
                  {g.scope} · granted {g.granted_at}
                </span>
              </div>
              <button
                onClick={() => revokeOne(g.path_pattern, g.scope)}
                className="text-red-600 hover:text-red-800"
              >
                Revoke
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
