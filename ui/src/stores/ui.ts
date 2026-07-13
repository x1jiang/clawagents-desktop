import { create } from "zustand";

interface UIState {
  sidebarCollapsed: boolean;
  filesPanelOpen: boolean;
  shortcutsModalOpen: boolean;
  searchModalOpen: boolean;
  paletteOpen: boolean;
  aboutOpen: boolean;
  fileViewer: { projectId: string; path: string } | null;
  /** Sidebar selection mode: when on, ChatRow renders a checkbox. */
  selectMode: boolean;
  selected: Set<string>;

  toggleSidebar: () => void;
  toggleFilesPanel: () => void;
  openShortcutsModal: () => void;
  closeShortcutsModal: () => void;
  openSearchModal: () => void;
  closeSearchModal: () => void;
  openPalette: () => void;
  closePalette: () => void;
  openAbout: () => void;
  closeAbout: () => void;
  openFileViewer: (projectId: string, path: string) => void;
  closeFileViewer: () => void;
  enterSelectMode: () => void;
  exitSelectMode: () => void;
  toggleSelected: (chatId: string) => void;
  clearSelected: () => void;
}

export const useUI = create<UIState>((set) => ({
  sidebarCollapsed: false,
  filesPanelOpen: false,
  shortcutsModalOpen: false,
  searchModalOpen: false,
  paletteOpen: false,
  aboutOpen: false,
  fileViewer: null,

  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  toggleFilesPanel: () => set((s) => ({ filesPanelOpen: !s.filesPanelOpen })),
  openShortcutsModal: () => set({ shortcutsModalOpen: true }),
  closeShortcutsModal: () => set({ shortcutsModalOpen: false }),
  openSearchModal: () => set({ searchModalOpen: true }),
  closeSearchModal: () => set({ searchModalOpen: false }),
  openPalette: () => set({ paletteOpen: true }),
  closePalette: () => set({ paletteOpen: false }),
  openAbout: () => set({ aboutOpen: true }),
  closeAbout: () => set({ aboutOpen: false }),
  openFileViewer: (projectId, path) => set({ fileViewer: { projectId, path } }),
  closeFileViewer: () => set({ fileViewer: null }),
  selectMode: false,
  selected: new Set<string>(),
  enterSelectMode: () => set({ selectMode: true, selected: new Set<string>() }),
  exitSelectMode: () => set({ selectMode: false, selected: new Set<string>() }),
  toggleSelected: (chatId) =>
    set((s) => {
      const next = new Set(s.selected);
      if (next.has(chatId)) next.delete(chatId);
      else next.add(chatId);
      return { selected: next };
    }),
  clearSelected: () => set({ selected: new Set<string>() }),
}));
