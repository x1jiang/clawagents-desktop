import { useEffect } from "react";
import { useChats } from "../stores/chats";
import { useProjects } from "../stores/projects";
import { Composer } from "./Composer";
import { UserMessage } from "./Message/UserMessage";
import { AssistantMessage } from "./Message/AssistantMessage";
import { ErrorMessage } from "./Message/ErrorMessage";

interface Props {
  projectId: string | null;
  chatId: string;
}

export function ChatSurface({ projectId, chatId }: Props) {
  const messages = useChats((s) => s.messages[chatId] ?? []);
  const streaming = useChats((s) => s.streaming[chatId] ?? false);
  const setMessages = useChats((s) => s.setMessages);
  const client = useProjects((s) => s.client);

  // Load existing messages on mount.
  useEffect(() => {
    if (!client) return;
    (async () => {
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

  // Send wiring lands in Task 9.
  function handleSend(_content: string) {
    // Implemented in Task 9.
  }

  return (
    <div className="flex flex-col h-full">
      <div className="border-b border-gray-200 px-4 py-2 text-sm text-gray-700">
        Chat <span className="font-mono text-xs text-gray-500">({chatId})</span>
        {projectId && <span className="text-xs text-gray-400 ml-2">in project {projectId}</span>}
      </div>
      <div className="flex-1 overflow-y-auto px-6 py-4">
        {messages.map((m, i) => {
          if (m.kind === "user_message") return <UserMessage key={i} content={m.content} />;
          if (m.kind === "assistant_message") return <AssistantMessage key={i} content={m.content} />;
          if (m.kind === "error") return <ErrorMessage key={i} message={m.message} />;
          return null;  // tool_call / permission_required handled in Tasks 10-12
        })}
        {messages.length === 0 && (
          <p className="text-sm text-gray-400">No messages yet.</p>
        )}
      </div>
      <Composer onSend={handleSend} disabled={streaming} />
    </div>
  );
}
