import type { GatewayClient } from "./gateway";
import { useProjects } from "../stores/projects";
import { useRemote } from "../stores/remote";

/** Local gateway for registry/settings; remote tunnel for connected SSH projects. */
export function resolveProjectClient(projectId: string | null | undefined): GatewayClient | null {
  const local = useProjects.getState().client;
  if (projectId) {
    const remote = useRemote.getState().clientFor(projectId);
    if (remote) return remote;
  }
  return local;
}

export function isSshProject(project: { kind?: string | null } | null | undefined): boolean {
  return (project?.kind || "local") === "ssh";
}

/** React hook: subscribe to local + remote client for a project. */
export function useProjectGateway(projectId: string | null | undefined): GatewayClient | null {
  const local = useProjects((s) => s.client);
  const remote = useRemote((s) =>
    projectId ? s.byProject[projectId]?.client ?? null : null,
  );
  return remote ?? local;
}

/** Ensure an SSH project has an active tunnel; return the client to use. */
export async function ensureProjectClient(
  project: {
    id: string;
    name: string;
    kind?: string | null;
    ssh_host?: string | null;
    remote_path?: string | null;
    root_path: string;
  } | null | undefined,
): Promise<GatewayClient | null> {
  if (!project) return useProjects.getState().client;
  if (!isSshProject(project)) return useProjects.getState().client;
  const existing = useRemote.getState().clientFor(project.id);
  if (existing) return existing;
  const host = (project.ssh_host || "").trim();
  const remotePath = (project.remote_path || project.root_path || "").trim();
  if (!host || !remotePath) {
    throw new Error("SSH project is missing host or remote path");
  }
  return useRemote.getState().connect({
    projectId: project.id,
    projectName: project.name,
    host,
    remotePath,
  });
}
