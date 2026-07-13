import { create } from "zustand";

export interface PinnedResult {
  /** id of the originating tool_call */
  id: string;
  name: string;
  args: unknown;
  result: string;
  success?: boolean;
}

interface PinnedState {
  /** chatId → list of pinned tool results (oldest first). */
  byChat: Record<string, PinnedResult[]>;
  pin: (chatId: string, item: PinnedResult) => void;
  unpin: (chatId: string, id: string) => void;
  isPinned: (chatId: string, id: string) => boolean;
}

export const usePinnedResults = create<PinnedState>((set, get) => ({
  byChat: {},
  pin: (chatId, item) =>
    set((s) => {
      const existing = s.byChat[chatId] ?? [];
      if (existing.some((p) => p.id === item.id)) return s;
      return { byChat: { ...s.byChat, [chatId]: [...existing, item] } };
    }),
  unpin: (chatId, id) =>
    set((s) => ({
      byChat: { ...s.byChat, [chatId]: (s.byChat[chatId] ?? []).filter((p) => p.id !== id) },
    })),
  isPinned: (chatId, id) => !!get().byChat[chatId]?.some((p) => p.id === id),
}));
