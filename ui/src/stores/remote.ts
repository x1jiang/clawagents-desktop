import { create } from "zustand";
import { GatewayClient } from "../lib/gateway";
import { formatErr } from "../lib/format_err";
import { tauriApi, type RemoteGatewayInfo } from "../lib/tauri";
import { useProjects } from "./projects";

export type RemoteStatus = "disconnected" | "connecting" | "connected" | "error";

interface RemoteEntry {
  status: RemoteStatus;
  info: RemoteGatewayInfo | null;
  client: GatewayClient | null;
  error: string | null;
}

interface RemoteState {
  byProject: Record<string, RemoteEntry>;
  connect: (args: {
    projectId: string;
    projectName: string;
    host: string;
    remotePath: string;
  }) => Promise<GatewayClient>;
  disconnect: (projectId: string) => Promise<void>;
  markDisconnected: (projectId: string, error?: string) => void;
  clientFor: (projectId: string) => GatewayClient | null;
  statusFor: (projectId: string) => RemoteStatus;
  errorFor: (projectId: string) => string | null;
}

const emptyEntry = (): RemoteEntry => ({
  status: "disconnected",
  info: null,
  client: null,
  error: null,
});

export const useRemote = create<RemoteState>((set, get) => ({
  byProject: {},

  connect: async ({ projectId, projectName, host, remotePath }) => {
    set((s) => ({
      byProject: {
        ...s.byProject,
        [projectId]: {
          ...(s.byProject[projectId] ?? emptyEntry()),
          status: "connecting",
          error: null,
        },
      },
    }));
    try {
      const info = await tauriApi.connectRemoteProject({
        projectId,
        projectName,
        host,
        remotePath,
      });
      const client = new GatewayClient(info.url, info.token);
      // Push local project settings so the remote agent sees the same defaults.
      const localProject = useProjects.getState().projects.find((p) => p.id === projectId);
      if (localProject) {
        try {
          await client.createProject({
            id: projectId,
            name: localProject.name,
            root_path: remotePath,
            kind: "local",
            default_model: localProject.default_model ?? undefined,
            default_mode: localProject.default_mode ?? undefined,
            system_prompt: localProject.system_prompt ?? undefined,
            env_vars: localProject.env_vars ?? undefined,
          });
        } catch {
          // Seed may already exist from Rust connect; best-effort patch.
          try {
            await client.patchProject(projectId, {
              name: localProject.name,
              default_model: localProject.default_model ?? undefined,
              default_mode: localProject.default_mode ?? undefined,
              system_prompt: localProject.system_prompt,
              env_vars: localProject.env_vars,
            });
          } catch { /* ignore */ }
        }
      }
      set((s) => ({
        byProject: {
          ...s.byProject,
          [projectId]: { status: "connected", info, client, error: null },
        },
      }));
      return client;
    } catch (e) {
      const message = formatErr(e);
      set((s) => ({
        byProject: {
          ...s.byProject,
          [projectId]: {
            status: "error",
            info: null,
            client: null,
            error: message,
          },
        },
      }));
      throw e;
    }
  },

  disconnect: async (projectId) => {
    try {
      await tauriApi.disconnectRemoteProject(projectId);
    } finally {
      set((s) => ({
        byProject: {
          ...s.byProject,
          [projectId]: emptyEntry(),
        },
      }));
    }
  },

  markDisconnected: (projectId, error) => {
    set((s) => ({
      byProject: {
        ...s.byProject,
        [projectId]: {
          status: error ? "error" : "disconnected",
          info: null,
          client: null,
          error: error ?? null,
        },
      },
    }));
  },

  clientFor: (projectId) => get().byProject[projectId]?.client ?? null,

  statusFor: (projectId) => get().byProject[projectId]?.status ?? "disconnected",

  errorFor: (projectId) => get().byProject[projectId]?.error ?? null,
}));
