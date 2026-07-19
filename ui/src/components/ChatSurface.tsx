import { useEffect, useRef, useState } from "react";
import { useChats, type Message } from "../stores/chats";
import { usePinnedResults } from "../stores/pinned_results";
import { useBookmarks } from "../stores/bookmarks";
import { useProjects } from "../stores/projects";
import { ensureProjectClient, useProjectGateway } from "../lib/project_client";
import { formatErr } from "../lib/format_err";
import { streamMessages } from "../lib/stream";
import { pushToast } from "../stores/toasts";
import { awaitPendingSettingsSave } from "../stores/settings_save";
import { Composer } from "./Composer";
import { ModeChip } from "./ModeChip";
import { ModelPicker } from "./ModelPicker";
import { UsageBadge } from "./UsageBadge";
import { CompactChip } from "./CompactChip";
import { useShortcuts } from "../lib/shortcuts";
import { formatCheckpointWhen, checkpointTs } from "../lib/formatTime";
import { loadDraft, saveDraft, clearDraft } from "../lib/drafts";
import { recordVisit, recordLastPath } from "../lib/recent_chats";
import { useRouter } from "@tanstack/react-router";
import { notifyTurnComplete, notifyPermissionRequested } from "../lib/notifications";
import { playCompletionChime, playPermissionBell } from "../lib/sound";
import { UserMessage } from "./Message/UserMessage";
import { AssistantMessage } from "./Message/AssistantMessage";
import { ErrorMessage } from "./Message/ErrorMessage";
import { InfoMessage } from "./Message/InfoMessage";
import { ToolCall } from "./Message/ToolCall";
import { PermissionPrompt } from "./Message/PermissionPrompt";
import { PlanApprovalPrompt } from "./Message/PlanApprovalPrompt";
import { AskUserPrompt } from "./Message/AskUserPrompt";
import { AutoApproveBar } from "./AutoApproveBar";
import { CheckpointsPanel } from "./CheckpointsPanel";
import { RewindPanel } from "./RewindPanel";
import { tryRunSlashCommand } from "../lib/slash_commands";
import { useUI } from "../stores/ui";
import { useCustomCommands } from "../stores/custom_commands";
import { FileTreePanel } from "./FileTreePanel";
import { FindInChat } from "./FindInChat";
import { ChatNote } from "./ChatNote";
import { FilesTouched } from "./FilesTouched";
import { ResizableSide } from "./ResizableSide";
import type { ExecMode } from "../stores/settings";
import { MAX_ATTACHMENT_BYTES, type AutoApprove, type ChatAttachment } from "../lib/gateway";
import {
  abortAndDropOtherChats,
  attachmentsForChat,
  updateOwnedAttachment,
  type OwnedComposerAttachment,
} from "../lib/chat_attachments";

const DEFAULT_AUTO_APPROVE: AutoApprove = { edit: true, execute: true, web: false, browser: false };

function loadAutoApprove(chatId: string): AutoApprove {
  try {
    const raw = localStorage.getItem(`clawagents:autoApprove:${chatId}`);
    if (!raw) return { ...DEFAULT_AUTO_APPROVE };
    return { ...DEFAULT_AUTO_APPROVE, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_AUTO_APPROVE };
  }
}

function loadCaveman(chatId: string): boolean {
  try {
    return localStorage.getItem(`clawagents:caveman:${chatId}`) === "1";
  } catch {
    return false;
  }
}

interface Props {
  projectId: string | null;
  chatId: string;
}

interface ReplayedMessage {
  role: string;
  content: string;
  tool_call_id?: string | null;
  tool_calls?: Array<{ id: string; name: string; args?: unknown }> | null;
  thinking?: string | null;
  attachments?: ChatAttachment[];
}

interface ComposerAttachment extends OwnedComposerAttachment<ChatAttachment> {
  file: File;
  progress: number;
  error?: string;
}

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Reconstruct the full message tree from the JSONL replay including
 * tool_calls and tool_results. The reducer in the store already merges
 * streaming events; this is the cold-load equivalent.
 */
function rebuildMessages(replayed: ReplayedMessage[]): Message[] {
  const out: Message[] = [];
  const toolIdxById: Record<string, number> = {};

  for (const m of replayed) {
    if (m.role === "user") {
      out.push({ kind: "user_message", content: m.content, attachments: m.attachments });
    } else if (m.role === "assistant") {
      out.push({
        kind: "assistant_message",
        content: m.content,
        thinking: m.thinking ?? undefined,
      });
      if (m.tool_calls && Array.isArray(m.tool_calls)) {
        for (const tc of m.tool_calls) {
          out.push({
            kind: "tool_call",
            id: tc.id,
            name: tc.name,
            args: tc.args ?? {},
            running: false,
          });
          toolIdxById[tc.id] = out.length - 1;
        }
      }
    } else if (m.role === "tool" && m.tool_call_id) {
      const idx = toolIdxById[m.tool_call_id];
      if (idx !== undefined) {
        const t = out[idx] as Extract<Message, { kind: "tool_call" }>;
        out[idx] = { ...t, success: true, result: m.content };
      }
    }
  }

  return out;
}

export function ChatSurface({ projectId, chatId }: Props) {
  const [mode, setMode] = useState<ExecMode>("auto");
  const [model, setModel] = useState<string>("");
  const [title, setTitle] = useState<string>("");
  const [note, setNote] = useState<string>("");
  const messages = useChats((s) => s.messages[chatId] ?? []);
  const streaming = useChats((s) => s.streaming[chatId] ?? false);
  const usage = useChats((s) => s.usage[chatId]);
  const runUsage = useChats((s) => s.lastRunUsage[chatId]);
  const setMessages = useChats((s) => s.setMessages);
  const appendEvent = useChats((s) => s.appendEvent);
  const appendInfo = useChats((s) => s.appendInfo);
  const removeAttachment = useChats((s) => s.removeAttachment);
  const resetUsage = useChats((s) => s.resetUsage);
  const clearLastRunUsage = useChats((s) => s.clearLastRunUsage);
  const setStreaming = useChats((s) => s.setStreaming);
  const localClient = useProjects((s) => s.client);
  const client = useProjectGateway(projectId) ?? localClient;
  const projects = useProjects((s) => s.projects);
  const openShortcuts = useUI((s) => s.openShortcutsModal);
  const pinned = usePinnedResults((s) => s.byChat[chatId] ?? []);
  const pinResult = usePinnedResults((s) => s.pin);
  const unpinResult = usePinnedResults((s) => s.unpin);
  const bookmarks = useBookmarks((s) => s.byChat[chatId] ?? []);
  const toggleBookmark = useBookmarks((s) => s.toggle);
  const filesOpen = useUI((s) => s.filesPanelOpen);
  const toggleFiles = useUI((s) => s.toggleFilesPanel);
  const router = useRouter();
  const abortRef = useRef<AbortController | null>(null);
  const activeChatIdRef = useRef(chatId);
  activeChatIdRef.current = chatId;
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const anchorRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const [draft, setDraft] = useState<string>(() => loadDraft(chatId));
  const [turnStartedAt, setTurnStartedAt] = useState<number | null>(null);
  const [findOpen, setFindOpen] = useState(false);
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [attachmentItems, setAttachmentItems] = useState<ComposerAttachment[]>([]);
  const [autoApprove, setAutoApprove] = useState<AutoApprove>(() => loadAutoApprove(chatId));
  const [caveman, setCaveman] = useState(() => loadCaveman(chatId));
  const [checkpointsOpen, setCheckpointsOpen] = useState(false);
  const [rewindOpen, setRewindOpen] = useState(false);
  const [lastCheckpointTs, setLastCheckpointTs] = useState<number | undefined>();
  const [checkpointTick, setCheckpointTick] = useState(() => Date.now());
  const [compacting, setCompacting] = useState(false);
  const sendQueueRef = useRef<Array<{ content: string; attachments?: ChatAttachment[] }>>([]);
  const activeAttachmentItems = attachmentsForChat(attachmentItems, chatId);
  const uploading = activeAttachmentItems.some((item) => item.status === "uploading");
  const readyAttachments = activeAttachmentItems
    .filter((item): item is ComposerAttachment & { attachment: ChatAttachment } => item.status === "ready" && !!item.attachment)
    .map((item) => item.attachment);
  // Tick once per second while a turn is running so the "elapsed" text refreshes.
  const [, setNowTick] = useState(0);

  // Reset the composer when switching chats — otherwise the draft from the
  // previous chat leaks across. Also stash the current URL path so the next
  // app launch can resume here.
  useEffect(() => {
    setDraft(loadDraft(chatId));
    setAutoApprove(loadAutoApprove(chatId));
    setCaveman(loadCaveman(chatId));
    sendQueueRef.current = [];
    setAttachmentItems((current) => abortAndDropOtherChats(current, chatId).remaining);
    recordVisit(chatId);
    recordLastPath(window.location.pathname);
  }, [chatId]);

  useEffect(() => {
    if (!projectId) return;
    const project = projects.find((p) => p.id === projectId);
    if (!project) return;
    void ensureProjectClient(project).catch((e) => {
      pushToast(`SSH connect failed: ${formatErr(e)}`, "error");
    });
  }, [projectId, projects]);

  useEffect(() => {
    try {
      localStorage.setItem(`clawagents:autoApprove:${chatId}`, JSON.stringify(autoApprove));
    } catch { /* ignore */ }
  }, [chatId, autoApprove]);

  useEffect(() => {
    try {
      localStorage.setItem(`clawagents:caveman:${chatId}`, caveman ? "1" : "0");
    } catch { /* ignore */ }
  }, [chatId, caveman]);

  // Persist on every keystroke. localStorage writes are cheap (<1ms).
  useEffect(() => {
    saveDraft(chatId, draft);
  }, [chatId, draft]);

  // 1Hz ticker only while streaming so the elapsed-time label refreshes.
  useEffect(() => {
    if (!streaming) return;
    const id = setInterval(() => setNowTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [streaming]);

  // Quietly prefetch checkpoints so the header chip can show "last at …".
  useEffect(() => {
    if (!client) return;
    let cancelled = false;
    void client.listCheckpoints(chatId)
      .then((data) => {
        if (cancelled || !Array.isArray(data)) return;
        let best: number | undefined;
        for (const row of data) {
          const ts = checkpointTs(row as Record<string, unknown>);
          if (ts != null && (best == null || ts > best)) best = ts;
        }
        setLastCheckpointTs(best);
      })
      .catch(() => { /* ignore */ });
    return () => { cancelled = true; };
  }, [client, chatId, messages.length]);

  useEffect(() => {
    if (lastCheckpointTs == null) return;
    const id = window.setInterval(() => setCheckpointTick(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, [lastCheckpointTs]);

  // Track compact_progress from the live transcript for a header chip.
  useEffect(() => {
    const last = [...messages].reverse().find((m) => m.kind === "compact_progress");
    if (!last || last.kind !== "compact_progress") return;
    const phase = (last.phase || "").toLowerCase();
    setCompacting(phase !== "" && phase !== "done" && phase !== "skipped" && phase !== "error");
  }, [messages]);

  const lastCheckpointLabel = formatCheckpointWhen(lastCheckpointTs, checkpointTick);

  // Load existing messages on mount.
  useEffect(() => {
    if (!client) return;
    (async () => {
      const meta = await client.getChat(chatId);
      setTitle(meta.title);
      setNote(meta.note ?? "");
      if (meta.model) setModel(meta.model);
      if (meta.mode) setMode(meta.mode as ExecMode);

      const replayed = await client.getChatMessages(chatId);
      setMessages(chatId, rebuildMessages(replayed as ReplayedMessage[]));

      // Replay usage events so the badge + auto-compact hint show real
      // numbers right after a chat is opened, not only after a fresh turn.
      // Reset first so a re-open of the same chat doesn't double-count.
      resetUsage(chatId);
      try {
        const events = await client.getChatEvents(chatId);
        // Apply oldest-first so accumulator + last_input_tokens are correct.
        for (let i = events.length - 1; i >= 0; i--) {
          const ev = events[i];
          if (ev.type === "usage") {
            appendEvent(chatId, {
              kind: "usage",
              input_tokens: Number(ev.input_tokens) || 0,
              output_tokens: Number(ev.output_tokens) || 0,
              total_tokens: Number(ev.total_tokens) || 0,
              cached_input_tokens: Number(ev.cached_input_tokens) || 0,
              cache_creation_tokens: Number(ev.cache_creation_tokens) || 0,
              model: typeof ev.model === "string" ? ev.model : undefined,
            });
          }
        }
        // Historical replay must not look like an in-flight run.
        clearLastRunUsage(chatId);
      } catch {
        // best-effort — badge just stays empty if events fetch fails
      }
    })();
  }, [client, chatId, setMessages, appendEvent, resetUsage, clearLastRunUsage]);

  // Auto-scroll to bottom whenever messages change (new tokens, tool results,
  // permission prompts). Skipped while the user has scrolled up — pinning the
  // viewport to the bottom only when they were already there. Also reveals a
  // floating "↓ jump to latest" button while the user is scrolled away.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (distanceFromBottom < 200) {
      el.scrollTop = el.scrollHeight;
      setShowScrollBtn(false);
    } else {
      setShowScrollBtn(true);
    }
  }, [messages]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    function onScroll(): void {
      if (!el) return;
      const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
      setShowScrollBtn(dist > 200);
    }
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  // Esc cancels a running stream. Bound here (not in the global layout) so
  // the cancel applies to the chat the user is currently viewing.
  useShortcuts([
    {
      key: "Escape",
      description: "Cancel streaming / close find",
      handler: async () => {
        if (findOpen) { setFindOpen(false); return; }
        if (!streaming || !client) return;
        sendQueueRef.current = [];
        abortRef.current?.abort();
        try {
          await client.cancelChat(chatId);
        } catch {
          // best-effort
        }
      },
    },
    {
      key: "f",
      meta: true,
      description: "Find in this chat",
      handler: () => setFindOpen(true),
    },
  ]);

  async function compactNow() {
    if (!client || compacting) return;
    setCompacting(true);
    try {
      const result = await client.compactChat(chatId);
      if (!result.compacted) {
        appendInfo(chatId, `Compact skipped: ${result.reason ?? "unknown"}`);
        return;
      }
      const replayed = await client.getChatMessages(chatId);
      setMessages(chatId, rebuildMessages(replayed as ReplayedMessage[]));
      appendInfo(chatId, `Compacted ${result.summary_chars ?? 0} chars. Backup at ${result.backup_path ?? "(none)"}.`);
    } catch (e) {
      appendEvent(chatId, { kind: "error", message: `Compact failed: ${(e as Error).message}` });
    } finally {
      setCompacting(false);
    }
  }

  async function downloadBlob(content: string, mime: string, filename: string): Promise<void> {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  async function exportChat() {
    if (!client) return;
    const md = await client.exportChatMarkdown(chatId);
    await downloadBlob(md, "text/markdown", `${chatId}.md`);
  }

  async function handleRetry(newContent: string, attachments?: ChatAttachment[]) {
    if (!client) return;
    try {
      await client.truncateAfterLastUserMessage(chatId);
    } catch (e) {
      appendEvent(chatId, { kind: "error", message: `Retry failed to truncate: ${(e as Error).message}` });
      return;
    }
    // Refresh local message list from server to reflect the truncation,
    // then send the edited prompt as a brand-new turn.
    try {
      const replayed = await client.getChatMessages(chatId);
      setMessages(chatId, rebuildMessages(replayed as ReplayedMessage[]));
    } catch {
      // ignore; subsequent send will overlay
    }
    await handleSend(newContent, attachments);
  }

  // Identify the index of the last user_message so only that one gets the
  // edit affordance — historical user turns are immutable.
  let lastUserIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].kind === "user_message") { lastUserIdx = i; break; }
  }
  // Identify the LAST assistant_message so it (alone) gets the Regenerate
  // affordance. Regenerate re-runs the last user message verbatim.
  let lastAssistantIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].kind === "assistant_message") { lastAssistantIdx = i; break; }
  }

  async function handleSend(content: string, attachmentOverride?: ChatAttachment[]) {
    if (!client) return;
    // Mid-turn redirect (VS Code interject) — don't queue a second stream.
    if ((streaming || abortRef.current) && !content.startsWith("/")) {
      try {
        const res = await client.interjectChat(chatId, content);
        if (res.ok && res.queued > 0) {
          clearDraft(chatId);
          appendInfo(chatId, `Interjected: ${content.slice(0, 80)}${content.length > 80 ? "…" : ""}`);
          return;
        }
      } catch {
        /* fall through to queue */
      }
      sendQueueRef.current.push({ content, attachments: attachmentOverride });
      appendInfo(chatId, `Queued: ${content.slice(0, 80)}${content.length > 80 ? "…" : ""}`);
      return;
    }
    if (streaming || abortRef.current) {
      sendQueueRef.current.push({ content, attachments: attachmentOverride });
      appendInfo(chatId, `Queued: ${content.slice(0, 80)}${content.length > 80 ? "…" : ""}`);
      return;
    }
    // Clear the draft as soon as the user commits.
    clearDraft(chatId);

    // Intercept slash commands before opening any stream — they're local to
    // the desktop and never reach the agent.
    if (content.startsWith("/")) {
      const handled = await tryRunSlashCommand(content, {
        chatId,
        clearMessages: () => setMessages(chatId, []),
        exportChat,
        openShortcuts,
        openCheckpoints: () => setCheckpointsOpen(true),
        openRewind: () => setRewindOpen(true),
        patchChat: async (body) => {
          await client.patchChat(chatId, body);
          if (body.mode) setMode(body.mode as ExecMode);
          if (body.model !== undefined) setModel(body.model);
          if (body.title !== undefined) setTitle(body.title);
        },
        forkChat: async () => {
          const forked = await client.forkChat(chatId);
          if (forked.project_id) {
            router.navigate({ to: "/project/$id/chat/$cid", params: { id: forked.project_id, cid: forked.chat_id } });
          } else {
            router.navigate({ to: "/chat/$cid", params: { cid: forked.chat_id } });
          }
        },
        compactChat: compactNow,
        openTrash: () => router.navigate({ to: "/trash" } as any),
        refreshChat: async () => {
          try {
            const replayed = await client.getChatMessages(chatId);
            setMessages(chatId, rebuildMessages(replayed as ReplayedMessage[]));
            appendInfo(chatId, "Refreshed from disk.");
          } catch (e) {
            appendEvent(chatId, { kind: "error", message: `Refresh failed: ${(e as Error).message}` });
          }
        },
        uncompactChat: async () => {
          try {
            const backups = await client.listCompactBackups(chatId);
            if (backups.length === 0) {
              appendInfo(chatId, "No /compact backups for this chat.");
              return;
            }
            const newest = backups[0];
            const at = new Date(newest.ts * 1000).toLocaleString();
            if (!window.confirm(`Restore pre-compact backup from ${at}? Current chat will be saved separately.`)) return;
            const result = await client.restoreCompactBackup(chatId, newest.suffix);
            const replayed = await client.getChatMessages(chatId);
            setMessages(chatId, rebuildMessages(replayed as ReplayedMessage[]));
            appendInfo(chatId, `Restored. Pre-restore copy at ${result.safety_backup}.`);
          } catch (e) {
            appendEvent(chatId, { kind: "error", message: `Restore failed: ${(e as Error).message}` });
          }
        },
        showGitStatus: projectId ? async () => {
          try {
            const r = await client.projectGitStatus(projectId);
            if (!r.is_repo) {
              appendInfo(chatId, `Not a git repository${r.error ? ` (${r.error})` : ""}.`);
              return;
            }
            const parts: string[] = [`On branch ${r.branch}`];
            if (r.status?.trim()) parts.push("", "Status:", r.status.trim());
            if (r.diff?.trim()) parts.push("", "Diff:", r.diff.trim());
            else parts.push("", "Working tree clean.");
            if (r.status_truncated || r.diff_truncated) parts.push("", "(output truncated)");
            appendInfo(chatId, parts.join("\n"));
          } catch (e) {
            appendEvent(chatId, { kind: "error", message: `Git status failed: ${(e as Error).message}` });
          }
        } : undefined,
        getUsage: () => usage,
        getCustomCommands: () => useCustomCommands.getState().commands.map((c) => ({ name: c.name, description: c.description })),
        appendError: (msg) => appendEvent(chatId, { kind: "error", message: msg }),
        appendInfo: (msg) => appendInfo(chatId, msg),
      });
      if (handled) return;
      // Check user-defined commands second so they can't shadow built-ins.
      const cmdName = content.slice(1).split(/\s+/)[0];
      const custom = useCustomCommands.getState().commands.find((c) => c.name === cmdName);
      if (custom) {
        // Replace the user's `/cmd` with the command body and send as a
        // regular agent turn.
        const args = content.slice(1 + cmdName.length).trim();
        content = args ? `${custom.body}\n\n${args}` : custom.body;
      } else {
        appendInfo(chatId, `Unknown slash command. Try /help.`);
        return;
      }
    }

    const userVisibleContent = content;
    const sentAttachments = attachmentOverride ?? readyAttachments;
    const attachmentIds = sentAttachments.map((attachment) => attachment.id);
    if (!attachmentOverride && attachmentIds.length > 0) {
      setAttachmentItems((current) => current.filter((item) => item.status !== "ready"));
    }

    setStreaming(chatId, true);

    // Auto-title the chat from the first user message. Phase 1: an instant
    // heuristic title goes in immediately so the sidebar isn't full of "New
    // chat". Phase 2 (after the turn completes) asks the LLM for a tighter
    // title — see below.
    const isFirstSend = messages.length === 0 && (title === "" || title === "New chat");
    if (isFirstSend) {
      const derived = userVisibleContent.trim().split(/\s+/).slice(0, 12).join(" ").slice(0, 60);
      if (derived) {
        setTitle(derived);
        client.patchChat(chatId, { title: derived }).catch(() => {
          // Best-effort. The chat still works; only the title fails to
          // persist if the gateway hiccups here.
        });
      }
    }

    // Optimistic user-message bubble. The gateway also emits user_message
    // via the agent; we filter that echo out below to avoid duplicates.
    appendEvent(chatId, { kind: "user_message", content: userVisibleContent, attachments: sentAttachments });

    // "Auto" (empty model_override below) makes the backend resolve the
    // model from its saved app settings. A Settings save that's still in
    // flight (e.g. switching the default provider/model) hasn't landed on
    // disk yet, so without this the turn could silently run against the
    // about-to-be-overwritten prior settings. A pinned model_override isn't
    // affected — it's sent explicitly regardless of what Settings has saved.
    if (!model) {
      await awaitPendingSettingsSave();
    }

    const startedAt = Date.now();
    setTurnStartedAt(startedAt);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      await streamMessages(
        `${client.baseUrl}/chats/${chatId}/messages`,
        client.bearerToken,
        {
          content: userVisibleContent,
          model_override: model || undefined,
          mode_override: mode,
          attachment_ids: attachmentIds.length > 0 ? attachmentIds : undefined,
          auto_approve: autoApprove,
          caveman,
          interaction: "interactive",
        },
        ctrl.signal,
        (ev) => {
          // Skip the gateway's user_message echo since we already rendered it.
          if (ev.kind === "user_message") return;
          if (ev.kind === "permission_required") {
            playPermissionBell();
            void notifyPermissionRequested({
              chatTitle: title || "Chat",
              tool: ev.tool,
              filePath: ev.file_path,
            });
          }
          appendEvent(chatId, ev);
        },
      );
    } catch (e) {
      appendEvent(chatId, { kind: "error", message: (e as Error).message });
    } finally {
      setStreaming(chatId, false);
      setTurnStartedAt(null);
      abortRef.current = null;
      // Drain one queued message if any.
      const next = sendQueueRef.current.shift();
      if (next) {
        void handleSend(next.content, next.attachments);
      }
      // If the turn ran longer than ~8s, the user has probably alt-tabbed
      // away. Notify so they don't miss the result.
      const elapsedMs = Date.now() - startedAt;
      if (elapsedMs >= 8000) {
        const last = useChats.getState().messages[chatId]?.slice(-1)[0];
        const preview =
          last?.kind === "assistant_message" ? last.content :
          last?.kind === "error" ? `Error: ${last.message}` :
          undefined;
        void notifyTurnComplete({ chatTitle: title || "Chat", preview });
        playCompletionChime();
      }
      // After the first turn finishes, replace the heuristic title with an
      // LLM-suggested one. Best-effort: failure leaves the heuristic.
      if (isFirstSend) {
        void (async () => {
          try {
            const result = await client.autoTitleChat(chatId);
            if (result.changed && result.title) setTitle(result.title);
          } catch { /* ignore */ }
        })();
      }
    }
  }

  function insertMention(path: string) {
    // Insert "@path " at the end of the current draft (with leading space if
    // the draft is non-empty and doesn't already end with whitespace).
    const sep = draft.length === 0 || /\s$/.test(draft) ? "" : " ";
    setDraft(`${draft}${sep}@${path} `);
  }

  function removeAttachmentItem(localId: string): void {
    setAttachmentItems((current) => {
      const item = current.find((candidate) => candidate.localId === localId);
      item?.abort?.abort();
      return current.filter((candidate) => candidate.localId !== localId);
    });
  }

  async function uploadOneAttachment(item: ComposerAttachment): Promise<void> {
    if (!client) return;
    const abort = new AbortController();
    setAttachmentItems((current) => updateOwnedAttachment(
      current, activeChatIdRef.current, item.ownerChatId, item.localId,
      (candidate) => ({ ...candidate, status: "uploading", progress: 0, error: undefined, abort }),
    ));
    try {
      const attachment = await client.uploadChatAttachment(item.ownerChatId, item.file, {
        signal: abort.signal,
        onProgress: (progress) => {
          setAttachmentItems((current) => updateOwnedAttachment(
            current, activeChatIdRef.current, item.ownerChatId, item.localId,
            (candidate) => ({ ...candidate, progress }),
          ));
        },
      });
      setAttachmentItems((current) => updateOwnedAttachment(
        current, activeChatIdRef.current, item.ownerChatId, item.localId,
        (candidate) => ({ ...candidate, status: "ready", progress: 100, attachment, abort: undefined }),
      ));
      if (activeChatIdRef.current === item.ownerChatId) {
        appendInfo(item.ownerChatId, `Attached ${attachment.filename}.`);
      }
    } catch (e) {
      const message = (e as Error).name === "AbortError" ? "Upload cancelled" : (e as Error).message;
      setAttachmentItems((current) => updateOwnedAttachment(
        current, activeChatIdRef.current, item.ownerChatId, item.localId,
        (candidate) => ({ ...candidate, status: "error", error: message, abort: undefined }),
      ));
    }
  }

  async function uploadFiles(files: File[]): Promise<void> {
    if (!client || files.length === 0) return;
    const items: ComposerAttachment[] = files.map((file, index) => ({
      localId: `${Date.now()}-${index}-${file.name}`,
      ownerChatId: chatId,
      file,
      status: file.size > MAX_ATTACHMENT_BYTES ? "error" : "uploading",
      progress: 0,
      error: file.size > MAX_ATTACHMENT_BYTES ? `File exceeds ${formatBytes(MAX_ATTACHMENT_BYTES)} limit` : undefined,
    }));
    setAttachmentItems((current) => [...current, ...items]);
    await Promise.all(items.filter((item) => item.status === "uploading").map((item) => uploadOneAttachment(item)));
  }

  async function revealAttachment(attachment: ChatAttachment): Promise<void> {
    if (!client) return;
    try {
      await client.revealFolder(attachment.path);
    } catch (e) {
      appendEvent(chatId, { kind: "error", message: `Reveal failed: ${(e as Error).message}` });
    }
  }

  async function downloadAttachment(attachment: ChatAttachment): Promise<void> {
    if (!client) return;
    try {
      const blob = await client.downloadChatAttachment(chatId, attachment.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = attachment.filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      appendEvent(chatId, { kind: "error", message: `Download failed: ${(e as Error).message}` });
    }
  }

  async function deleteAttachment(attachment: ChatAttachment): Promise<void> {
    if (!client) return;
    try {
      await client.deleteChatAttachment(chatId, attachment.id);
      removeAttachment(chatId, attachment.id);
      appendInfo(chatId, `Deleted attachment ${attachment.filename}.`);
    } catch (e) {
      appendEvent(chatId, { kind: "error", message: `Delete failed: ${(e as Error).message}` });
    }
  }

  return (
    <div className="flex h-full">
      <div className="flex flex-col flex-1 min-w-0">
      <div className="border-b border-gray-200 dark:border-gray-800 px-4 py-2 flex flex-wrap items-center justify-between gap-y-2 gap-x-3">
        <div className="text-sm text-gray-700 dark:text-gray-200 flex items-center gap-2 min-w-0">
          {editingTitle ? (
            <input
              autoFocus
              type="text"
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              onBlur={async () => {
                const next = titleDraft.trim();
                setEditingTitle(false);
                if (!client || !next || next === title) return;
                try {
                  await client.patchChat(chatId, { title: next });
                  setTitle(next);
                } catch (e) {
                  appendEvent(chatId, { kind: "error", message: `Rename failed: ${(e as Error).message}` });
                }
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); (e.target as HTMLInputElement).blur(); }
                else if (e.key === "Escape") { e.preventDefault(); setEditingTitle(false); }
              }}
              className="px-1 py-0.5 text-sm bg-white dark:bg-gray-900 dark:text-gray-100 border border-gray-300 dark:border-gray-600 rounded min-w-[12ch]"
            />
          ) : (
            <button
              onClick={() => { setTitleDraft(title); setEditingTitle(true); }}
              title="Click to rename"
              className="truncate hover:text-gray-900 dark:hover:text-gray-50"
            >
              {title || "Chat"}
            </button>
          )}
          {projectId && <span className="text-xs text-gray-400">· in project</span>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setCheckpointsOpen(true)}
            title={
              lastCheckpointLabel
                ? `Last checkpoint ${lastCheckpointLabel} — open restore panel`
                : "No checkpoints yet. They appear after the agent writes files. Click to open panel."
            }
            className={
              "text-xs px-2 py-1 border rounded shrink-0 " +
              (checkpointsOpen
                ? "border-gray-400 bg-gray-100 text-gray-800 dark:border-gray-500 dark:bg-gray-700 dark:text-gray-100"
                : "border-gray-300 bg-white text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800")
            }
          >
            Checkpoints
            <span className="ml-1 text-[10px] text-gray-400 dark:text-gray-500">
              {lastCheckpointLabel ?? "none"}
            </span>
          </button>
          <CompactChip
            usage={usage}
            modelOverride={model || undefined}
            compacting={compacting}
            onCompact={() => void compactNow()}
          />
          <UsageBadge usage={usage} runUsage={runUsage} modelOverride={model || undefined} />
          {projectId && (
            <button
              onClick={toggleFiles}
              title={filesOpen ? "Hide file tree" : "Show project files"}
              className={
                "text-xs px-2 py-1 border rounded shrink-0 " +
                (filesOpen
                  ? "border-gray-400 bg-gray-100 text-gray-800 dark:border-gray-500 dark:bg-gray-700 dark:text-gray-100"
                  : "border-gray-300 bg-white text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800")
              }
            >
              Files
            </button>
          )}
          {messages.length > 0 && client && (
            <>
              <button
                onClick={async () => {
                  try { await exportChat(); }
                  catch (e) {
                    appendEvent(chatId, { kind: "error", message: `Export failed: ${(e as Error).message}` });
                  }
                }}
                title="Download chat as Markdown"
                className="text-xs px-2 py-1 border border-gray-300 bg-white text-gray-600 rounded hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800"
              >
                Export
              </button>
              <button
                onClick={async () => {
                  try {
                    const forked = await client.forkChat(chatId);
                    if (forked.project_id) {
                      router.navigate({ to: "/project/$id/chat/$cid", params: { id: forked.project_id, cid: forked.chat_id } });
                    } else {
                      router.navigate({ to: "/chat/$cid", params: { cid: forked.chat_id } });
                    }
                  } catch (e) {
                    appendEvent(chatId, { kind: "error", message: `Fork failed: ${(e as Error).message}` });
                  }
                }}
                title="Fork — make an independent copy of this chat"
                className="text-xs px-2 py-1 border border-gray-300 bg-white text-gray-600 rounded hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800"
              >
                Fork
              </button>
            </>
          )}
          {streaming && (
            <>
              {turnStartedAt !== null && (
                (() => {
                  const elapsed = Math.floor((Date.now() - turnStartedAt) / 1000);
                  if (elapsed < 2) return null;
                  const slow = elapsed >= 15;
                  return (
                    <span
                      className={
                        "text-xs px-2 py-0.5 rounded border " +
                        (slow
                          ? "bg-yellow-50 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-200 border-yellow-300 dark:border-yellow-800 animate-pulse"
                          : "bg-blue-50 dark:bg-blue-900/40 text-blue-700 dark:text-blue-200 border-blue-200 dark:border-blue-800")
                      }
                      title={slow ? "Turn is taking a while — agent might be in a long tool call" : "Streaming"}
                    >
                      ⟳ {elapsed}s
                    </span>
                  );
                })()
              )}
              <button
                onClick={async () => {
                  if (!client) return;
                  sendQueueRef.current = [];
                  abortRef.current?.abort();
                  try {
                    await client.cancelChat(chatId);
                  } catch {
                    // best-effort; the abort already stopped the SSE stream
                  }
                }}
                className="text-xs px-2 py-1 border border-red-300 bg-red-50 text-red-700 rounded hover:bg-red-100 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200 dark:hover:bg-red-900/40"
              >
                Cancel
              </button>
            </>
          )}
          <ModelPicker
            value={model}
            projectId={projectId}
            onChange={(next) => {
              if (next === model) return;
              setModel(next);
              appendInfo(chatId, `Model set to ${next}.`);
              // Persist so the picker survives reloads and downstream
              // features (cost preview, context-window meter) use the right
              // model. Best-effort — local state is already right.
              if (client) {
                client.patchChat(chatId, { model: next }).catch(() => { /* ignore */ });
              }
            }}
          />
        </div>
      </div>
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-4 relative scroll-smooth">
        {showScrollBtn && (
          <button
            onClick={() => {
              const el = scrollRef.current;
              if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
            }}
            title="Jump to latest"
            className="sticky bottom-2 left-full -translate-x-2 z-10 ml-auto block w-8 h-8 rounded-full bg-gray-900 text-white shadow-lg hover:bg-gray-700 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-gray-300"
          >
            ↓
          </button>
        )}
        <FindInChat
          open={findOpen}
          messages={messages}
          onClose={() => setFindOpen(false)}
          onJump={(idx) => {
            const el = anchorRefs.current[idx];
            if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
          }}
        />
        <ChatNote chatId={chatId} initialNote={note} projectId={projectId} />
        <FilesTouched messages={messages} projectId={projectId} />
        {pinned.length > 0 && (
          <div className="sticky top-0 z-10 -mx-6 px-6 pb-2 mb-3 bg-white/95 dark:bg-gray-950/95 backdrop-blur border-b border-gray-200 dark:border-gray-800">
            <div className="text-[10px] uppercase tracking-wide text-gray-400 mt-1 mb-1">📌 Pinned</div>
            {pinned.map((p) => (
              <ToolCall
                key={`pinned-${p.id}`}
                name={p.name}
                args={p.args}
                running={false}
                success={p.success}
                result={p.result}
                pinned
                onPinToggle={() => unpinResult(chatId, p.id)}
                projectId={projectId}
              />
            ))}
          </div>
        )}
        {messages.map((m, i) => {
          const child = (() => {
          if (m.kind === "user_message") {
            return (
              <UserMessage
                key={i}
                content={m.content}
                onRetry={i === lastUserIdx && !streaming ? handleRetry : undefined}
                bookmarked={bookmarks.includes(i)}
                onToggleBookmark={() => toggleBookmark(chatId, i)}
                attachments={m.attachments}
                onRevealAttachment={(attachment) => { void revealAttachment(attachment); }}
                onDownloadAttachment={(attachment) => { void downloadAttachment(attachment); }}
                onDeleteAttachment={(attachment) => { void deleteAttachment(attachment); }}
              />
            );
          }
          if (m.kind === "assistant_message") {
            const canRegen = !streaming && i === lastAssistantIdx && lastUserIdx >= 0 && lastUserIdx < i;
            const lastUser = canRegen ? (messages[lastUserIdx] as Extract<Message, { kind: "user_message" }>) : null;
            return (
              <AssistantMessage
                key={i}
                content={m.content}
                thinking={m.thinking}
                projectId={projectId}
                onRegenerate={lastUser ? () => handleRetry(lastUser.content) : undefined}
              />
            );
          }
          if (m.kind === "error") {
            // Only the most recent error gets a Retry button, and only when a
            // last-user-message exists and we aren't already streaming.
            const isLastError = !streaming && i === messages.length - 1;
            const lastUser = lastUserIdx >= 0 ? (messages[lastUserIdx] as Extract<Message, { kind: "user_message" }>) : null;
            const canRetry = isLastError && lastUser !== null;
            return (
              <ErrorMessage
                key={i}
                message={m.message}
                onRetry={canRetry ? () => handleRetry(lastUser!.content) : undefined}
              />
            );
          }
          if (m.kind === "info") return <InfoMessage key={i} message={m.message} />;
          if (m.kind === "tool_call") {
            const isPinned = pinned.some((p) => p.id === m.id);
            return (
              <ToolCall
                key={i}
                name={m.name}
                args={m.args}
                running={m.running}
                success={m.success}
                result={m.result}
                startedAt={m.startedAt}
                elapsedMs={m.elapsedMs}
                pinned={isPinned}
                onPinToggle={
                  m.result
                    ? () => isPinned
                        ? unpinResult(chatId, m.id)
                        : pinResult(chatId, { id: m.id, name: m.name, args: m.args, result: m.result!, success: m.success })
                    : undefined
                }
                projectId={projectId}
              />
            );
          }
          if (m.kind === "permission_required") {
            return (
              <PermissionPrompt
                key={i}
                request_id={m.request_id}
                tool={m.tool}
                file_path={m.file_path}
                reason={m.reason}
                projectId={projectId}
                resolved={m.resolved}
                onResolve={async (decision) => {
                  if (!client) return;
                  await client.resolvePermission(m.request_id, decision);
                  useChats.getState().resolvePermission(chatId, m.request_id, decision);
                }}
              />
            );
          }
          if (m.kind === "plan_approval_required") {
            return (
              <PlanApprovalPrompt
                key={i}
                request_id={m.request_id}
                plan_text={m.plan_text}
                resolved={m.resolved}
                onResolve={async (decision, comment) => {
                  if (!client) return;
                  await client.resolvePlanApproval(m.request_id, decision, comment || "");
                  useChats.getState().resolvePlanApproval(chatId, m.request_id, decision);
                }}
              />
            );
          }
          if (m.kind === "ask_user_required") {
            return (
              <AskUserPrompt
                key={i}
                requestId={m.request_id}
                question={m.question}
                resolved={m.resolved}
                answer={m.answer}
                onReply={async (answer, skip) => {
                  if (!client) return;
                  await client.resolveAskUser(m.request_id, answer, skip);
                  useChats.getState().resolveAskUser(chatId, m.request_id, skip ? null : answer);
                }}
              />
            );
          }
          if (m.kind === "file_changed") {
            return (
              <div key={i} className="mb-2 text-xs border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/30 rounded px-2 py-1.5 flex items-center gap-2">
                <span className="text-emerald-800 dark:text-emerald-200">Changed <code className="font-mono">{m.path}</code></span>
                {m.snapshot_id && client && (
                  <button
                    type="button"
                    className="underline text-emerald-700 dark:text-emerald-300"
                    onClick={() => {
                      void client.restoreSnapshot(chatId, m.snapshot_id!, m.path).then(
                        () => appendInfo(chatId, `Restored ${m.path} from snapshot`),
                        (e) => appendEvent(chatId, { kind: "error", message: (e as Error).message }),
                      );
                    }}
                  >
                    Restore
                  </button>
                )}
              </div>
            );
          }
          if (m.kind === "checkpoint") {
            return (
              <div key={i} className="mb-2 text-xs text-gray-500 dark:text-gray-400">
                Checkpoint {m.sha ? m.sha.slice(0, 10) : ""}{m.label ? ` · ${m.label}` : m.tool ? ` · ${m.tool}` : ""}
              </div>
            );
          }
          if (m.kind === "compact_progress") {
            return (
              <div key={i} className="mb-2 inline-flex items-center gap-1 rounded-full border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 px-2 py-0.5 text-[11px] text-amber-800 dark:text-amber-200">
                Compacting{m.phase ? `: ${m.phase}` : ""}{m.message ? ` — ${m.message}` : ""}
              </div>
            );
          }
          return null;
          })();
          return (
            <div
              key={i}
              ref={(el) => { anchorRefs.current[i] = el; }}
              className={m.kind === "tool_call" ? "ml-4 scroll-mt-24" : "scroll-mt-24"}
            >
              {child}
            </div>
          );
        })}
        {messages.length === 0 && (
          <div className="mx-auto flex min-h-[55vh] max-w-2xl flex-col items-center justify-center px-6 py-12 text-center">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl border border-gray-200 bg-gray-50 text-2xl dark:border-gray-800 dark:bg-gray-900" aria-hidden>💬</div>
            <h2 className="mb-2 text-base font-semibold text-gray-900 dark:text-gray-100">
              {projectId ? "Start with project context" : "Start a scratch chat"}
            </h2>
            <p className="mb-5 max-w-md text-sm leading-6 text-gray-500 dark:text-gray-400">
              {projectId
                ? "Ask about the codebase, run a quick check, or hand the agent a focused edit."
                : "The agent runs in a private scratch folder, useful for questions and experiments."}
            </p>
            <div className="w-full max-w-md text-xs leading-relaxed">
              <div className="grid gap-2">
                {(projectId
                  ? [
                      "What does this project do?",
                      "List the files in src/",
                      "Fix the failing test in foo.py",
                    ]
                  : [
                      "Write a 2-line poem about debugging.",
                      "What's the difference between a thread and a process?",
                      "Suggest a name for a new project.",
                    ]
                ).map((s) => (
                  <button
                    key={s}
                    onClick={() => {
                      setDraft(s);
                      requestAnimationFrame(() => {
                        document.querySelector<HTMLTextAreaElement>("textarea[data-composer]")?.focus();
                      });
                    }}
                    className="rounded-md border border-gray-200 bg-white px-3 py-2 text-left text-gray-700 shadow-sm hover:border-gray-300 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800"
                  >
                    {s}
                  </button>
                ))}
              </div>
              <p className="mt-3 text-gray-400">
                Type <code className="bg-gray-100 dark:bg-gray-800 px-1 rounded">/help</code> for slash commands.
              </p>
            </div>
          </div>
        )}
      </div>
      <div className="shrink-0 border-t border-gray-200 bg-white/95 px-4 py-3 shadow-[0_-8px_24px_rgba(15,23,42,0.04)] backdrop-blur dark:border-gray-800 dark:bg-gray-950/95">
        <AutoApproveBar
          value={autoApprove}
          onChange={setAutoApprove}
          caveman={caveman}
          onCavemanChange={setCaveman}
          disabled={streaming}
        />
        {activeAttachmentItems.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2 text-xs">
            {activeAttachmentItems.map((item) => (
              <span
                key={item.localId}
                className={
                  "inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-1 " +
                  (item.status === "error"
                    ? "border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200"
                    : "border-gray-200 bg-gray-50 text-gray-700 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200")
                }
              >
                <span className="max-w-[12rem] truncate">{item.attachment?.filename ?? item.file.name}</span>
                <span className="shrink-0 text-gray-400">
                  {item.status === "ready" && item.attachment
                    ? `${item.attachment.kind} · ${formatBytes(item.attachment.size)}`
                    : item.status === "uploading"
                      ? `${item.progress}%`
                      : item.error}
                </span>
                {item.status === "uploading" && (
                  <span className="h-1 w-14 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-800">
                    <span className="block h-full bg-blue-500" style={{ width: `${item.progress}%` }} />
                  </span>
                )}
                {item.status === "error" && (
                  <button
                    type="button"
                    className="ml-1 rounded-full px-1 text-gray-500 hover:bg-red-100 hover:text-red-800 dark:hover:bg-red-900/50"
                    onClick={() => { void uploadOneAttachment(item); }}
                  >
                    retry
                  </button>
                )}
                <button
                  type="button"
                  aria-label={`Remove ${item.attachment?.filename ?? item.file.name}`}
                  className="ml-1 rounded-full px-1 text-gray-400 hover:bg-gray-200 hover:text-gray-700 dark:hover:bg-gray-800 dark:hover:text-gray-100"
                  onClick={() => removeAttachmentItem(item.localId)}
                >
                  {item.status === "uploading" ? "cancel" : "x"}
                </button>
              </span>
            ))}
          </div>
        )}
        <Composer
          onSend={handleSend}
          disabled={streaming || uploading}
          leftSlot={
            <ModeChip
              mode={mode}
              onChange={(next) => {
                if (next === mode) return;
                setMode(next);
                appendInfo(chatId, `Mode set to ${next}.`);
                if (client) {
                  client.patchChat(chatId, { mode: next }).catch(() => { /* ignore */ });
                }
              }}
            />
          }
          projectId={projectId}
          value={draft}
          onChange={setDraft}
          history={messages.filter((m): m is Extract<Message, { kind: "user_message" }> => m.kind === "user_message").map((m) => m.content)}
          model={model || undefined}
          onFilesSelected={(files) => { void uploadFiles(files); }}
          canSendEmpty={readyAttachments.length > 0}
          emptySendContent="Analyze the attached files."
        />
      </div>
      </div>
      {filesOpen && projectId && (
        <ResizableSide storageKey="clawagents:width:files" defaultWidth={256} edge="left">
          <FileTreePanel projectId={projectId} onInsertPath={insertMention} />
        </ResizableSide>
      )}
      <CheckpointsPanel chatId={chatId} projectId={projectId} open={checkpointsOpen} onClose={() => setCheckpointsOpen(false)} />
      <RewindPanel
        chatId={chatId}
        projectId={projectId}
        open={rewindOpen}
        onClose={() => setRewindOpen(false)}
        onRestored={() => {
          void (async () => {
            if (!client) return;
            try {
              const replayed = await client.getChatMessages(chatId);
              setMessages(chatId, rebuildMessages(replayed as ReplayedMessage[]));
            } catch {
              /* ignore */
            }
          })();
        }}
      />
    </div>
  );
}
