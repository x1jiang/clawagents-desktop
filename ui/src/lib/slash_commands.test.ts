import { describe, test, expect, vi } from "vitest";
import { tryRunSlashCommand, type SlashContext } from "./slash_commands";

function makeCtx(overrides: Partial<SlashContext> = {}): SlashContext {
  return {
    chatId: "c1",
    clearMessages: vi.fn(),
    exportChat: vi.fn(async () => {}),
    openShortcuts: vi.fn(),
    patchChat: vi.fn(async () => {}),
    appendError: vi.fn(),
    appendInfo: vi.fn(),
    ...overrides,
  };
}

describe("slash commands", () => {
  test("plain text is not a command", async () => {
    const ctx = makeCtx();
    expect(await tryRunSlashCommand("hello world", ctx)).toBe(false);
  });

  test("/clear invokes clearMessages", async () => {
    const ctx = makeCtx();
    expect(await tryRunSlashCommand("/clear", ctx)).toBe(true);
    expect(ctx.clearMessages).toHaveBeenCalled();
  });

  test("/export invokes exportChat", async () => {
    const ctx = makeCtx();
    expect(await tryRunSlashCommand("/export", ctx)).toBe(true);
    expect(ctx.exportChat).toHaveBeenCalled();
  });

  test("/help lists commands via appendInfo", async () => {
    const ctx = makeCtx();
    expect(await tryRunSlashCommand("/help", ctx)).toBe(true);
    expect(ctx.appendInfo).toHaveBeenCalled();
    const msg = (ctx.appendInfo as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(msg).toContain("/clear");
    expect(msg).toContain("/export");
  });

  test("/help also lists custom commands when provided", async () => {
    const ctx = makeCtx({
      getCustomCommands: () => [
        { name: "review-pr", description: "Walk through the PR diff" },
        { name: "stand-up", description: "Summarize yesterday's commits" },
      ],
    });
    expect(await tryRunSlashCommand("/help", ctx)).toBe(true);
    const msg = (ctx.appendInfo as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(msg).toContain("Your custom commands:");
    expect(msg).toContain("/review-pr");
    expect(msg).toContain("/stand-up");
  });

  test("/help omits custom commands section when none are loaded", async () => {
    const ctx = makeCtx({ getCustomCommands: () => [] });
    await tryRunSlashCommand("/help", ctx);
    const msg = (ctx.appendInfo as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(msg).not.toContain("Your custom commands:");
  });

  test("/mode auto patches chat with mode=auto", async () => {
    const ctx = makeCtx();
    expect(await tryRunSlashCommand("/mode auto", ctx)).toBe(true);
    expect(ctx.patchChat).toHaveBeenCalledWith({ mode: "auto" });
  });

  test("/mode invalid surfaces error, no patch", async () => {
    const ctx = makeCtx();
    expect(await tryRunSlashCommand("/mode bogus", ctx)).toBe(true);
    expect(ctx.patchChat).not.toHaveBeenCalled();
    expect(ctx.appendError).toHaveBeenCalled();
  });

  test("/mode full_access is accepted", async () => {
    const ctx = makeCtx();
    expect(await tryRunSlashCommand("/mode full_access", ctx)).toBe(true);
    expect(ctx.patchChat).toHaveBeenCalledWith({ mode: "full_access" });
  });

  test("/title sets new title via patch", async () => {
    const ctx = makeCtx();
    expect(await tryRunSlashCommand("/title My great chat", ctx)).toBe(true);
    expect(ctx.patchChat).toHaveBeenCalledWith({ title: "My great chat" });
  });

  test("unknown /foo returns false", async () => {
    const ctx = makeCtx();
    expect(await tryRunSlashCommand("/foo bar", ctx)).toBe(false);
  });

  test("/usage prints a breakdown when usage exists", async () => {
    const getUsage = vi.fn(() => ({
      input_tokens: 1000,
      output_tokens: 250,
      total_tokens: 1250,
      cached_input_tokens: 400,
      cache_creation_tokens: 0,
      last_input_tokens: 800,
      model: "gpt-5.4-mini",
    }));
    const ctx = makeCtx({ getUsage });
    expect(await tryRunSlashCommand("/usage", ctx)).toBe(true);
    expect(getUsage).toHaveBeenCalled();
    const msg = (ctx.appendInfo as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(msg).toContain("gpt-5.4-mini");
    expect(msg).toContain("1,000");
    expect(msg).toContain("(40%)"); // cached/input ratio
  });

  test("/usage with no usage data appends a friendly note", async () => {
    const getUsage = vi.fn(() => undefined);
    const ctx = makeCtx({ getUsage });
    expect(await tryRunSlashCommand("/usage", ctx)).toBe(true);
    expect(ctx.appendInfo).toHaveBeenCalledWith("No usage recorded yet for this chat.");
  });
});
