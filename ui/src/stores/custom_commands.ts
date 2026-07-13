import { create } from "zustand";

export interface CustomCommand {
  name: string;
  description: string;
  body: string;
}

interface CustomCommandsState {
  commands: CustomCommand[];
  loaded: boolean;
  load: (fetcher: () => Promise<CustomCommand[]>) => Promise<void>;
}

export const useCustomCommands = create<CustomCommandsState>((set) => ({
  commands: [],
  loaded: false,

  load: async (fetcher) => {
    try {
      const commands = await fetcher();
      set({ commands, loaded: true });
    } catch {
      set({ loaded: true });
    }
  },
}));
