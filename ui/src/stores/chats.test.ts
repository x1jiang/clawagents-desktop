import { describe, expect, test, beforeEach } from "vitest";
import { useChats } from "./chats";

describe("chats store", () => {
  beforeEach(() => {
    useChats.setState({ byProject: {}, projectless: [], messages: {}, streaming: {} });
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

  test("setStreaming flips streaming flag", () => {
    useChats.getState().setStreaming("c1", true);
    expect(useChats.getState().streaming["c1"]).toBe(true);
    useChats.getState().setStreaming("c1", false);
    expect(useChats.getState().streaming["c1"]).toBe(false);
  });
});
