import { create } from "zustand";

export interface Chat {
  id: string;
  project_id: string | null;
  title: string;
  model: string;
  mode: string;
  created_at: string;
  last_message_at: string;
  status: string;
}

export type Message =
  | { kind: "user_message"; content: string }
  | { kind: "assistant_message"; content: string; thinking?: string }
  | { kind: "tool_call"; id: string; name: string; args: unknown; result?: string; success?: boolean; running: boolean }
  | { kind: "permission_required"; request_id: string; tool: string; file_path?: string; reason: string; resolved?: "allow_once" | "allow_always" | "deny" }
  | { kind: "error"; message: string };

export type StreamEvent =
  | { kind: "turn_started"; chat_id?: string }
  | { kind: "user_message"; content: string }
  | { kind: "assistant_token"; text: string }
  | { kind: "tool_use"; id: string; name: string; args: unknown }
  | { kind: "tool_result"; tool_call_id: string; success: boolean; output: string }
  | { kind: "permission_required"; request_id: string; tool: string; file_path?: string; reason: string }
  | { kind: "turn_completed"; status: string; iterations?: number; result?: string }
  | { kind: "error"; message: string };

interface ChatsState {
  byProject: Record<string, Chat[]>;
  projectless: Chat[];
  messages: Record<string, Message[]>;
  streaming: Record<string, boolean>;

  setChatList: (projectId: string | null, chats: Chat[]) => void;
  setMessages: (chatId: string, messages: Message[]) => void;
  appendEvent: (chatId: string, ev: StreamEvent) => void;
  setStreaming: (chatId: string, on: boolean) => void;
  resolvePermission: (chatId: string, requestId: string, decision: "allow_once" | "allow_always" | "deny") => void;
}

export const useChats = create<ChatsState>((set) => ({
  byProject: {},
  projectless: [],
  messages: {},
  streaming: {},

  setChatList: (projectId, chats) =>
    set((s) =>
      projectId === null
        ? { projectless: chats }
        : { byProject: { ...s.byProject, [projectId]: chats } },
    ),

  setMessages: (chatId, messages) =>
    set((s) => ({ messages: { ...s.messages, [chatId]: messages } })),

  appendEvent: (chatId, ev) =>
    set((s) => {
      const current = s.messages[chatId] ? [...s.messages[chatId]] : [];

      switch (ev.kind) {
        case "turn_started":
          return s;
        case "user_message":
          current.push({ kind: "user_message", content: ev.content });
          break;
        case "assistant_token": {
          const last = current[current.length - 1];
          if (last && last.kind === "assistant_message") {
            current[current.length - 1] = { ...last, content: last.content + ev.text };
          } else {
            current.push({ kind: "assistant_message", content: ev.text });
          }
          break;
        }
        case "tool_use":
          current.push({
            kind: "tool_call",
            id: ev.id,
            name: ev.name,
            args: ev.args,
            running: true,
          });
          break;
        case "tool_result": {
          const idx = current.findIndex(
            (m) => m.kind === "tool_call" && m.id === ev.tool_call_id,
          );
          if (idx !== -1) {
            const t = current[idx] as Extract<Message, { kind: "tool_call" }>;
            current[idx] = { ...t, running: false, success: ev.success, result: ev.output };
          }
          break;
        }
        case "permission_required":
          current.push({
            kind: "permission_required",
            request_id: ev.request_id,
            tool: ev.tool,
            file_path: ev.file_path,
            reason: ev.reason,
          });
          break;
        case "turn_completed":
          return { ...s, messages: { ...s.messages, [chatId]: current }, streaming: { ...s.streaming, [chatId]: false } };
        case "error":
          current.push({ kind: "error", message: ev.message });
          return { ...s, messages: { ...s.messages, [chatId]: current }, streaming: { ...s.streaming, [chatId]: false } };
      }

      return { messages: { ...s.messages, [chatId]: current } };
    }),

  setStreaming: (chatId, on) =>
    set((s) => ({ streaming: { ...s.streaming, [chatId]: on } })),

  resolvePermission: (chatId, requestId, decision) =>
    set((s) => {
      const current = s.messages[chatId];
      if (!current) return s;
      const idx = current.findIndex(
        (m) => m.kind === "permission_required" && m.request_id === requestId,
      );
      if (idx === -1) return s;
      const next = [...current];
      const p = next[idx] as Extract<Message, { kind: "permission_required" }>;
      next[idx] = { ...p, resolved: decision };
      return { messages: { ...s.messages, [chatId]: next } };
    }),
}));
