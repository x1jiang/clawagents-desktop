import { useEffect, useState } from "react";
import { Link, useRouter } from "@tanstack/react-router";
import { useProjects } from "../stores/projects";
import { useChats } from "../stores/chats";
import { useUI } from "../stores/ui";
import { useRemote } from "../stores/remote";
import { ensureProjectClient, isSshProject, resolveProjectClient } from "../lib/project_client";
import { formatErr } from "../lib/format_err";
import { NewProjectModal } from "./NewProjectModal";
import { ThemeToggle } from "./ThemeToggle";
import { SoundToggle } from "./SoundToggle";
import { TemplatePicker } from "./TemplatePicker";
import { groupChatsByDate } from "../lib/grouping";
import type { Chat } from "../stores/chats";
import { ChatRow } from "./ChatRow";
import { pushToast } from "../stores/toasts";

export function Sidebar() {
  const projects = useProjects((s) => s.projects);
  const refreshProjects = useProjects((s) => s.refresh);
  const client = useProjects((s) => s.client);
  const remoteByProject = useRemote((s) => s.byProject);
  const setChatList = useChats((s) => s.setChatList);
  const byProject = useChats((s) => s.byProject);
  const projectless = useChats((s) => s.projectless);
  const router = useRouter();

  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [showNewProject, setShowNewProject] = useState(false);
  const [templatePickerFor, setTemplatePickerFor] = useState<{ projectId: string | null } | null>(null);
  const [filter, setFilter] = useState("");
  // Inline project rename — set to the project id while editing.
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [editProjectDraft, setEditProjectDraft] = useState("");

  async function saveProjectName(projectId: string, current: string): Promise<void> {
    if (!client) return;
    const next = editProjectDraft.trim();
    setEditingProjectId(null);
    if (!next || next === current) return;
    try {
      await client.patchProject(projectId, { name: next });
      await refreshProjects();
    } catch {
      // best-effort; the row will repaint from refresh-or-not
    }
  }
  // Per-bucket collapse state, persisted across reloads. "Older" starts
  // collapsed so long-time users don't see a wall of stale chats by default.
  const [bucketCollapsed, setBucketCollapsed] = useState<Record<string, boolean>>(() => {
    try {
      const raw = window.localStorage.getItem("clawagents:bucketsCollapsed");
      if (raw) return JSON.parse(raw) as Record<string, boolean>;
    } catch { /* ignore */ }
    return { Older: true };
  });

  type ProjectSort = "recent" | "alpha" | "created";
  const [projectSort, setProjectSort] = useState<ProjectSort>(() => {
    try {
      const v = window.localStorage.getItem("clawagents:projectSort");
      if (v === "alpha" || v === "created" || v === "recent") return v;
    } catch { /* ignore */ }
    return "recent";
  });
  function setSortPersisted(next: ProjectSort): void {
    setProjectSort(next);
    try { window.localStorage.setItem("clawagents:projectSort", next); } catch { /* ignore */ }
  }
  const sortedProjects = [...projects].sort((a, b) => {
    // Pinned projects always float to the top regardless of sort mode.
    const ap = a.pinned ? 1 : 0;
    const bp = b.pinned ? 1 : 0;
    if (ap !== bp) return bp - ap;
    if (projectSort === "alpha") return a.name.localeCompare(b.name);
    if (projectSort === "created") return (b.created_at ?? "").localeCompare(a.created_at ?? "");
    return (b.last_used_at ?? "").localeCompare(a.last_used_at ?? "");
  });

  async function toggleProjectPinned(p: { id: string; pinned?: boolean }): Promise<void> {
    if (!client) return;
    try {
      await client.patchProject(p.id, { pinned: !p.pinned });
      await refreshProjects();
    } catch {
      // best-effort
    }
  }
  function toggleBucket(name: string): void {
    setBucketCollapsed((prev) => {
      const next = { ...prev, [name]: !prev[name] };
      try { window.localStorage.setItem("clawagents:bucketsCollapsed", JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }
  const selectMode = useUI((s) => s.selectMode);
  const selected = useUI((s) => s.selected);
  const enterSelectMode = useUI((s) => s.enterSelectMode);
  const exitSelectMode = useUI((s) => s.exitSelectMode);
  // Number of chats currently streaming — surfaced as a tiny pulse badge in
  // the sidebar header so the user knows things are happening even when the
  // active tab is a different chat.
  const activeStreams = useChats((s) => Object.values(s.streaming).filter(Boolean).length);

  async function refreshAllVisible(): Promise<void> {
    const local = useProjects.getState().client;
    if (!local) return;
    try {
      setChatList(null, await local.listProjectlessChats());
      for (const p of projects) {
        if (!byProject[p.id]) continue;
        const gw = await ensureProjectClient(p).catch(() => null);
        if (!gw) continue;
        setChatList(p.id, await gw.listProjectChats(p.id));
      }
    } catch { /* ignore */ }
  }

  async function pinSelected(pinned: boolean): Promise<void> {
    if (!client) return;
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    for (const id of ids) {
      try { await client.patchChat(id, { pinned }); }
      catch { /* best-effort */ }
    }
    await refreshAllVisible();
    exitSelectMode();
  }

  async function moveSelected(destinationProjectId: string | null): Promise<void> {
    if (!client) return;
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    for (const id of ids) {
      try { await client.moveChat(id, destinationProjectId); }
      catch { /* best-effort */ }
    }
    await refreshAllVisible();
    exitSelectMode();
  }

  async function deleteSelected() {
    if (!client) return;
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    if (!window.confirm(`Delete ${ids.length} chat${ids.length === 1 ? "" : "s"}? This cannot be undone.`)) return;
    for (const id of ids) {
      try {
        await fetch(`${client.baseUrl}/chats/${id}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${client.bearerToken}` },
        });
      } catch { /* best-effort */ }
    }
    await refreshAllVisible();
    exitSelectMode();
  }

  // Bulk-move menu visibility — flipped on by the toolbar button while in select mode.
  const [bulkMoveMenuOpen, setBulkMoveMenuOpen] = useState(false);

  // Case-insensitive substring match on chat title.
  const matchesFilter = (title: string) =>
    !filter || title.toLowerCase().includes(filter.toLowerCase());

  useEffect(() => {
    refreshProjects();
    if (client) {
      client.listProjectlessChats().then((chats) => setChatList(null, chats));
    }
  }, [refreshProjects, client, setChatList]);

  // Background refresh: every 30s, re-fetch projectless chats + already-
  // expanded project chats so last_message_at and pinned/note flags stay
  // current without the user manually reloading. Pauses when the window
  // is hidden so we don't burn API on background tabs.
  useEffect(() => {
    if (!client) return;
    const id = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      client.listProjectlessChats().then((chats) => setChatList(null, chats)).catch(() => {});
      for (const pid of Object.keys(expanded)) {
        if (!expanded[pid]) continue;
        const gw = resolveProjectClient(pid);
        if (!gw) continue;
        gw.listProjectChats(pid).then((chats) => setChatList(pid, chats)).catch(() => {});
      }
    }, 30_000);
    return () => clearInterval(id);
  }, [client, expanded, setChatList]);

  async function toggleProject(projectId: string) {
    const next = !expanded[projectId];
    setExpanded((e) => ({ ...e, [projectId]: next }));
    if (!next) return;
    const project = projects.find((p) => p.id === projectId);
    try {
      const gw = await ensureProjectClient(project);
      if (!gw) return;
      if (!byProject[projectId]) {
        const chats = await gw.listProjectChats(projectId);
        setChatList(projectId, chats);
      }
    } catch (e) {
      pushToast(`SSH connect failed: ${formatErr(e)}`, "error");
    }
  }

  async function newProjectlessChat() {
    if (!client) return;
    const created = await client.createProjectlessChat({ title: "New chat" });
    const chats = await client.listProjectlessChats();
    setChatList(null, chats);
    router.navigate({ to: "/chat/$cid", params: { cid: created.chat_id } });
  }

  async function newChat(projectId: string) {
    const project = projects.find((p) => p.id === projectId);
    try {
      const gw = await ensureProjectClient(project);
      if (!gw) {
        pushToast(
          isSshProject(project)
            ? "Could not create chat: SSH not connected yet. Open the project and click Connect."
            : "Could not create chat: gateway not ready",
          "error",
        );
        return;
      }
      const created = await gw.createProjectChat(projectId, { title: "New chat" });
      const chats = await gw.listProjectChats(projectId);
      setChatList(projectId, chats);
      router.navigate({ to: "/project/$id/chat/$cid", params: { id: projectId, cid: created.chat_id } });
    } catch (e) {
      pushToast(`Could not create chat: ${formatErr(e)}`, "error");
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="p-3 border-b border-gray-200 dark:border-gray-800 space-y-2">
        {activeStreams > 0 && (
          <div
            className="flex items-center gap-1.5 text-[10px] text-blue-700 dark:text-blue-300"
            title="Chats currently streaming"
          >
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
            {activeStreams} active
          </div>
        )}
        <button
          className="w-full px-3 py-1.5 bg-gray-900 text-white text-sm rounded-md hover:bg-gray-700 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-gray-300"
          onClick={() => setShowNewProject(true)}
        >
          + New project
        </button>
        <input
          type="text"
          placeholder="Filter chats…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="w-full px-2 py-1 text-sm border border-gray-200 rounded focus:outline-none focus:border-gray-400 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:placeholder-gray-500"
        />
        {selectMode ? (
          <div className="relative text-xs space-y-1">
            <div className="flex items-center gap-1">
              <span className="text-gray-500 dark:text-gray-400 mr-1">{selected.size} selected</span>
              <button
                onClick={() => void pinSelected(true)}
                disabled={selected.size === 0}
                title="Pin selected"
                className="px-2 py-0.5 border border-gray-300 dark:border-gray-700 rounded hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-40"
              >
                ★ Pin
              </button>
              <button
                onClick={() => void pinSelected(false)}
                disabled={selected.size === 0}
                title="Unpin selected"
                className="px-2 py-0.5 border border-gray-300 dark:border-gray-700 rounded hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-40"
              >
                ☆
              </button>
              <button
                onClick={() => setBulkMoveMenuOpen((o) => !o)}
                disabled={selected.size === 0}
                title="Move selected"
                className="px-2 py-0.5 border border-gray-300 dark:border-gray-700 rounded hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-40"
              >
                ↪
              </button>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={deleteSelected}
                disabled={selected.size === 0}
                className="flex-1 px-2 py-1 bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-40"
              >
                Delete {selected.size}
              </button>
              <button
                onClick={() => { setBulkMoveMenuOpen(false); exitSelectMode(); }}
                className="px-2 py-1 text-gray-500 hover:text-gray-800 dark:text-gray-300"
              >
                Cancel
              </button>
            </div>
            {bulkMoveMenuOpen && (
              <div
                className="absolute left-0 right-0 mt-1 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded shadow-lg z-20 text-xs"
              >
                <div className="px-2 py-1 text-[10px] uppercase tracking-wide text-gray-400 dark:text-gray-500">Move to</div>
                <button
                  onClick={() => { setBulkMoveMenuOpen(false); void moveSelected(null); }}
                  className="block w-full text-left px-2 py-1 hover:bg-gray-100 dark:hover:bg-gray-800"
                >
                  📦 Projectless
                </button>
                {projects.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => { setBulkMoveMenuOpen(false); void moveSelected(p.id); }}
                    className="block w-full text-left px-2 py-1 hover:bg-gray-100 dark:hover:bg-gray-800 truncate"
                  >
                    📁 {p.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <button
            onClick={enterSelectMode}
            className="text-xs text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-100"
          >
            Select chats…
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        <div className="flex items-center justify-between px-2 py-1">
          <span className="text-xs uppercase tracking-wide text-gray-500">Projects</span>
          {projects.length > 1 && (
            <select
              value={projectSort}
              onChange={(e) => setSortPersisted(e.target.value as ProjectSort)}
              title="Sort projects"
              className="text-[10px] text-gray-500 dark:text-gray-400 bg-transparent border border-gray-200 dark:border-gray-700 rounded px-1"
            >
              <option value="recent">recent</option>
              <option value="alpha">A–Z</option>
              <option value="created">created</option>
            </select>
          )}
        </div>
        {projects.length === 0 && (
          <p className="text-xs text-gray-400 px-2 py-1 leading-relaxed">
            No projects yet. Create one to point the agent at a folder.
          </p>
        )}
        {sortedProjects.map((p) => {
          const isOpen = expanded[p.id];
          const chats = byProject[p.id] ?? [];
          return (
            <div key={p.id}>
              {editingProjectId === p.id ? (
                <div className="flex items-center gap-1 px-2 py-1 text-sm">
                  <span>📁</span>
                  <input
                    autoFocus
                    type="text"
                    value={editProjectDraft}
                    onChange={(e) => setEditProjectDraft(e.target.value)}
                    onBlur={() => void saveProjectName(p.id, p.name)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") { e.preventDefault(); void saveProjectName(p.id, p.name); }
                      else if (e.key === "Escape") { e.preventDefault(); setEditingProjectId(null); }
                    }}
                    className="flex-1 px-1 py-0.5 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-900 dark:text-gray-100"
                  />
                </div>
              ) : (
                <div className="flex items-center rounded-md group/project">
                  <button
                    className="flex min-w-0 flex-1 items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-800"
                    onClick={() => toggleProject(p.id)}
                    onDoubleClick={(e) => {
                      e.preventDefault();
                      setEditProjectDraft(p.name);
                      setEditingProjectId(p.id);
                    }}
                    title="Double-click to rename"
                  >
                    <span className="shrink-0 text-gray-400">{isOpen ? "▾" : "▸"}</span>
                    <span aria-hidden className="shrink-0">{p.pinned ? "📌" : "📁"}</span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5 truncate text-gray-800 dark:text-gray-100">
                        <span className="truncate">{p.name}</span>
                        {isSshProject(p) && (
                          <span className="shrink-0 text-[9px] uppercase tracking-wide px-1 py-0.5 rounded border border-sky-300 text-sky-700 dark:border-sky-700 dark:text-sky-300">
                            SSH
                          </span>
                        )}
                      </span>
                      <span className="mt-0.5 flex min-w-0 items-center gap-1 text-[10px] text-gray-400 dark:text-gray-500">
                        {byProject[p.id] && <span>{byProject[p.id].length} chats</span>}
                        {isSshProject(p) && (
                          <span className="truncate">
                            · {remoteByProject[p.id]?.status ?? "disconnected"}
                          </span>
                        )}
                        {p.default_model && <span className="truncate">· {p.default_model}</span>}
                        {p.default_mode && <span>· {p.default_mode}</span>}
                      </span>
                    </span>
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); void toggleProjectPinned(p); }}
                    title={p.pinned ? "Unpin project" : "Pin project"}
                    className={
                      "px-1 text-xs " +
                      (p.pinned
                        ? "text-yellow-500 hover:text-yellow-600"
                        : "text-gray-300 hover:text-yellow-500 opacity-0 group-hover/project:opacity-100")
                    }
                  >
                    ★
                  </button>
                </div>
              )}
              {isOpen && (
                <div className="ml-4">
                  <div className="flex items-center gap-1">
                    <button
                      className="flex-1 text-left px-2 py-1 text-xs text-gray-500 hover:text-gray-800"
                      onClick={() => newChat(p.id)}
                    >
                      + new chat
                    </button>
                    <button
                      className="px-2 py-1 text-xs text-gray-400 hover:text-gray-700"
                      onClick={() => setTemplatePickerFor({ projectId: p.id })}
                      title="Start from template"
                    >
                      📄
                    </button>
                  </div>
                  {(() => {
                    const visible = chats.filter((c) => matchesFilter(c.title));
                    const pinned = visible.filter((c) => c.pinned);
                    const groups = groupChatsByDate(visible.filter((c) => !c.pinned));
                    if (visible.length === 0) {
                      // Distinguish "no chats yet" from "filtered out" so the
                      // user knows which fix applies.
                      return (
                        <p className="text-[10px] text-gray-400 dark:text-gray-500 px-2 py-1 italic">
                          {chats.length === 0
                            ? "No chats yet — start one with + new chat."
                            : "No chats match the current filter."}
                        </p>
                      );
                    }
                    return (
                      <>
                        {pinned.length > 0 && (
                          <div className="mt-1">
                            <div className="px-2 py-0.5 text-[10px] uppercase tracking-wide text-gray-400 dark:text-gray-500">
                              Pinned
                            </div>
                            {pinned.map((c) => <ChatRow key={c.id} chat={c} projectId={p.id} />)}
                          </div>
                        )}
                        {groups.map((g) => (
                          <div key={g.bucket} className="mt-1">
                            <div className="px-2 py-0.5 text-[10px] uppercase tracking-wide text-gray-400 dark:text-gray-500">
                              {g.bucket}
                            </div>
                            {g.chats.map((c) => <ChatRow key={c.id} chat={c} projectId={p.id} />)}
                          </div>
                        ))}
                      </>
                    );
                  })()}
                </div>
              )}
            </div>
          );
        })}

        <div className="text-xs uppercase tracking-wide text-gray-500 px-2 py-1 mt-3">Chats</div>
        <div className="flex items-center gap-1">
          <button
            className="flex-1 text-left px-2 py-1 text-xs text-gray-500 hover:text-gray-800"
            onClick={newProjectlessChat}
          >
            + new chat
          </button>
          <button
            className="px-2 py-1 text-xs text-gray-400 hover:text-gray-700"
            onClick={() => setTemplatePickerFor({ projectId: null })}
            title="Start from template"
          >
            📄
          </button>
        </div>
        {(() => {
          const filtered = projectless.filter((c: Chat) => matchesFilter(c.title));
          const pinned = filtered.filter((c) => c.pinned);
          const unpinned = filtered.filter((c) => !c.pinned);
          const groups = groupChatsByDate(unpinned);
          return (
            <>
              {pinned.length > 0 && (
                <div className="mt-1">
                  <div className="text-[10px] uppercase tracking-wide text-gray-400 dark:text-gray-500 px-2 py-0.5">
                    Pinned
                  </div>
                  {pinned.map((c) => (
                    <ChatRow key={c.id} chat={c} projectId={null} />
                  ))}
                </div>
              )}
              {groups.map((g) => {
                const collapsed = !!bucketCollapsed[g.bucket];
                return (
                  <div key={g.bucket} className="mt-1">
                    <button
                      onClick={() => toggleBucket(g.bucket)}
                      className="w-full text-left text-[10px] uppercase tracking-wide text-gray-400 dark:text-gray-500 px-2 py-0.5 hover:text-gray-700 dark:hover:text-gray-300"
                    >
                      {collapsed ? "▸" : "▾"} {g.bucket}{collapsed ? ` (${g.chats.length})` : ""}
                    </button>
                    {!collapsed && g.chats.map((c) => (
                      <ChatRow key={c.id} chat={c} projectId={null} />
                    ))}
                  </div>
                );
              })}
            </>
          );
        })()}
      </div>

      <div className="p-2 border-t border-gray-200 dark:border-gray-800 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Link
            to="/settings"
            className="px-2 py-1 text-sm text-gray-600 hover:text-gray-800 dark:text-gray-300 dark:hover:text-gray-100"
          >
            ⚙️ Settings
          </Link>
          <Link
            to="/stats"
            className="px-2 py-1 text-sm text-gray-600 hover:text-gray-800 dark:text-gray-300 dark:hover:text-gray-100"
            title="Usage statistics"
          >
            📊
          </Link>
          <Link
            to="/commands"
            className="px-2 py-1 text-sm text-gray-600 hover:text-gray-800 dark:text-gray-300 dark:hover:text-gray-100"
            title="Custom slash commands"
          >
            ⌘
          </Link>
          <Link
            to="/templates"
            className="px-2 py-1 text-sm text-gray-600 hover:text-gray-800 dark:text-gray-300 dark:hover:text-gray-100"
            title="Chat templates"
          >
            📋
          </Link>
        </div>
        <div className="flex items-center gap-1">
          <SoundToggle />
          <ThemeToggle />
          <button
            onClick={() => useUI.getState().openShortcutsModal()}
            title="Keyboard shortcuts (⌘ /)"
            className="px-2 py-1 text-sm text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-100"
          >
            ⌨︎
          </button>
        </div>
      </div>

      {showNewProject && <NewProjectModal onClose={() => setShowNewProject(false)} />}
      {templatePickerFor && (
        <TemplatePicker
          projectId={templatePickerFor.projectId}
          onClose={() => setTemplatePickerFor(null)}
        />
      )}
    </div>
  );
}
