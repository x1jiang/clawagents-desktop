import { create } from "zustand";

export type ConnectionStatus = "unknown" | "online" | "offline" | "reconnecting";

interface ConnectionState {
  status: ConnectionStatus;
  lastError: string | null;
  // Timestamp (ms) the status last became "offline", or null when not
  // offline. Lets the UI wait a beat before offering a disruptive
  // "restart gateway" action instead of flashing it on every brief blip.
  offlineSince: number | null;
  restarting: boolean;
  setStatus: (status: ConnectionStatus, error?: string | null) => void;
  setRestarting: (restarting: boolean) => void;
}

export const useConnection = create<ConnectionState>((set, get) => ({
  status: "unknown",
  lastError: null,
  offlineSince: null,
  restarting: false,
  setStatus: (status, error) =>
    set({
      status,
      lastError: error ?? null,
      offlineSince:
        status === "offline" ? (get().offlineSince ?? Date.now()) : null,
    }),
  setRestarting: (restarting) => set({ restarting }),
}));
