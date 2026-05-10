import { create } from "zustand";
import { tauriApi } from "../lib/tauri";

export type ExecMode = "read_only" | "ask" | "auto" | "full_access";

interface SettingsState {
  defaultModel: string;
  defaultMode: ExecMode;
  apiKeys: Record<string, string | null>;

  load: () => Promise<void>;
  setDefaults: (defaults: { defaultModel?: string; defaultMode?: ExecMode }) => void;
  setApiKey: (provider: string, key: string | null) => Promise<void>;
}

const KEYRING_SERVICE = "com.clawagents.desktop";

export const useSettings = create<SettingsState>((set) => ({
  defaultModel: "",
  defaultMode: "auto",
  apiKeys: {},

  load: async () => {
    const providers = ["openai", "anthropic", "gemini"];
    const apiKeys: Record<string, string | null> = {};
    for (const p of providers) {
      apiKeys[p] = await tauriApi.keyringGet(KEYRING_SERVICE, p);
    }
    set({ apiKeys });
  },

  setDefaults: ({ defaultModel, defaultMode }) =>
    set((s) => ({
      defaultModel: defaultModel ?? s.defaultModel,
      defaultMode: defaultMode ?? s.defaultMode,
    })),

  setApiKey: async (provider, key) => {
    if (key === null || key === "") {
      await tauriApi.keyringSet(KEYRING_SERVICE, provider, "");
    } else {
      await tauriApi.keyringSet(KEYRING_SERVICE, provider, key);
    }
    set((s) => ({ apiKeys: { ...s.apiKeys, [provider]: key } }));
  },
}));
