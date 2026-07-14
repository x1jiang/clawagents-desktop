import { describe, expect, test, vi } from "vitest";
import {
  abortAndDropOtherChats,
  attachmentsForChat,
  updateOwnedAttachment,
  type OwnedComposerAttachment,
} from "./chat_attachments";

function item(ownerChatId: string): OwnedComposerAttachment<string> {
  return { localId: "one", ownerChatId, status: "uploading" };
}

describe("chat-owned composer attachments", () => {
  test("filters attachments to the active chat", () => {
    expect(attachmentsForChat([item("chat-a")], "chat-b")).toEqual([]);
  });

  test("aborts and drops uploads owned by another chat", () => {
    const abort = vi.fn();
    const old = { ...item("chat-a"), abort: { abort } as unknown as AbortController };
    expect(abortAndDropOtherChats([old], "chat-b").remaining).toEqual([]);
    expect(abort).toHaveBeenCalledOnce();
  });

  test("ignores a late completion after the active chat changes", () => {
    const old = item("chat-a");
    const result = updateOwnedAttachment([old], "chat-b", "chat-a", "one", (current) => ({
      ...current,
      status: "ready",
      attachment: "late",
    }));
    expect(result).toEqual([old]);
  });
});
