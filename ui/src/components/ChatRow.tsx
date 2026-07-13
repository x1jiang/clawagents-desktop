import { useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import type { Chat } from "../stores/chats";
import { useProjects } from "../stores/projects";
import { useChats } from "../stores/chats";
import { useUI } from "../stores/ui";
import { useProjectGateway } from "../lib/project_client";
import { pushToast } from "../stores/toasts";

interface Props {
  chat: Chat;
  /** When set, the row links to /project/$id/chat/$cid; otherwise /chat/$cid. */
  projectId: string | null;
}

export function ChatRow({ chat, projectId }: Props) {
  const client = useProjectGateway(projectId);
  const setChatList = useChats((s) => s.setChatList);
  const streaming = useChats((s) => s.streaming[chat.id] ?? false);
  const lastMessage = useChats((s) => {
    const list = s.messages[chat.id];
    return list && list.length > 0 ? list[list.length - 1] : null;
  });
  const selectMode = useUI((s) => s.selectMode);
  const selected = useUI((s) => s.selected);
  const toggleSelected = useUI((s) => s.toggleSelected);

  // Tiny status dot: red for chats with a trailing error, yellow if waiting
  // on user permission, blue/pulse while streaming.
  let statusDot: { color: string; pulse: boolean; title: string } | null = null;
  if (streaming) {
    statusDot = { color: "bg-blue-500", pulse: true, title: "Streaming" };
  } else if (lastMessage?.kind === "permission_required" && !lastMessage.resolved) {
    statusDot = { color: "bg-yellow-500", pulse: true, title: "Awaiting permission decision" };
  } else if (lastMessage?.kind === "ask_user_required" && !lastMessage.resolved) {
    statusDot = { color: "bg-sky-500", pulse: true, title: "Awaiting your answer" };
  } else if (lastMessage?.kind === "error") {
    statusDot = { color: "bg-red-500", pulse: false, title: "Last turn errored" };
  }

  const projects = useProjects((s) => s.projects);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(chat.title);
  const [moveMenuOpen, setMoveMenuOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  function relativeTime(iso: string | null | undefined): string {
    if (!iso) return "";
    const ts = Date.parse(iso);
    if (Number.isNaN(ts)) return "";
    const sec = (Date.now() - ts) / 1000;
    if (sec < 60) return "now";
    if (sec < 3600) return `${Math.floor(sec / 60)}m`;
    if (sec < 86400) return `${Math.floor(sec / 3600)}h`;
    if (sec < 86400 * 7) return `${Math.floor(sec / 86400)}d`;
    return `${Math.floor(sec / (86400 * 7))}w`;
  }

  async function moveTo(destinationId: string | null): Promise<void> {
    setMoveMenuOpen(false);
    if (!client) return;
    if (destinationId === (projectId ?? null)) return;
    try {
      await client.moveChat(chat.id, destinationId);
      // Refresh both source and destination lists.
      if (projectId) setChatList(projectId, await client.listProjectChats(projectId));
      else setChatList(null, await client.listProjectlessChats());
      if (destinationId) setChatList(destinationId, await client.listProjectChats(destinationId));
      else setChatList(null, await client.listProjectlessChats());
      pushToast(`Moved "${chat.title}".`, "success");
    } catch (e) {
      pushToast(`Move failed: ${(e as Error).message}`, "error");
    }
  }

  async function commit() {
    const next = draft.trim() || chat.title;
    setEditing(false);
    if (next === chat.title) return;
    if (!client) return;
    try {
      await client.patchChat(chat.id, { title: next });
      // Re-fetch so the sidebar reflects the new title.
      if (projectId) {
        setChatList(projectId, await client.listProjectChats(projectId));
      } else {
        setChatList(null, await client.listProjectlessChats());
      }
    } catch {
      // best-effort; the input closes either way
    }
  }

  async function remove(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!client) return;
    try {
      await fetch(`${client.baseUrl}/chats/${chat.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${client.bearerToken}` },
      });
      const refresh = async () => {
        if (projectId) setChatList(projectId, await client.listProjectChats(projectId));
        else setChatList(null, await client.listProjectlessChats());
      };
      await refresh();
      // Delete is soft now — offer to undo for ~8s via a toast action button.
      pushToast(`Deleted "${chat.title}".`, "info", {
        label: "Undo",
        run: async () => {
          try {
            await client.restoreChat(chat.id);
            await refresh();
            pushToast(`Restored "${chat.title}".`, "success");
          } catch (e2) {
            pushToast(`Restore failed: ${(e2 as Error).message}`, "error");
          }
        },
      });
    } catch (e2) {
      pushToast(`Delete failed: ${(e2 as Error).message}`, "error");
    }
  }

  if (selectMode) {
    const isChecked = selected.has(chat.id);
    return (
      <label
        className={
          "flex items-center gap-2 px-2 py-1 text-sm rounded cursor-pointer " +
          (isChecked
            ? "bg-blue-50 dark:bg-blue-900/40 text-gray-800 dark:text-gray-100"
            : "text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800")
        }
      >
        <input
          type="checkbox"
          checked={isChecked}
          onChange={() => toggleSelected(chat.id)}
          className="cursor-pointer"
        />
        <span className="truncate flex-1 flex items-center gap-1">
          {statusDot && (
            <span
              title={statusDot.title}
              className={`inline-block w-1.5 h-1.5 rounded-full ${statusDot.color} ${statusDot.pulse ? "animate-pulse" : ""}`}
            />
          )}
          {chat.pinned && <span className="text-yellow-500">★</span>}
          {chat.title}
        </span>
      </label>
    );
  }

  if (editing) {
    return (
      <div className="px-2 py-0.5">
        <input
          ref={inputRef}
          autoFocus
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); commit(); }
            else if (e.key === "Escape") { e.preventDefault(); setEditing(false); setDraft(chat.title); }
          }}
          className="w-full px-1 py-0.5 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-900 dark:text-gray-100"
        />
      </div>
    );
  }

  const linkBase =
    "relative flex items-center justify-between border-l-2 border-transparent px-2 py-1.5 text-sm rounded truncate group/row " +
    "text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800";
  const linkActive =
    "relative flex items-center justify-between border-l-2 border-blue-500 px-2 py-1.5 text-sm bg-blue-50 text-gray-900 rounded truncate group/row dark:bg-blue-900/30 dark:text-gray-100";

  const linkProps = projectId
    ? { to: "/project/$id/chat/$cid" as const, params: { id: projectId, cid: chat.id } }
    : { to: "/chat/$cid" as const, params: { cid: chat.id } };

  return (
    <Link
      {...linkProps}
      className={linkBase}
      activeProps={{ className: linkActive }}
      data-chat-id={chat.id}
      onDoubleClick={(e) => {
        e.preventDefault();
        setDraft(chat.title);
        setEditing(true);
      }}
      title="Double-click to rename"
    >
      <span className="truncate flex-1 flex items-center gap-1">
        {statusDot && (
          <span
            title={statusDot.title}
            className={`inline-block w-1.5 h-1.5 rounded-full ${statusDot.color} ${statusDot.pulse ? "animate-pulse" : ""}`}
          />
        )}
        {chat.pinned && <span className="text-yellow-500" aria-label="pinned">★</span>}
        <span className="truncate">{chat.title}</span>
        {/* The age pill hides on hover so the hover icons get the space. */}
        <span
          className="ml-auto text-[10px] text-gray-400 dark:text-gray-500 font-mono group-hover/row:hidden"
          title={chat.last_message_at}
        >
          {relativeTime(chat.last_message_at)}
        </span>
      </span>
      <span className="ml-2 flex items-center gap-1">
        <button
          onClick={async (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (!client) return;
            try {
              await client.patchChat(chat.id, { pinned: !chat.pinned });
              if (projectId) setChatList(projectId, await client.listProjectChats(projectId));
              else setChatList(null, await client.listProjectlessChats());
            } catch { /* best-effort */ }
          }}
          title={chat.pinned ? "Unpin chat" : "Pin chat"}
          className={
            "text-xs " +
            (chat.pinned
              ? "text-yellow-500 hover:text-yellow-600"
              : "text-gray-300 hover:text-yellow-500 opacity-0 group-hover/row:opacity-100")
          }
        >
          ★
        </button>
        <button
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); setMoveMenuOpen((o) => !o); }}
          title="Move chat"
          className="text-gray-300 hover:text-blue-600 opacity-0 group-hover/row:opacity-100 text-xs"
        >
          ↪
        </button>
        <button
          onClick={remove}
          title="Delete chat"
          className="text-gray-300 hover:text-red-600 opacity-0 group-hover/row:opacity-100 text-xs"
        >
          ✕
        </button>
      </span>
      {moveMenuOpen && (
        <div
          className="absolute right-0 mt-6 z-20 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded shadow-lg w-56 text-xs"
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
        >
          <div className="px-2 py-1 text-[10px] uppercase tracking-wide text-gray-400 dark:text-gray-500">Move to</div>
          {projectId !== null && (
            <button
              onClick={() => void moveTo(null)}
              className="block w-full text-left px-2 py-1 hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-200"
            >
              📦 Projectless
            </button>
          )}
          {projects.filter((p) => p.id !== projectId).map((p) => (
            <button
              key={p.id}
              onClick={() => void moveTo(p.id)}
              className="block w-full text-left px-2 py-1 hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-200 truncate"
            >
              📁 {p.name}
            </button>
          ))}
          <button
            onClick={() => setMoveMenuOpen(false)}
            className="block w-full text-left px-2 py-1 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 border-t border-gray-100 dark:border-gray-800"
          >
            Cancel
          </button>
        </div>
      )}
    </Link>
  );
}
