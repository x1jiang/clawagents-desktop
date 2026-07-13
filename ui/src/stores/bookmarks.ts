import { create } from "zustand";

/**
 * Per-chat bookmarked message indices. Persisted to localStorage so they
 * survive reloads. Index is into the rendered messages array; if the chat
 * is truncated (retry / compact) the indices stop pointing at the same turns,
 * which is acceptable for a soft "favorites" feature.
 */

const KEY = "clawagents:bookmarks";

function load(): Record<string, number[]> {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") return parsed as Record<string, number[]>;
  } catch { /* ignore */ }
  return {};
}

function save(state: Record<string, number[]>): void {
  try { window.localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* ignore */ }
}

interface BookmarksState {
  byChat: Record<string, number[]>;
  toggle: (chatId: string, idx: number) => void;
  isBookmarked: (chatId: string, idx: number) => boolean;
  clear: (chatId: string) => void;
}

export const useBookmarks = create<BookmarksState>((set, get) => ({
  byChat: load(),
  toggle: (chatId, idx) =>
    set((s) => {
      const arr = s.byChat[chatId] ?? [];
      const next = arr.includes(idx)
        ? arr.filter((i) => i !== idx)
        : [...arr, idx].sort((a, b) => a - b);
      const merged = { ...s.byChat, [chatId]: next };
      save(merged);
      return { byChat: merged };
    }),
  isBookmarked: (chatId, idx) => !!get().byChat[chatId]?.includes(idx),
  clear: (chatId) =>
    set((s) => {
      const merged = { ...s.byChat };
      delete merged[chatId];
      save(merged);
      return { byChat: merged };
    }),
}));
