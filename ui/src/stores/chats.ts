import { create } from "zustand";
import type { ChatAttachment } from "../lib/gateway";
import { splitThinking } from "../lib/thinking";

export interface Chat {
  id: string;
  project_id: string | null;
  title: string;
  model: string;
  mode: string;
  pinned?: boolean;
  note?: string;
  created_at: string;
  last_message_at: string;
  status: string;
}

export type Message =
  | { kind: "user_message"; content: string; attachments?: ChatAttachment[] }
  | { kind: "assistant_message"; content: string; thinking?: string; streamRaw?: string }
  | { kind: "tool_call"; id: string; name: string; args: unknown; result?: string; success?: boolean; running: boolean; startedAt?: number; elapsedMs?: number }
  | { kind: "permission_required"; request_id: string; tool: string; file_path?: string; reason: string; resolved?: "allow_once" | "allow_always" | "deny" }
  | { kind: "ask_user_required"; request_id: string; question: string; resolved?: boolean; answer?: string | null }
  | { kind: "file_changed"; path: string; snapshot_id?: string }
  | { kind: "checkpoint"; sha?: string; label?: string; tool?: string }
  | { kind: "compact_progress"; phase?: string; message?: string }
  | { kind: "info"; message: string }
  | { kind: "error"; message: string };

export type StreamEvent =
  | { kind: "turn_started"; chat_id?: string }
  | { kind: "user_message"; content: string; attachments?: ChatAttachment[] }
  | { kind: "assistant_token"; text: string }
  | { kind: "assistant_final"; content: string; thinking?: string }
  | { kind: "tool_use"; id: string; name: string; args: unknown }
  | { kind: "tool_result"; tool_call_id: string; success: boolean; output: string }
  | { kind: "permission_required"; request_id: string; tool: string; file_path?: string; reason: string }
  | { kind: "ask_user_required"; request_id: string; question: string }
  | { kind: "file_changed"; path: string; snapshot_id?: string }
  | { kind: "checkpoint"; sha?: string; label?: string; tool?: string; message_count?: number }
  | { kind: "compact_progress"; phase?: string; message?: string; status?: string }
  | { kind: "warn"; message?: string }
  | { kind: "tool_skipped"; name?: string; reason?: string }
  | { kind: "turn_completed"; status: string; iterations?: number; result?: string }
  | { kind: "usage"; input_tokens?: number; output_tokens?: number; total_tokens?: number; cached_input_tokens?: number; cache_creation_tokens?: number; model?: string }
  | { kind: "info"; message: string }
  | { kind: "error"; message: string };

export interface ChatUsage {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  cached_input_tokens: number;
  cache_creation_tokens: number;
  /** Last-seen single-turn input_tokens — drives the auto-compact hint. */
  last_input_tokens: number;
  model?: string;
}

interface ChatsState {
  byProject: Record<string, Chat[]>;
  projectless: Chat[];
  messages: Record<string, Message[]>;
  streaming: Record<string, boolean>;
  usage: Record<string, ChatUsage>;
  /** Per-turn usage for the current/last run (reset when a turn starts). */
  lastRunUsage: Record<string, ChatUsage>;

  setChatList: (projectId: string | null, chats: Chat[]) => void;
  setMessages: (chatId: string, messages: Message[]) => void;
  appendEvent: (chatId: string, ev: StreamEvent) => void;
  appendInfo: (chatId: string, message: string) => void;
  removeAttachment: (chatId: string, attachmentId: string) => void;
  resetUsage: (chatId: string) => void;
  clearLastRunUsage: (chatId: string) => void;
  setStreaming: (chatId: string, on: boolean) => void;
  resolvePermission: (chatId: string, requestId: string, decision: "allow_once" | "allow_always" | "deny") => void;
  resolveAskUser: (chatId: string, requestId: string, answer: string | null) => void;
}

const EMPTY_USAGE: ChatUsage = {
  input_tokens: 0,
  output_tokens: 0,
  total_tokens: 0,
  cached_input_tokens: 0,
  cache_creation_tokens: 0,
  last_input_tokens: 0,
};

export const useChats = create<ChatsState>((set) => ({
  byProject: {},
  projectless: [],
  messages: {},
  streaming: {},
  usage: {},
  lastRunUsage: {},

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
          return {
            ...s,
            lastRunUsage: { ...s.lastRunUsage, [chatId]: { ...EMPTY_USAGE } },
          };
        case "user_message":
          current.push({ kind: "user_message", content: ev.content, attachments: ev.attachments });
          break;
        case "assistant_token": {
          const last = current[current.length - 1];
          const prevRaw =
            last && last.kind === "assistant_message"
              ? (last.streamRaw ?? last.content)
              : "";
          const raw = prevRaw + ev.text;
          const { content, thinking } = splitThinking(raw);
          const next: Message = {
            kind: "assistant_message",
            content,
            thinking,
            streamRaw: raw,
          };
          if (last && last.kind === "assistant_message") {
            current[current.length - 1] = next;
          } else {
            current.push(next);
          }
          break;
        }
        case "assistant_final": {
          // The sanitized complete message REPLACES the streamed tokens
          // (which may still hold raw <think> text or pre-sanitization
          // artifacts). Push a fresh message if none was streamed.
          const last = current[current.length - 1];
          const thinking = ev.thinking || undefined;
          if (last && last.kind === "assistant_message") {
            current[current.length - 1] = {
              kind: "assistant_message",
              content: ev.content,
              thinking: thinking ?? last.thinking,
            };
          } else if (ev.content) {
            current.push({
              kind: "assistant_message",
              content: ev.content,
              thinking,
            });
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
            startedAt: Date.now(),
          });
          break;
        case "tool_result": {
          const idx = current.findIndex(
            (m) => m.kind === "tool_call" && m.id === ev.tool_call_id,
          );
          if (idx !== -1) {
            const t = current[idx] as Extract<Message, { kind: "tool_call" }>;
            const elapsedMs = t.startedAt ? Date.now() - t.startedAt : undefined;
            current[idx] = { ...t, running: false, success: ev.success, result: ev.output, elapsedMs };
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
        case "ask_user_required":
          current.push({
            kind: "ask_user_required",
            request_id: ev.request_id,
            question: ev.question,
          });
          break;
        case "file_changed":
          current.push({
            kind: "file_changed",
            path: ev.path,
            snapshot_id: ev.snapshot_id,
          });
          break;
        case "checkpoint":
          current.push({
            kind: "checkpoint",
            sha: ev.sha,
            label: ev.label,
            tool: ev.tool,
          });
          break;
        case "compact_progress":
          current.push({
            kind: "compact_progress",
            phase: ev.phase ?? ev.status,
            message: ev.message,
          });
          break;
        case "warn":
          current.push({ kind: "info", message: ev.message || "Warning" });
          break;
        case "tool_skipped":
          current.push({
            kind: "info",
            message: `Skipped ${ev.name || "tool"}${ev.reason ? `: ${ev.reason}` : ""}`,
          });
          break;
        case "usage": {
          const prev = s.usage[chatId] ?? { ...EMPTY_USAGE };
          const deltaIn = ev.input_tokens ?? 0;
          const deltaOut = ev.output_tokens ?? 0;
          const deltaTotal = ev.total_tokens ?? 0;
          const deltaCached = ev.cached_input_tokens ?? 0;
          const deltaCacheWrite = ev.cache_creation_tokens ?? 0;
          const model = ev.model ?? prev.model;
          const merged: ChatUsage = {
            input_tokens: prev.input_tokens + deltaIn,
            output_tokens: prev.output_tokens + deltaOut,
            total_tokens: prev.total_tokens + deltaTotal,
            cached_input_tokens: prev.cached_input_tokens + deltaCached,
            cache_creation_tokens: prev.cache_creation_tokens + deltaCacheWrite,
            // The agent reports usage per request; the latest one tells us
            // the context window pressure right now.
            last_input_tokens: ev.input_tokens ?? prev.last_input_tokens,
            model,
          };
          const runPrev = s.lastRunUsage[chatId] ?? { ...EMPTY_USAGE };
          const runMerged: ChatUsage = {
            input_tokens: runPrev.input_tokens + deltaIn,
            output_tokens: runPrev.output_tokens + deltaOut,
            total_tokens: runPrev.total_tokens + deltaTotal,
            cached_input_tokens: runPrev.cached_input_tokens + deltaCached,
            cache_creation_tokens: runPrev.cache_creation_tokens + deltaCacheWrite,
            last_input_tokens: ev.input_tokens ?? runPrev.last_input_tokens,
            model,
          };
          return {
            ...s,
            usage: { ...s.usage, [chatId]: merged },
            lastRunUsage: { ...s.lastRunUsage, [chatId]: runMerged },
          };
        }
        case "info":
          current.push({ kind: "info", message: ev.message });
          break;
        case "turn_completed":
          return { ...s, messages: { ...s.messages, [chatId]: current }, streaming: { ...s.streaming, [chatId]: false } };
        case "error":
          current.push({ kind: "error", message: ev.message });
          return { ...s, messages: { ...s.messages, [chatId]: current }, streaming: { ...s.streaming, [chatId]: false } };
      }

      return { messages: { ...s.messages, [chatId]: current } };
    }),

  appendInfo: (chatId, message) =>
    set((s) => {
      const current = s.messages[chatId] ? [...s.messages[chatId]] : [];
      current.push({ kind: "info", message });
      return { messages: { ...s.messages, [chatId]: current } };
    }),

  removeAttachment: (chatId, attachmentId) =>
    set((s) => {
      const current = s.messages[chatId];
      if (!current) return s;
      const next = current.map((message) => {
        if (message.kind !== "user_message" || !message.attachments) return message;
        return {
          ...message,
          attachments: message.attachments.filter((attachment) => attachment.id !== attachmentId),
        };
      });
      return { messages: { ...s.messages, [chatId]: next } };
    }),

  resetUsage: (chatId) =>
    set((s) => {
      const next = { ...s.usage };
      delete next[chatId];
      const nextRun = { ...s.lastRunUsage };
      delete nextRun[chatId];
      return { usage: next, lastRunUsage: nextRun };
    }),

  clearLastRunUsage: (chatId) =>
    set((s) => {
      const nextRun = { ...s.lastRunUsage };
      delete nextRun[chatId];
      return { lastRunUsage: nextRun };
    }),

  setStreaming: (chatId, on) =>
    set((s) => {
      if (on) {
        return {
          streaming: { ...s.streaming, [chatId]: on },
          lastRunUsage: { ...s.lastRunUsage, [chatId]: { ...EMPTY_USAGE } },
        };
      }
      return { streaming: { ...s.streaming, [chatId]: on } };
    }),

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

  resolveAskUser: (chatId, requestId, answer) =>
    set((s) => {
      const current = s.messages[chatId];
      if (!current) return s;
      const idx = current.findIndex(
        (m) => m.kind === "ask_user_required" && m.request_id === requestId,
      );
      if (idx === -1) return s;
      const next = [...current];
      const p = next[idx] as Extract<Message, { kind: "ask_user_required" }>;
      next[idx] = { ...p, resolved: true, answer };
      return { messages: { ...s.messages, [chatId]: next } };
    }),
}));
