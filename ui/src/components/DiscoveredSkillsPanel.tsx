import { useEffect, useState } from "react";
import { useProjectGateway } from "../lib/project_client";
import { useUI } from "../stores/ui";
import { pushToast } from "../stores/toasts";
import { SkillWorkshopPanel } from "./SkillWorkshopPanel";

interface Skill {
  name: string;
  description: string;
  source_dir: string;
  path: string;
  origin?: string;
  excluded?: boolean;
}

interface Props {
  projectId: string;
}

/**
 * Shows skills the agent auto-loads for this project, with exclude/keep,
 * quarantine warnings, and a doorway into the Skill Workshop.
 */
export function DiscoveredSkillsPanel({ projectId }: Props) {
  const client = useProjectGateway(projectId);
  const openFile = useUI((s) => s.openFileViewer);
  const [skills, setSkills] = useState<Skill[] | null>(null);
  const [folders, setFolders] = useState<Array<{ path: string; display: string; origin: string }>>([]);
  const [unavailable, setUnavailable] = useState<Record<string, string>>({});
  const [quarantined, setQuarantined] = useState<Record<string, string>>({});
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [workshopOpen, setWorkshopOpen] = useState(false);
  const [includeHomes, setIncludeHomes] = useState(false);
  const [showWarnings, setShowWarnings] = useState(false);

  async function reload() {
    if (!client) return;
    setRefreshing(true);
    setError(null);
    try {
      const out = await client.discoveredSkills(projectId, includeHomes);
      setSkills(out.skills);
      setFolders(out.folders || []);
      setUnavailable(out.unavailable || {});
      setQuarantined(out.quarantined || {});
      setWarnings(out.warnings || []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRefreshing(false);
    }
  }

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, projectId, includeHomes]);

  async function toggleExclude(skill: Skill) {
    if (!client) return;
    const exclude = !skill.excluded;
    try {
      await client.excludeSkill(skill.name, exclude, projectId);
      pushToast(exclude ? `Excluded ${skill.name}` : `Kept ${skill.name}`, "success");
      await reload();
    } catch (e) {
      pushToast((e as Error).message, "error");
    }
  }

  return (
    <div className="mt-6">
      <div className="flex items-center justify-between mb-2 gap-2">
        <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200">Agent skills</h2>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setWorkshopOpen(true)}
            className="text-xs text-teal-700 dark:text-teal-300 hover:underline"
          >
            Workshop
          </button>
          <button
            onClick={reload}
            disabled={refreshing}
            className="text-xs text-blue-600 dark:text-blue-300 hover:underline disabled:opacity-50"
          >
            {refreshing ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </div>
      <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
        Loaded from project skill folders (and optionally personal homes). Exclude hides a skill from
        the agent without deleting its files.
      </p>
      <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300 mb-2">
        <input
          type="checkbox"
          checked={includeHomes}
          onChange={(e) => setIncludeHomes(e.target.checked)}
        />
        Include personal skill homes (~/.codex, ~/.claude, ~/.agents, ~/.clawagents)
      </label>
      {folders.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1">
          {folders.map((f) => (
            <span
              key={f.path}
              title={f.path}
              className="text-[10px] px-1.5 py-0.5 rounded border border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 font-mono"
            >
              {f.origin}:{f.display}
            </span>
          ))}
        </div>
      )}
      {error && <p className="text-xs text-red-600 mb-2">{error}</p>}
      {skills === null && !error && (
        <p className="text-xs text-gray-400">Loading…</p>
      )}
      {skills !== null && skills.length === 0 && !error && (
        <p className="text-xs text-gray-400">
          No skills found. Drop a <code>SKILL.md</code> into{" "}
          <code>.agents/skills/&lt;name&gt;/</code> and click Refresh — or open Workshop to install one.
        </p>
      )}
      {skills && skills.length > 0 && (
        <ul className="space-y-1">
          {skills.map((s) => (
            <li key={`${s.origin}-${s.name}-${s.path}`}>
              <div className="w-full px-2 py-1.5 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
                <div className="flex items-baseline gap-2">
                  <button
                    type="button"
                    onClick={() => openFile(projectId, s.path)}
                    title={`Open ${s.path}`}
                    className="font-mono text-xs text-gray-800 dark:text-gray-100 hover:underline"
                  >
                    {s.name}
                  </button>
                  {s.origin && (
                    <span className="text-[10px] uppercase tracking-wide text-gray-400">{s.origin}</span>
                  )}
                  {s.excluded && (
                    <span className="text-[10px] uppercase tracking-wide text-amber-600">excluded</span>
                  )}
                  <span className="text-[10px] text-gray-400 font-mono ml-auto">{s.source_dir}</span>
                </div>
                <div className="text-xs text-gray-600 dark:text-gray-400 mt-0.5 line-clamp-2">
                  {s.description || "(no description)"}
                </div>
                <div className="mt-1 flex gap-2">
                  <button
                    type="button"
                    className="text-[11px] text-blue-600 dark:text-blue-300 hover:underline"
                    onClick={() => openFile(projectId, s.path)}
                  >
                    Open
                  </button>
                  <button
                    type="button"
                    className="text-[11px] text-gray-600 dark:text-gray-300 hover:underline"
                    onClick={() => void toggleExclude(s)}
                  >
                    {s.excluded ? "Keep" : "Exclude"}
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
      {Object.keys(unavailable).length > 0 && (
        <div className="mt-2 text-xs text-amber-700 dark:text-amber-300">
          <div className="font-medium">Unavailable</div>
          {Object.entries(unavailable).map(([name, reason]) => (
            <div key={name}><span className="font-mono">{name}</span>: {reason}</div>
          ))}
        </div>
      )}
      {Object.keys(quarantined).length > 0 && (
        <div className="mt-2 text-xs text-red-700 dark:text-red-300">
          <div className="font-medium">Quarantined by content scan</div>
          {Object.entries(quarantined).map(([name, reason]) => (
            <div key={name}><span className="font-mono">{name}</span>: {reason}</div>
          ))}
        </div>
      )}
      {warnings.length > 0 && (
        <div className="mt-2 text-xs text-gray-500 dark:text-gray-400">
          <button type="button" className="font-medium hover:underline" onClick={() => setShowWarnings((v) => !v)}>
            Loader warnings ({warnings.length}) {showWarnings ? "▾" : "▸"}
          </button>
          {showWarnings && (
            <ul className="mt-1 list-disc pl-4 space-y-0.5">
              {warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      <SkillWorkshopPanel
        projectId={projectId}
        open={workshopOpen}
        onClose={() => setWorkshopOpen(false)}
      />
    </div>
  );
}
