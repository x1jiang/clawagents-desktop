import { useEffect, useState } from "react";
import { useProjectGateway } from "../lib/project_client";
import { pushToast } from "../stores/toasts";
import { useUI } from "../stores/ui";

interface Proposal {
  id: string;
  name: string;
  description: string;
  status: string;
  action: string;
  target_skill?: string | null;
  goal?: string;
  evidence?: string;
  scan_findings: string[];
  support_file_count: number;
  body?: string;
}

interface Props {
  projectId: string | null;
  open: boolean;
  onClose: () => void;
}

export function SkillWorkshopPanel({ projectId, open, onClose }: Props) {
  const client = useProjectGateway(projectId);
  const openFile = useUI((s) => s.openFileViewer);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [packages, setPackages] = useState<Array<{ kind: string; name: string; path: string; source?: string }>>([]);
  const [selected, setSelected] = useState<Proposal | null>(null);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [installSource, setInstallSource] = useState("");
  const [installing, setInstalling] = useState(false);

  async function reload() {
    if (!client || !projectId) return;
    setLoading(true);
    try {
      const [ws, market] = await Promise.all([
        client.listWorkshop(projectId),
        client.listMarketplace(projectId),
      ]);
      setProposals(ws.proposals || []);
      setPackages(market.packages || []);
    } catch (e) {
      pushToast((e as Error).message, "error");
      setProposals([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!open) return;
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, client, projectId]);

  if (!open) return null;

  async function inspect(id: string) {
    if (!client) return;
    try {
      const row = await client.inspectWorkshop(id, projectId);
      setSelected(row as unknown as Proposal);
    } catch (e) {
      pushToast((e as Error).message, "error");
    }
  }

  async function act(id: string, action: "apply" | "reject" | "quarantine") {
    if (!client) return;
    setBusyId(id);
    try {
      let result: {
        ok: boolean;
        message?: string;
        rollback_id?: string;
        error?: string;
        findings?: string[];
      };
      if (action === "apply") {
        result = await client.applyWorkshop(id, projectId);
      } else if (action === "reject") {
        result = await client.rejectWorkshop(id, projectId);
      } else {
        result = await client.quarantineWorkshop(id, projectId);
      }
      if (!result.ok) {
        pushToast(result.error || `${action} failed`, "error");
        if (result.findings?.length) {
          pushToast(result.findings.slice(0, 3).join("; "), "error");
        }
      } else {
        pushToast(
          action === "apply"
            ? `Applied${result.rollback_id ? ` (rollback ${result.rollback_id.slice(0, 8)})` : ""}`
            : action === "reject"
              ? "Rejected"
              : "Quarantined",
          "success",
        );
        setSelected(null);
        await reload();
      }
    } catch (e) {
      pushToast((e as Error).message, "error");
    } finally {
      setBusyId(null);
    }
  }

  async function install() {
    if (!client || !installSource.trim()) return;
    setInstalling(true);
    try {
      const out = await client.installMarketplace(installSource.trim(), projectId, "skill");
      if (!out.ok) {
        pushToast(out.error || "Install failed", "error");
      } else {
        pushToast(`Installed ${out.name || "skill"}`, "success");
        setInstallSource("");
        await reload();
      }
    } catch (e) {
      pushToast((e as Error).message, "error");
    } finally {
      setInstalling(false);
    }
  }

  const pending = proposals.filter((p) => p.status === "pending");
  const other = proposals.filter((p) => p.status !== "pending");

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="bg-white dark:bg-gray-900 rounded-lg shadow-xl w-full max-w-2xl max-h-[85vh] overflow-hidden border border-gray-200 dark:border-gray-700 flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700">
          <div>
            <h2 className="font-medium text-gray-900 dark:text-gray-100">Skill workshop</h2>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Review agent-authored skill proposals and marketplace installs
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => void reload()} className="text-xs text-blue-600 dark:text-blue-300 hover:underline">
              Refresh
            </button>
            <button type="button" onClick={onClose} className="text-sm text-gray-500 hover:text-gray-800 dark:hover:text-gray-200">
              Close
            </button>
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
          <section className="space-y-2">
            <h3 className="text-sm font-medium text-gray-800 dark:text-gray-100">Install from path or git</h3>
            <div className="flex gap-2">
              <input
                value={installSource}
                onChange={(e) => setInstallSource(e.target.value)}
                placeholder="/path/to/skill or https://github.com/org/skill.git"
                className="flex-1 px-2 py-1.5 text-xs font-mono border border-gray-300 dark:border-gray-700 rounded bg-white dark:bg-gray-800 dark:text-gray-100"
              />
              <button
                type="button"
                disabled={installing || !installSource.trim()}
                onClick={() => void install()}
                className="px-3 py-1.5 text-xs border rounded disabled:opacity-50"
              >
                {installing ? "Installing…" : "Install"}
              </button>
            </div>
            {packages.length > 0 && (
              <ul className="text-xs text-gray-600 dark:text-gray-300 space-y-1">
                {packages.map((p) => (
                  <li key={`${p.kind}-${p.name}`} className="font-mono">
                    {p.kind}/{p.name}
                    {p.source ? <span className="text-gray-400"> · {p.source}</span> : null}
                  </li>
                ))}
              </ul>
            )}
          </section>

          {loading && <p className="text-sm text-gray-500">Loading…</p>}

          <section className="space-y-2">
            <h3 className="text-sm font-medium text-gray-800 dark:text-gray-100">
              Pending proposals ({pending.length})
            </h3>
            {pending.length === 0 && !loading && (
              <p className="text-xs text-gray-500">No pending workshop proposals for this project.</p>
            )}
            {pending.map((p) => (
              <div key={p.id} className="border border-gray-200 dark:border-gray-700 rounded-md p-3 text-sm space-y-2">
                <div className="flex items-baseline justify-between gap-2">
                  <div>
                    <span className="font-mono text-xs">{p.name}</span>
                    <span className="ml-2 text-[10px] uppercase tracking-wide text-gray-400">{p.action}</span>
                  </div>
                  <button type="button" className="text-xs text-blue-600 dark:text-blue-300" onClick={() => void inspect(p.id)}>
                    Inspect
                  </button>
                </div>
                <p className="text-xs text-gray-600 dark:text-gray-300 line-clamp-2">{p.description || "(no description)"}</p>
                {p.scan_findings?.length > 0 && (
                  <p className="text-xs text-amber-700 dark:text-amber-300">
                    Scan findings: {p.scan_findings.slice(0, 2).join("; ")}
                  </p>
                )}
                <div className="flex flex-wrap gap-2">
                  <button type="button" disabled={busyId === p.id} className="px-2 py-1 text-xs border rounded" onClick={() => void act(p.id, "apply")}>
                    Apply
                  </button>
                  <button type="button" disabled={busyId === p.id} className="px-2 py-1 text-xs border rounded" onClick={() => void act(p.id, "reject")}>
                    Reject
                  </button>
                  <button type="button" disabled={busyId === p.id} className="px-2 py-1 text-xs border rounded" onClick={() => void act(p.id, "quarantine")}>
                    Quarantine
                  </button>
                </div>
              </div>
            ))}
          </section>

          {other.length > 0 && (
            <section className="space-y-2">
              <h3 className="text-sm font-medium text-gray-800 dark:text-gray-100">History</h3>
              {other.slice(0, 12).map((p) => (
                <div key={p.id} className="text-xs text-gray-500 dark:text-gray-400 font-mono">
                  {p.status} · {p.name} · {p.id.slice(0, 8)}
                </div>
              ))}
            </section>
          )}

          {selected && (
            <section className="border border-teal-600/40 rounded-md p-3 space-y-2 bg-teal-50/40 dark:bg-teal-950/20">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium">{selected.name}</h3>
                <button type="button" className="text-xs text-gray-500" onClick={() => setSelected(null)}>
                  Hide
                </button>
              </div>
              <p className="text-xs text-gray-600 dark:text-gray-300">{selected.description}</p>
              {selected.goal ? <p className="text-xs"><span className="font-medium">Goal:</span> {selected.goal}</p> : null}
              {selected.body ? (
                <pre className="text-[11px] max-h-48 overflow-auto whitespace-pre-wrap font-mono bg-white/70 dark:bg-gray-950/50 p-2 rounded border border-gray-200 dark:border-gray-700">
                  {String(selected.body).slice(0, 8000)}
                </pre>
              ) : null}
              {projectId && selected.name ? (
                <button
                  type="button"
                  className="text-xs text-blue-600 dark:text-blue-300"
                  onClick={() => openFile(projectId, `.clawagents/skill-workshop/proposals/${selected.id}/SKILL.md`)}
                >
                  Open proposal folder file
                </button>
              ) : null}
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
