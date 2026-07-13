import { describe, expect, test, beforeEach } from "vitest";
import { useChats } from "./chats";
import type { ChatAttachment } from "../lib/gateway";

const attachment: ChatAttachment = {
  id: "a1",
  filename: "report.pdf",
  mime_type: "application/pdf",
  size: 2048,
  path: "/tmp/report.pdf",
  kind: "pdf",
  text_preview: "report text",
  text_truncated: false,
  checksum: "sha256:abc",
  chunks_count: 2,
  warnings: [],
  created_at: 1,
};

describe("chats store", () => {
  beforeEach(() => {
    useChats.setState({ byProject: {}, projectless: [], messages: {}, streaming: {}, usage: {} });
  });

  test("setChatList replaces chats for a project", () => {
    useChats.getState().setChatList("p1", [
      { id: "c1", project_id: "p1", title: "first", model: "", mode: "auto",
        created_at: "", last_message_at: "", status: "idle" },
    ]);
    expect(useChats.getState().byProject["p1"].map((c) => c.id)).toEqual(["c1"]);
  });

  test("appendEvent adds a user_message bubble", () => {
    const s = useChats.getState();
    s.appendEvent("c1", { kind: "user_message", content: "hi" });
    const msgs = useChats.getState().messages["c1"] ?? [];
    expect(msgs).toEqual([{ kind: "user_message", content: "hi" }]);
  });

  test("appendEvent merges streaming assistant_token deltas", () => {
    const s = useChats.getState();
    s.appendEvent("c1", { kind: "turn_started" });
    s.appendEvent("c1", { kind: "assistant_token", text: "Hel" });
    s.appendEvent("c1", { kind: "assistant_token", text: "lo" });
    s.appendEvent("c1", { kind: "turn_completed", status: "ok" });
    const msgs = useChats.getState().messages["c1"] ?? [];
    const assistant = msgs.find((m) => m.kind === "assistant_message");
    expect(assistant).toBeDefined();
    expect((assistant as { kind: "assistant_message"; content: string }).content).toBe("Hello");
  });

  test("assistant_final replaces streamed tokens (no double, sanitized wins)", () => {
    const s = useChats.getState();
    s.appendEvent("c1", { kind: "assistant_token", text: "<think>x</think>" });
    s.appendEvent("c1", { kind: "assistant_token", text: "Answer: 42" });
    // Sanitized complete message arrives — must REPLACE, not append.
    s.appendEvent("c1", { kind: "assistant_final", content: "Answer: 42" });
    const msgs = useChats.getState().messages["c1"] ?? [];
    const assistants = msgs.filter((m) => m.kind === "assistant_message");
    expect(assistants).toHaveLength(1);
    expect((assistants[0] as { content: string }).content).toBe("Answer: 42");
  });

  test("assistant_final pushes a message when nothing streamed", () => {
    const s = useChats.getState();
    s.appendEvent("c1", { kind: "assistant_final", content: "Done." });
    const msgs = useChats.getState().messages["c1"] ?? [];
    const assistant = msgs.find((m) => m.kind === "assistant_message");
    expect((assistant as { content: string }).content).toBe("Done.");
  });

  test("setStreaming flips streaming flag", () => {
    useChats.getState().setStreaming("c1", true);
    expect(useChats.getState().streaming["c1"]).toBe(true);
    useChats.getState().setStreaming("c1", false);
    expect(useChats.getState().streaming["c1"]).toBe(false);
  });

  test("info events append as info messages", () => {
    const s = useChats.getState();
    s.appendEvent("c1", { kind: "info", message: "Denied write_file — chat is read-only." });
    const msgs = useChats.getState().messages["c1"] ?? [];
    expect(msgs).toEqual([{ kind: "info", message: "Denied write_file — chat is read-only." }]);
  });

  test("removeAttachment drops a deleted attachment from user messages", () => {
    const s = useChats.getState();
    s.appendEvent("c1", { kind: "user_message", content: "read this", attachments: [attachment] });

    s.removeAttachment("c1", "a1");

    const msgs = useChats.getState().messages["c1"] ?? [];
    expect(msgs).toEqual([{ kind: "user_message", content: "read this", attachments: [] }]);
  });

  test("usage events accumulate across turns", () => {
    const s = useChats.getState();
    s.appendEvent("c1", {
      kind: "usage",
      input_tokens: 100, output_tokens: 50, total_tokens: 150,
      cached_input_tokens: 20, cache_creation_tokens: 0, model: "gpt-4o-mini",
    });
    s.appendEvent("c1", {
      kind: "usage",
      input_tokens: 200, output_tokens: 80, total_tokens: 280,
      cached_input_tokens: 50, cache_creation_tokens: 5,
    });
    const usage = useChats.getState().usage["c1"];
    expect(usage.input_tokens).toBe(300);
    expect(usage.output_tokens).toBe(130);
    expect(usage.total_tokens).toBe(430);
    expect(usage.cached_input_tokens).toBe(70);
    expect(usage.cache_creation_tokens).toBe(5);
    expect(usage.last_input_tokens).toBe(200);
    expect(usage.model).toBe("gpt-4o-mini");
  });
});
