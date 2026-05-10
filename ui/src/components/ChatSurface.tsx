import { useEffect, useRef, useState } from "react";
import { useChats } from "../stores/chats";
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

  // Load existing messages on mount.
  useEffect(() => {
    if (!client) return;
    (async () => {
      const meta = await client.getChat(chatId);
      setTitle(meta.title);
      if (meta.model) setModel(meta.model);
      if (meta.mode) setMode(meta.mode as ExecMode);

      const replayed = await client.getChatMessages(chatId);
      const initial = replayed
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map((m) =>
          m.role === "user"
            ? { kind: "user_message" as const, content: m.content }
            : { kind: "assistant_message" as const, content: m.content, thinking: m.thinking ?? undefined },
        );
      setMessages(chatId, initial);
    })();
  }, [client, chatId, setMessages]);

  async function handleSend(content: string) {
    if (!client) return;
    setStreaming(chatId, true);

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
      <div className="flex-1 overflow-y-auto px-6 py-4">
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
