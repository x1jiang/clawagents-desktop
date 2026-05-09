import { useEffect, useState } from "react";
import { useProjects } from "../stores/projects";
import { NewProjectModal } from "./NewProjectModal";

export function ProjectList() {
  const projects = useProjects((s) => s.projects);
  const loading = useProjects((s) => s.loading);
  const error = useProjects((s) => s.error);
  const refresh = useProjects((s) => s.refresh);
  const [showModal, setShowModal] = useState(false);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold text-gray-800">Projects</h1>
        <button
          className="px-3 py-1.5 bg-gray-900 text-white text-sm rounded-md hover:bg-gray-700"
          onClick={() => setShowModal(true)}
        >
          + New project
        </button>
      </div>

      {error && (
        <div className="mb-3 p-3 bg-red-50 text-red-700 text-sm rounded">
          {error}
        </div>
      )}

      {loading && <p className="text-sm text-gray-500">Loading…</p>}

      {!loading && projects.length === 0 && (
        <p className="text-sm text-gray-500">
          No projects yet. Click "New project" to add a folder.
        </p>
      )}

      <ul className="space-y-2">
        {projects.map((p) => (
          <li key={p.id} className="border border-gray-200 rounded-md p-3 bg-white">
            <div className="font-medium text-gray-800">{p.name}</div>
            <div className="text-xs text-gray-500 font-mono">{p.root_path}</div>
          </li>
        ))}
      </ul>

      {showModal && <NewProjectModal onClose={() => setShowModal(false)} />}
    </div>
  );
}
