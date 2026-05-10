import { createRoute } from "@tanstack/react-router";
import { Route as RootRoute } from "./__root";
import { useProjects } from "../stores/projects";

export const Route = createRoute({
  getParentRoute: () => RootRoute,
  path: "/project/$id",
  component: function ProjectIndex() {
    const { id } = Route.useParams();
    const project = useProjects((s) => s.projects.find((p) => p.id === id));

    return (
      <div className="p-6">
        <h1 className="text-lg font-semibold text-gray-800">{project?.name ?? "Loading…"}</h1>
        <p className="text-sm text-gray-500 font-mono mt-1">{project?.root_path}</p>
        <p className="text-sm text-gray-500 mt-4">Pick a chat from the sidebar, or create a new one.</p>
      </div>
    );
  },
});
