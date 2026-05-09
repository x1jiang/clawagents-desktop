import { create } from "zustand";
import type { Project, GatewayClient } from "../lib/gateway";

interface ProjectsState {
  projects: Project[];
  loading: boolean;
  error: string | null;
  client: GatewayClient | null;

  setClient: (client: GatewayClient) => void;
  refresh: () => Promise<void>;
  create: (name: string, rootPath: string) => Promise<Project>;
}

export const useProjects = create<ProjectsState>((set, get) => ({
  projects: [],
  loading: false,
  error: null,
  client: null,

  setClient: (client) => set({ client }),

  refresh: async () => {
    const { client } = get();
    if (!client) return;
    set({ loading: true, error: null });
    try {
      const projects = await client.listProjects();
      set({ projects, loading: false });
    } catch (e) {
      set({ error: (e as Error).message, loading: false });
    }
  },

  create: async (name, rootPath) => {
    const { client } = get();
    if (!client) throw new Error("gateway client not initialised");
    const created = await client.createProject({ name, root_path: rootPath });
    await get().refresh();
    return created;
  },
}));
