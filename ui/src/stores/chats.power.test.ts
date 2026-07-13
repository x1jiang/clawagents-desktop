import { describe, expect, test } from "vitest";
import { useChats } from "../stores/chats";

describe("agent power stream events", () => {
  test("appendEvent handles ask_user, checkpoint, compact, file_changed", () => {
    const chatId = "c-power";
    useChats.getState().setMessages(chatId, []);
    useChats.getState().appendEvent(chatId, {
      kind: "ask_user_required",
      request_id: "a1",
      question: "Which file?",
    });
    useChats.getState().appendEvent(chatId, {
      kind: "checkpoint",
      sha: "abc123",
      label: "after write",
    });
    useChats.getState().appendEvent(chatId, {
      kind: "compact_progress",
      phase: "summarizing",
      message: "shrinking",
    });
    useChats.getState().appendEvent(chatId, {
      kind: "file_changed",
      path: "src/a.ts",
      snapshot_id: "snap1",
    });
    const msgs = useChats.getState().messages[chatId];
    expect(msgs.map((m) => m.kind)).toEqual([
      "ask_user_required",
      "checkpoint",
      "compact_progress",
      "file_changed",
    ]);
    useChats.getState().resolveAskUser(chatId, "a1", "foo.ts");
    const ask = useChats.getState().messages[chatId][0];
    expect(ask.kind).toBe("ask_user_required");
    if (ask.kind === "ask_user_required") {
      expect(ask.resolved).toBe(true);
      expect(ask.answer).toBe("foo.ts");
    }
  });
});
