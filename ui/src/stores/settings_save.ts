import { create } from "zustand";

/**
 * Tracks whether a SettingsModal PATCH /settings/app is currently in
 * flight. For a chat left on "Auto" model, the backend resolves the model
 * from its saved app settings (ChatSurface sends no model_override — see
 * ChatSurface.tsx handleSend). Without this, a send fired while a Settings
 * save (e.g. switching the default provider/model) is still in flight can
 * silently run the turn against the stale, not-yet-persisted settings.
 * ChatSurface awaits this before dispatching an Auto-model send.
 */
interface SettingsSaveState {
  inFlight: Promise<unknown> | null;
  setInFlight: (p: Promise<unknown> | null) => void;
}

export const useSettingsSaveStatus = create<SettingsSaveState>((set) => ({
  inFlight: null,
  setInFlight: (p) => set({ inFlight: p }),
}));

/** Await any settings save currently in flight; no-op if none. */
export async function awaitPendingSettingsSave(): Promise<void> {
  const p = useSettingsSaveStatus.getState().inFlight;
  if (!p) return;
  try {
    await p;
  } catch {
    /* the save's own error handling surfaces this; we only need to wait */
  }
}
