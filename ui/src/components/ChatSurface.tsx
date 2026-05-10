import { useEffect, useRef, useState } from "react";
import { useChats, type Message } from "../stores/chats";
import { useProjects } from "../stores/projects";
import { streamMessages } from "../lib/stream";
import { Composer } from "./Composer";
import { ModeChip } from "./ModeChip";
import { ModelPicker } from "./ModelPicker";
import { UserMessage } from "./Message/UserMessage";
import { AssistantMessage } from "./Message/AssistantMessage";
import { ErrorMessage } from "./Message/ErrorMessage";
import { ToolCall } from "./Message/ToolCall";
import { PermissionPrompt } from "./Message/PermissionPrompt";
import type { ExecMode } from "../stores/settings";

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
      out.push({ kind: "user_message", content: m.content });
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
  const messages = useChats((s) => s.messages[chatId] ?? []);
  const streaming = useChats((s) => s.streaming[chatId] ?? false);
  const setMessages = useChats((s) => s.setMessages);
  const appendEvent = useChats((s) => s.appendEvent);
  const setStreaming = useChats((s) => s.setStreaming);
  const client = useProjects((s) => s.client);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Load existing messages on mount.
  useEffect(() => {
    if (!client) return;
    (async () => {
      const meta = await client.getChat(chatId);
      setTitle(meta.title);
      if (meta.model) setModel(meta.model);
      if (meta.mode) setMode(meta.mode as ExecMode);

      const replayed = await client.getChatMessages(chatId);
      setMessages(chatId, rebuildMessages(replayed as ReplayedMessage[]));
    })();
  }, [client, chatId, setMessages]);

  // Auto-scroll to bottom whenever messages change (new tokens, tool results,
  // permission prompts). Skipped while the user has scrolled up — pinning the
  // viewport to the bottom only when they were already there.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (distanceFromBottom < 200) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages]);

  async function handleSend(content: string) {
    if (!client) return;
    setStreaming(chatId, true);

    // Auto-title the chat from the first user message. The "New chat"
    // default is unhelpful in the sidebar once you have several chats —
    // grab the first 60 chars of the user's first message instead.
    const isFirstSend = messages.length === 0 && (title === "" || title === "New chat");
    if (isFirstSend) {
      const derived = content.trim().split(/\s+/).slice(0, 12).join(" ").slice(0, 60);
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
    appendEvent(chatId, { kind: "user_message", content });

    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      await streamMessages(
        `${client.baseUrl}/chats/${chatId}/messages`,
        client.bearerToken,
        { content, model_override: model || undefined, mode_override: mode },
        ctrl.signal,
        (ev) => {
          // Skip the gateway's user_message echo since we already rendered it.
          if (ev.kind === "user_message") return;
          appendEvent(chatId, ev);
        },
      );
    } catch (e) {
      appendEvent(chatId, { kind: "error", message: (e as Error).message });
    } finally {
      setStreaming(chatId, false);
      abortRef.current = null;
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="border-b border-gray-200 px-4 py-2 flex items-center justify-between">
        <div className="text-sm text-gray-700">
          {title || "Chat"}
          {projectId && <span className="text-xs text-gray-400 ml-2">· in project</span>}
        </div>
        <div className="flex items-center gap-2">
          {streaming && (
            <button
              onClick={async () => {
                if (!client) return;
                abortRef.current?.abort();
                try {
                  await client.cancelChat(chatId);
                } catch {
                  // best-effort; the abort already stopped the SSE stream
                }
              }}
              className="text-xs px-2 py-1 border border-red-300 bg-red-50 text-red-700 rounded hover:bg-red-100"
            >
              Cancel
            </button>
          )}
          <ModelPicker value={model} onChange={setModel} />
        </div>
      </div>
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-4">
        {messages.map((m, i) => {
          if (m.kind === "user_message") return <UserMessage key={i} content={m.content} />;
          if (m.kind === "assistant_message") return <AssistantMessage key={i} content={m.content} thinking={m.thinking} />;
          if (m.kind === "error") return <ErrorMessage key={i} message={m.message} />;
          if (m.kind === "tool_call") {
            return (
              <ToolCall
                key={i}
                name={m.name}
                args={m.args}
                running={m.running}
                success={m.success}
                result={m.result}
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
          return null;
        })}
        {messages.length === 0 && (
          <p className="text-sm text-gray-400">No messages yet.</p>
        )}
      </div>
      <Composer
        onSend={handleSend}
        disabled={streaming}
        leftSlot={<ModeChip mode={mode} onChange={setMode} />}
      />
    </div>
  );
}
