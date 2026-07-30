import { useEffect, useMemo, useState } from "react";
import { useProjectGateway } from "../lib/project_client";
import { pushToast } from "../stores/toasts";
import { useUI } from "../stores/ui";
import { tauriApi } from "../lib/tauri";

interface Artifact {
  kind: string;
  label: string;
  path: string;
  abs_path: string;
  exists: boolean;
  is_dir: boolean;
  size: number | null;
  mtime: number;
  preview: string;
}

interface Props {
  projectId: string | null;
  chatId?: string | null;
  open: boolean;
  onClose: () => void;
}

const KIND_ORDER = [
  "durable",
  "memory_bank",
  "session_log",
  "compaction",
  "history",
  "transcript",
  "hunks",
  "observatory",
];

export function MemoryBrowserPanel({ projectId, chatId = null, open, onClose }: Props) {
  const client = useProjectGateway(projectId);
  const openFile = useUI((s) => s.openFileViewer);
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [facts, setFacts] = useState<Array<Record<string, unknown>>>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<"artifacts" | "facts" | "search" | "compacts">("artifacts");
  const [selected, setSelected] = useState<Artifact | null>(null);
  const [fileContent, setFileContent] = useState<string>("");
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<Array<{ text?: string; score?: number; path?: string; source?: string }>>([]);
  const [searching, setSearching] = useState(false);
  const [backups, setBackups] = useState<Array<{ filename: string; ts: number; size: number; suffix: string }>>([]);

  async function reload() {
    if (!client) return;
    setLoading(true);
    try {
      const overview = await client.memoryOverview(projectId);
      setArtifacts(overview.artifacts || []);
      setFacts(overview.facts || []);
      setCounts(overview.counts || {});
      if (chatId) {
        try {
          setBackups(await client.listCompactBackups(chatId));
        } catch {
          setBackups([]);
        }
      } else {
        setBackups([]);
      }
    } catch (e) {
      pushToast((e as Error).message, "error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!open) return;
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, client, projectId, chatId]);

  const grouped = useMemo(() => {
    const map = new Map<string, Artifact[]>();
    for (const a of artifacts) {
      const list = map.get(a.kind) || [];
      list.push(a);
      map.set(a.kind, list);
    }
    return KIND_ORDER.filter((k) => map.has(k)).map((k) => [k, map.get(k)!] as const);
  }, [artifacts]);

  if (!open) return null;

  async function openArtifact(a: Artifact) {
    setSelected(a);
    setFileContent("");
    if (a.is_dir || !client) return;
    if (a.path.endsWith(".sqlite3") || a.path.endsWith(".db")) {
      setFileContent("(binary index — use the Search tab)");
      return;
    }
    try {
      const file = await client.memoryFile(a.path, projectId);
      setFileContent(file.content);
    } catch (e) {
      setFileContent((e as Error).message);
    }
  }

  async function runSearch() {
    if (!client || !query.trim()) return;
    setSearching(true);
    try {
      const out = await client.memorySearch(query.trim(), projectId);
      if (!out.ok) {
        pushToast(out.error || "Search failed", "error");
        setHits([]);
      } else {
        setHits(out.hits || []);
      }
    } catch (e) {
      pushToast((e as Error).message, "error");
    } finally {
      setSearching(false);
    }
  }

  async function restoreBackup(suffix: string) {
    if (!client || !chatId) return;
    if (!window.confirm(`Restore compact backup ${suffix}? Current chat will be replaced (a safety copy is kept).`)) {
      return;
    }
    try {
      await client.restoreCompactBackup(chatId, suffix);
      pushToast("Compact backup restored", "success");
      onClose();
    } catch (e) {
      pushToast((e as Error).message, "error");
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="bg-white dark:bg-gray-900 rounded-lg shadow-xl w-full max-w-3xl max-h-[88vh] overflow-hidden border border-gray-200 dark:border-gray-700 flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700">
          <div>
            <h2 className="font-medium text-gray-900 dark:text-gray-100">Memory browser</h2>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Read-only view of `.clawagents/` durable memory, facts, and compaction archives
              {counts.artifacts != null ? ` · ${counts.artifacts} artifacts` : ""}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => void reload()} className="text-xs text-blue-600 dark:text-blue-300 hover:underline">
              Refresh
            </button>
            <button type="button" onClick={onClose} className="text-sm text-gray-500">Close</button>
          </div>
        </div>

        <div className="px-4 pt-3 flex flex-wrap gap-2 border-b border-gray-100 dark:border-gray-800 pb-3">
          {(
            [
              ["artifacts", "Artifacts"],
              ["facts", `Facts (${facts.length})`],
              ["search", "Search"],
              ["compacts", `Chat backups (${backups.length})`],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={
                "text-xs px-2.5 py-1 rounded-full border " +
                (tab === id
                  ? "border-teal-600 bg-teal-50 text-teal-900 dark:bg-teal-950 dark:text-teal-100 dark:border-teal-500"
                  : "border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-300")
              }
            >
              {label}
            </button>
          ))}
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-3">
          {loading && <p className="text-sm text-gray-500">Loading…</p>}

          {tab === "artifacts" && (
            <>
              {grouped.length === 0 && !loading && (
                <p className="text-xs text-gray-500">
                  No `.clawagents/` memory yet. It appears after the agent stores facts, dreams, or compacts context.
                </p>
              )}
              {grouped.map(([kind, rows]) => (
                <section key={kind} className="space-y-1">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">{kind.replace("_", " ")}</h3>
                  {rows.map((a) => (
                    <button
                      key={a.path}
                      type="button"
                      onClick={() => void openArtifact(a)}
                      className="w-full text-left px-2 py-1.5 rounded border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800"
                    >
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-sm text-gray-800 dark:text-gray-100">{a.label}</span>
                        <span className="text-[10px] font-mono text-gray-400">{a.path}</span>
                      </div>
                      {a.preview ? (
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 line-clamp-2 whitespace-pre-wrap">
                          {a.preview}
                        </p>
                      ) : null}
                    </button>
                  ))}
                </section>
              ))}
              {selected && (
                <section className="border border-gray-200 dark:border-gray-700 rounded-md p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-sm font-medium font-mono">{selected.path}</h3>
                    <div className="flex gap-2">
                      {projectId && !selected.is_dir && (
                        <button
                          type="button"
                          className="text-xs text-blue-600 dark:text-blue-300"
                          onClick={() => openFile(projectId, selected.path)}
                        >
                          Open in editor
                        </button>
                      )}
                      <button
                        type="button"
                        className="text-xs text-gray-500"
                        onClick={() => void tauriApi.openInFinder(selected.abs_path).catch(() => undefined)}
                      >
                        Reveal
                      </button>
                    </div>
                  </div>
                  {fileContent ? (
                    <pre className="text-[11px] max-h-64 overflow-auto whitespace-pre-wrap font-mono bg-gray-50 dark:bg-gray-950/50 p-2 rounded">
                      {fileContent}
                    </pre>
                  ) : (
                    <p className="text-xs text-gray-500">{selected.is_dir ? "Directory" : "Loading…"}</p>
                  )}
                </section>
              )}
            </>
          )}

          {tab === "facts" && (
            <ul className="space-y-2">
              {facts.length === 0 && !loading && (
                <p className="text-xs text-gray-500">No live facts in `.clawagents/facts.jsonl`.</p>
              )}
              {facts.map((f, i) => (
                <li key={String(f.id ?? i)} className="text-sm border border-gray-200 dark:border-gray-700 rounded px-2 py-1.5">
                  <div className="text-xs font-mono text-gray-400">{String(f.id || "")}</div>
                  <div className="text-gray-800 dark:text-gray-100">{String(f.text || "")}</div>
                </li>
              ))}
            </ul>
          )}

          {tab === "search" && (
            <div className="space-y-3">
              <div className="flex gap-2">
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void runSearch();
                  }}
                  placeholder="Search smart memory index…"
                  className="flex-1 px-2 py-1.5 text-sm border border-gray-300 dark:border-gray-700 rounded bg-white dark:bg-gray-800 dark:text-gray-100"
                />
                <button type="button" disabled={searching} onClick={() => void runSearch()} className="px-3 py-1.5 text-xs border rounded disabled:opacity-50">
                  {searching ? "Searching…" : "Search"}
                </button>
              </div>
              {hits.length === 0 && !searching && (
                <p className="text-xs text-gray-500">Results appear when the smart memory index has been populated.</p>
              )}
              {hits.map((h, i) => (
                <div key={i} className="text-sm border border-gray-200 dark:border-gray-700 rounded px-2 py-1.5">
                  <div className="text-[10px] font-mono text-gray-400">
                    {h.path || h.source || "memory"}
                    {h.score != null ? ` · score ${Number(h.score).toFixed(3)}` : ""}
                  </div>
                  <div className="text-gray-800 dark:text-gray-100 whitespace-pre-wrap">{h.text || ""}</div>
                </div>
              ))}
            </div>
          )}

          {tab === "compacts" && (
            <div className="space-y-2">
              {!chatId && <p className="text-xs text-gray-500">Open this panel from a chat to manage that chat&apos;s compact backups.</p>}
              {chatId && backups.length === 0 && !loading && (
                <p className="text-xs text-gray-500">No compact backups yet. Use Compact in the chat header first.</p>
              )}
              {backups.map((b) => (
                <div key={b.suffix} className="flex items-center justify-between gap-2 border border-gray-200 dark:border-gray-700 rounded px-2 py-1.5 text-sm">
                  <div>
                    <div className="font-mono text-xs">{b.suffix}</div>
                    <div className="text-[10px] text-gray-400">
                      {new Date(b.ts * 1000).toLocaleString()} · {Math.round(b.size / 1024)} KB
                    </div>
                  </div>
                  <button type="button" className="px-2 py-1 text-xs border rounded" onClick={() => void restoreBackup(b.suffix)}>
                    Restore
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
