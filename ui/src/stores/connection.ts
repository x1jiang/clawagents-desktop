import { create } from "zustand";

export type ConnectionStatus = "unknown" | "online" | "offline" | "reconnecting";

interface ConnectionState {
  status: ConnectionStatus;
  lastError: string | null;
  setStatus: (status: ConnectionStatus, error?: string | null) => void;
}

export const useConnection = create<ConnectionState>((set) => ({
  status: "unknown",
  lastError: null,
  setStatus: (status, error) => set({ status, lastError: error ?? null }),
}));
