import type { ReactNode } from "react";
import { useRouter } from "@tanstack/react-router";
import { Sidebar } from "../components/Sidebar";
import { ShortcutsModal } from "../components/ShortcutsModal";
import { SearchModal } from "../components/SearchModal";
import { FileEditorPanel } from "../components/FileEditorPanel";
import { CommandPalette } from "../components/CommandPalette";
import { AboutModal } from "../components/AboutModal";
import { ResizableSide } from "../components/ResizableSide";
import { useUI } from "../stores/ui";
import { previousChatId, nthBackChatId } from "../lib/recent_chats";
import { useProjects } from "../stores/projects";
import { useChats } from "../stores/chats";
import { ensureProjectClient } from "../lib/project_client";
import { formatErr } from "../lib/format_err";
import { useShortcuts } from "../lib/shortcuts";
import { pushToast } from "../stores/toasts";

export function SidebarLayout({ children }: { children: ReactNode }) {
  const collapsed = useUI((s) => s.sidebarCollapsed);
  const fileViewer = useUI((s) => s.fileViewer);
  const toggleSidebar = useUI((s) => s.toggleSidebar);
  const openShortcuts = useUI((s) => s.openShortcutsModal);
  const closeShortcuts = useUI((s) => s.closeShortcutsModal);
  const openSearch = useUI((s) => s.openSearchModal);
  const openPalette = useUI((s) => s.openPalette);
  const client = useProjects((s) => s.client);
  const setChatList = useChats((s) => s.setChatList);
  const router = useRouter();

  useShortcuts([
    { key: "\\", meta: true, description: "Toggle sidebar", handler: toggleSidebar },
    { key: "/", meta: true, description: "Show shortcuts", handler: openShortcuts },
    { key: ",", meta: true, description: "Open Settings", handler: () => router.navigate({ to: "/settings" } as any) },
    { key: "p", meta: true, description: "Search chats", handler: openSearch },
    { key: "p", meta: true, shift: true, description: "Command palette", handler: openPalette },
    {
      key: "k",
      meta: true,
      description: "Focus composer",
      handler: () => {
        const ta = document.querySelector<HTMLTextAreaElement>("textarea[data-composer]");
        ta?.focus();
      },
    },
    {
      key: "n",
      meta: true,
      description: "New chat",
      handler: async () => {
        if (!client) return;
        // Match the active project from the current URL when possible.
        const match = window.location.pathname.match(/^\/project\/([^/]+)/);
        if (match) {
          const projectId = match[1];
          const project = useProjects.getState().projects.find((p) => p.id === projectId);
          try {
            const gw = await ensureProjectClient(project);
            if (!gw) return;
            const created = await gw.createProjectChat(projectId, { title: "New chat" });
            const chats = await gw.listProjectChats(projectId);
            setChatList(projectId, chats);
            router.navigate({ to: "/project/$id/chat/$cid", params: { id: projectId, cid: created.chat_id } });
          } catch (e) {
            pushToast(`Could not create chat: ${formatErr(e)}`, "error");
          }
        } else {
          const created = await client.createProjectlessChat({ title: "New chat" });
          const chats = await client.listProjectlessChats();
          setChatList(null, chats);
          router.navigate({ to: "/chat/$cid", params: { cid: created.chat_id } });
        }
      },
    },
    { key: "Escape", description: "Close shortcuts", handler: closeShortcuts },
    { key: "j", description: "Next chat in sidebar", handler: () => navigateSidebar(1) },
    { key: "k", description: "Previous chat in sidebar", handler: () => navigateSidebar(-1) },
    // Cmd+1 .. Cmd+9 jump to the Nth visible chat in the sidebar. Useful
    // when you keep a handful of frequent chats and want O(1) access.
    ...Array.from({ length: 9 }, (_, i) => ({
      key: String(i + 1),
      meta: true,
      description: `Jump to chat #${i + 1} in sidebar`,
      handler: () => {
        const rows = Array.from(document.querySelectorAll<HTMLElement>("[data-chat-id]"));
        rows[i]?.click();
      },
    })),
    {
      key: "`",
      meta: true,
      description: "Jump to previously viewed chat",
      handler: () => {
        const match = window.location.pathname.match(/\/chat\/([^/]+)$/);
        const currentId = match ? match[1] : null;
        const prev = previousChatId(currentId);
        if (!prev) return;
        const row = document.querySelector<HTMLElement>(`[data-chat-id="${prev}"]`);
        row?.click();
      },
    },
    {
      key: "`",
      meta: true,
      shift: true,
      description: "Jump 2 chats back in history",
      handler: () => {
        const match = window.location.pathname.match(/\/chat\/([^/]+)$/);
        const currentId = match ? match[1] : null;
        const target = nthBackChatId(currentId, 2);
        if (!target) return;
        const row = document.querySelector<HTMLElement>(`[data-chat-id="${target}"]`);
        row?.click();
      },
    },
  ]);

  function navigateSidebar(delta: number): void {
    const rows = Array.from(document.querySelectorAll<HTMLElement>("[data-chat-id]"));
    if (rows.length === 0) return;
    // Find current chat in DOM order; -1 if no chat is open.
    const match = window.location.pathname.match(/\/chat\/([^/]+)$/);
    const currentId = match ? match[1] : null;
    const currentIdx = currentId ? rows.findIndex((el) => el.dataset.chatId === currentId) : -1;
    const nextIdx = (currentIdx + delta + rows.length) % rows.length;
    rows[nextIdx]?.click();
  }

  return (
    <div className="flex h-full bg-white text-gray-800 dark:bg-gray-900 dark:text-gray-100">
      {!collapsed && (
        <ResizableSide storageKey="clawagents:width:sidebar" defaultWidth={256} minWidth={180} maxWidth={480} edge="right">
          <aside className="h-full border-r border-gray-200 bg-gray-50 dark:border-gray-800 dark:bg-gray-950">
            <Sidebar />
          </aside>
        </ResizableSide>
      )}
      <main className="flex-1 overflow-auto min-w-0">{children}</main>
      {fileViewer && (
        <ResizableSide
          storageKey="clawagents:width:file-editor"
          defaultWidth={420}
          minWidth={280}
          maxWidth={900}
          edge="left"
        >
          <FileEditorPanel />
        </ResizableSide>
      )}
      <ShortcutsModal />
      <SearchModal />
      <CommandPalette />
      <AboutModal />
    </div>
  );
}
