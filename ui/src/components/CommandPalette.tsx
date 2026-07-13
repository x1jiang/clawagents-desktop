import { useEffect, useMemo, useState } from "react";
import { useRouter } from "@tanstack/react-router";
import { useUI } from "../stores/ui";
import { useProjects } from "../stores/projects";
import { useChats } from "../stores/chats";
import { useTheme } from "../stores/theme";
import { pushToast } from "../stores/toasts";
import { recentChatIds } from "../lib/recent_chats";
import {
  filterPaletteActions,
  groupPaletteActions,
  recentChatLabel,
  type CommandPaletteAction,
} from "../lib/command_palette";

/**
 * Quake-style command palette. ⌘⇧P opens it. Plain text filters by label;
 * Enter runs the active action; Esc dismisses. Built fresh each render
 * because the underlying state (project list, theme) is cheap.
 */
export function CommandPalette() {
  const open = useUI((s) => s.paletteOpen);
  const close = useUI((s) => s.closePalette);
  const router = useRouter();
  const client = useProjects((s) => s.client);
  const projects = useProjects((s) => s.projects);
  const setChatList = useChats((s) => s.setChatList);
  const projectless = useChats((s) => s.projectless);
  const byProject = useChats((s) => s.byProject);
  const theme = useTheme((s) => s.theme);
  const themeMode = useTheme((s) => s.mode);
  const toggleTheme = useTheme((s) => s.toggle);
  const setThemeMode = useTheme((s) => s.setMode);
  const openShortcuts = useUI((s) => s.openShortcutsModal);
  const openSearch = useUI((s) => s.openSearchModal);
  const toggleSidebar = useUI((s) => s.toggleSidebar);

  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [availableModels, setAvailableModels] = useState<string[]>([]);

  useEffect(() => {
    if (open) {
      setQuery(""); setActive(0);
      // Lazy-load available models so the palette can offer per-model switches
      // for whichever chat happens to be on screen.
      if (client) {
        void client.listProviders().then((providers) => {
          const models = providers.flatMap((p) => p.models.filter((m) => m.available).map((m) => m.id));
          setAvailableModels(models);
        }).catch(() => setAvailableModels([]));
      }
    }
  }, [open, client]);

  // The current chat id is determined from the URL.
  const currentChatId = (() => {
    const m = window.location.pathname.match(/\/chat\/([^/]+)$/);
    return m ? m[1] : null;
  })();

  const allChats = useMemo(
    () => [...projectless, ...Object.values(byProject).flat()],
    [projectless, byProject],
  );

  const actions: CommandPaletteAction[] = useMemo(() => {
    const list: CommandPaletteAction[] = [
      { group: "Navigate", label: "New projectless chat", hint: "⌘N", run: async () => {
        if (!client) return;
        const created = await client.createProjectlessChat({ title: "New chat" });
        const chats = await client.listProjectlessChats();
        setChatList(null, chats);
        router.navigate({ to: "/chat/$cid", params: { cid: created.chat_id } });
      }, disabledReason: client ? undefined : "Gateway not connected" },
      { group: "Navigate", label: "Search all chats", hint: "⌘P", run: openSearch },
      { group: "Navigate", label: "Go to Settings", run: () => router.navigate({ to: "/settings" } as any) },
      { group: "Navigate", label: "Go to Usage stats", run: () => router.navigate({ to: "/stats" } as any) },
      { group: "Navigate", label: "Go to Custom commands editor", run: () => router.navigate({ to: "/commands" } as any) },
      { group: "Navigate", label: "Go to Chat templates editor", run: () => router.navigate({ to: "/templates" } as any) },
      { group: "Navigate", label: "Go to Trash (recover deleted chats)", run: () => router.navigate({ to: "/trash" } as any) },
      { group: "View", label: `Theme: cycle (current: ${themeMode})`, run: toggleTheme },
      { group: "View", label: "Theme: light", run: () => setThemeMode("light") },
      { group: "View", label: "Theme: dark", run: () => setThemeMode("dark") },
      { group: "View", label: "Theme: follow system", run: () => setThemeMode("system") },
      { group: "View", label: "Toggle sidebar", hint: "⌘\\", run: toggleSidebar },
      { group: "Help", label: "Show keyboard shortcuts", hint: "⌘/", run: openShortcuts },
      { group: "Help", label: "About / diagnostics", run: () => useUI.getState().openAbout() },
    ];
    // Recently-visited chats so the user can jump back without scrolling
    // the sidebar. We delegate the click to the DOM row so the existing
    // routing + recordVisit pipeline kicks in.
    for (const id of recentChatIds()) {
      if (id === currentChatId) continue;
      list.push({
        group: "Recent",
        label: recentChatLabel(id, allChats),
        hint: id,
        keywords: [id],
        run: () => {
          const row = document.querySelector<HTMLElement>(`[data-chat-id="${id}"]`);
          if (row) row.click();
          else pushToast(`Chat ${id} not in sidebar.`, "info");
        },
      });
    }
    // Add each project as a navigation target.
    for (const p of projects) {
      list.push({
        group: "Projects",
        label: `Open project: ${p.name}`,
        hint: p.root_path,
        run: () => router.navigate({ to: "/project/$id", params: { id: p.id } }),
      });
    }
    // Per-model switch: changes the current chat's model. Only meaningful
    // when we're actually inside a chat — outside we still list them for
    // discoverability with a no-op + toast.
    for (const model of availableModels) {
      list.push({
        group: "Model",
        label: `Switch model: ${model}`,
        disabledReason: !client || !currentChatId ? "Open a chat first" : undefined,
        run: async () => {
          if (!client || !currentChatId) {
            pushToast("Open a chat first to switch its model.", "info");
            return;
          }
          try {
            await client.patchChat(currentChatId, { model });
            pushToast(`Model set to ${model} for this chat.`, "success");
          } catch (e) {
            pushToast(`Failed: ${(e as Error).message}`, "error");
          }
        },
      });
    }
    return list;
  }, [theme, themeMode, projects, client, router, setChatList, toggleTheme, setThemeMode, openShortcuts, openSearch, toggleSidebar, availableModels, currentChatId, allChats]);

  const filtered = useMemo(() => filterPaletteActions(actions, query), [query, actions]);
  const grouped = useMemo(() => groupPaletteActions(filtered), [filtered]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black/40 flex items-start justify-center z-50 pt-24" onClick={close}>
      <div
        className="bg-white dark:bg-gray-900 rounded-lg shadow-lg w-[32rem] max-h-[70vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          autoFocus
          type="text"
          placeholder="Run command…"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setActive(0); }}
          onKeyDown={(e) => {
            if (e.key === "Escape") { e.preventDefault(); close(); }
            else if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(filtered.length - 1, a + 1)); }
            else if (e.key === "ArrowUp")   { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
            else if (e.key === "Enter") {
              e.preventDefault();
              const a = filtered[active];
              if (a && !a.disabledReason) { close(); void a.run(); }
            }
          }}
          className="w-full px-4 py-3 text-sm bg-transparent border-b border-gray-200 dark:border-gray-700 dark:text-gray-100 outline-none"
        />
        <div className="overflow-y-auto flex-1">
          {filtered.length === 0 ? (
            <p className="px-4 py-6 text-xs text-gray-400">No matches.</p>
          ) : (
            grouped.map((group) => (
              <div key={group.group}>
                <div className="sticky top-0 z-10 bg-gray-50/95 dark:bg-gray-950/95 backdrop-blur px-4 py-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500 border-b border-gray-100 dark:border-gray-800">
                  {group.group}
                </div>
                {group.actions.map((a) => {
                  const index = filtered.indexOf(a);
                  return (
                    <button
                      key={`${a.group}|${a.label}`}
                      disabled={!!a.disabledReason}
                      onMouseEnter={() => setActive(index)}
                      onClick={() => {
                        if (a.disabledReason) return;
                        close();
                        void a.run();
                      }}
                      className={
                        "w-full flex items-center justify-between gap-3 px-4 py-2 text-xs border-b border-gray-100 dark:border-gray-800 disabled:cursor-not-allowed disabled:opacity-55 " +
                        (index === active
                          ? "bg-blue-50 dark:bg-blue-900/40"
                          : "hover:bg-gray-50 dark:hover:bg-gray-800")
                      }
                    >
                      <span className="min-w-0 text-left">
                        <span className="block truncate text-gray-800 dark:text-gray-100">{a.label}</span>
                        {a.disabledReason && (
                          <span className="block truncate text-[10px] text-gray-400 dark:text-gray-500">{a.disabledReason}</span>
                        )}
                      </span>
                      {a.hint && <span className="shrink-0 font-mono text-gray-400">{a.hint}</span>}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
