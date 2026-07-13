import { useEffect, useState } from "react";
import { createRoute } from "@tanstack/react-router";
import { Route as RootRoute } from "./__root";
import { useProjects } from "../stores/projects";
import { useRemote } from "../stores/remote";
import { pushToast } from "../stores/toasts";
import { ensureProjectClient, isSshProject } from "../lib/project_client";
import { formatErr } from "../lib/format_err";
import { PermissionGrantsPanel } from "../components/PermissionGrantsPanel";
import { ProjectSystemPromptPanel } from "../components/ProjectSystemPromptPanel";
import { ProjectEnvVarsPanel } from "../components/ProjectEnvVarsPanel";
import { ProjectActivityWidget } from "../components/ProjectActivityWidget";
import { ProjectDefaultsPanel } from "../components/ProjectDefaultsPanel";
import { DiscoveredSkillsPanel } from "../components/DiscoveredSkillsPanel";

export const Route = createRoute({
  getParentRoute: () => RootRoute,
  path: "/project/$id",
  component: function ProjectIndex() {
    const { id } = Route.useParams();
    const project = useProjects((s) => s.projects.find((p) => p.id === id));
    const client = useProjects((s) => s.client);
    const status = useRemote((s) => s.statusFor(id));
    const remoteError = useRemote((s) => s.errorFor(id));
    const disconnect = useRemote((s) => s.disconnect);
    const [busy, setBusy] = useState(false);

    useEffect(() => {
      if (!project || !isSshProject(project)) return;
      if (status === "connected" || status === "connecting") return;
      setBusy(true);
      void ensureProjectClient(project)
        .catch((e) => pushToast(`SSH connect failed: ${formatErr(e)}`, "error"))
        .finally(() => setBusy(false));
    }, [project, status]);

    async function revealInFinder() {
      if (!client || !project || isSshProject(project)) return;
      try { await client.revealFolder(project.root_path); }
      catch (e) { pushToast(`Open failed: ${formatErr(e)}`, "error"); }
    }

    async function connect() {
      if (!project) return;
      setBusy(true);
      try {
        await ensureProjectClient(project);
      } catch (e) {
        pushToast(`SSH connect failed: ${formatErr(e)}`, "error");
      } finally {
        setBusy(false);
      }
    }

    async function onDisconnect() {
      setBusy(true);
      try {
        await disconnect(id);
      } finally {
        setBusy(false);
      }
    }

    const ssh = isSshProject(project);

    return (
      <div className="p-6 max-w-2xl">
        <h1 className="text-lg font-semibold text-gray-800 dark:text-gray-100 flex items-center gap-2">
          {project?.name ?? "Loading…"}
          {ssh && (
            <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded border border-sky-300 text-sky-700 dark:border-sky-700 dark:text-sky-300">
              SSH
            </span>
          )}
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 font-mono mt-1 flex items-center gap-2">
          {ssh && project?.ssh_host ? `${project.ssh_host}:` : ""}
          {project?.root_path}
          {project && !ssh && (
            <button
              onClick={revealInFinder}
              title="Reveal in Finder"
              className="text-blue-600 dark:text-blue-300 hover:underline"
            >
              ↗
            </button>
          )}
        </p>

        {ssh && (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
            <span
              className={`text-xs px-2 py-0.5 rounded border ${
                status === "connected"
                  ? "border-green-400 text-green-700 dark:text-green-300"
                  : status === "connecting" || busy
                    ? "border-amber-400 text-amber-700 dark:text-amber-300"
                    : status === "error"
                      ? "border-red-400 text-red-700 dark:text-red-300"
                      : "border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400"
              }`}
            >
              {busy || status === "connecting" ? "connecting…" : status}
            </span>
            {status === "connected" ? (
              <button
                type="button"
                onClick={() => void onDisconnect()}
                disabled={busy}
                className="text-xs px-2 py-1 border border-gray-300 dark:border-gray-700 rounded hover:bg-gray-50 dark:hover:bg-gray-800"
              >
                Disconnect
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void connect()}
                disabled={busy}
                className="text-xs px-2 py-1 bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900 rounded"
              >
                {busy ? "Connecting…" : "Connect"}
              </button>
            )}
            {remoteError && (
              <span className="text-xs text-red-600 dark:text-red-400 whitespace-pre-wrap">{remoteError}</span>
            )}
          </div>
        )}

        <p className="text-sm text-gray-500 dark:text-gray-400 mt-4">Pick a chat from the sidebar, or create a new one.</p>
        <ProjectActivityWidget projectId={id} />
        <ProjectDefaultsPanel projectId={id} />
        <DiscoveredSkillsPanel projectId={id} />
        <ProjectSystemPromptPanel projectId={id} />
        <ProjectEnvVarsPanel projectId={id} />
        <PermissionGrantsPanel projectId={id} />
      </div>
    );
  },
});
