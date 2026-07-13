import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useProjects } from "../stores/projects";
import { useRemote } from "../stores/remote";
import { isSshProject } from "../lib/project_client";
import { NewProjectModal } from "./NewProjectModal";

export function ProjectList() {
  const projects = useProjects((s) => s.projects);
  const loading = useProjects((s) => s.loading);
  const error = useProjects((s) => s.error);
  const refresh = useProjects((s) => s.refresh);
  const remoteByProject = useRemote((s) => s.byProject);
  const [showModal, setShowModal] = useState(false);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold text-gray-800 dark:text-gray-100">Projects</h1>
        <button
          className="px-3 py-1.5 bg-gray-900 text-white text-sm rounded-md hover:bg-gray-700 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-gray-300"
          onClick={() => setShowModal(true)}
        >
          + New project
        </button>
      </div>

      {error && (
        <div className="mb-3 p-3 bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300 text-sm rounded">
          {error}
        </div>
      )}

      {loading && <p className="text-sm text-gray-500 dark:text-gray-400">Loading…</p>}

      {!loading && projects.length === 0 && (
        <p className="text-sm text-gray-500 dark:text-gray-400">
          No projects yet. Click "New project" to add a local folder or SSH remote.
        </p>
      )}

      <ul className="space-y-2">
        {projects.map((p) => {
          const ssh = isSshProject(p);
          const status = remoteByProject[p.id]?.status ?? "disconnected";
          return (
            <li key={p.id} className="border border-gray-200 dark:border-gray-700 rounded-md p-3 bg-white dark:bg-gray-900">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 font-medium text-gray-800 dark:text-gray-100">
                    <Link
                      to="/project/$id"
                      params={{ id: p.id }}
                      className="truncate hover:underline"
                    >
                      {p.name}
                    </Link>
                    {p.pinned && <span className="text-xs text-yellow-500" aria-label="pinned">★</span>}
                    {ssh && (
                      <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded border border-sky-300 text-sky-700 dark:border-sky-700 dark:text-sky-300">
                        SSH
                      </span>
                    )}
                  </div>
                  <div className="truncate text-xs text-gray-500 dark:text-gray-400 font-mono">
                    {ssh && p.ssh_host ? `${p.ssh_host}:${p.root_path}` : p.root_path}
                  </div>
                </div>
                <div className="flex shrink-0 flex-wrap justify-end gap-1 text-[10px] text-gray-500 dark:text-gray-400">
                  {ssh && (
                    <span
                      className={`rounded border px-1.5 py-0.5 ${
                        status === "connected"
                          ? "border-green-400 text-green-700 dark:text-green-300"
                          : status === "connecting"
                            ? "border-amber-400 text-amber-700 dark:text-amber-300"
                            : status === "error"
                              ? "border-red-400 text-red-700 dark:text-red-300"
                              : "border-gray-200 dark:border-gray-700"
                      }`}
                    >
                      {status}
                    </span>
                  )}
                  {p.default_model && <span className="rounded border border-gray-200 px-1.5 py-0.5 dark:border-gray-700">{p.default_model}</span>}
                  {p.default_mode && <span className="rounded border border-gray-200 px-1.5 py-0.5 dark:border-gray-700">{p.default_mode}</span>}
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      {showModal && <NewProjectModal onClose={() => setShowModal(false)} />}
    </div>
  );
}
