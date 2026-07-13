import { describe, expect, test } from "vitest";
import { modifiedFiles } from "./touched_files";
import type { Message } from "../stores/chats";

function tool(name: string, args: Record<string, unknown>, success: boolean | undefined = true): Message {
  return { kind: "tool_call", id: name + JSON.stringify(args), name, args, running: false, success };
}

describe("modifiedFiles", () => {
  test("extracts paths from edit and write calls", () => {
    const result = modifiedFiles([
      tool("edit_file", { path: "src/a.ts" }),
      tool("write_file", { file_path: "src/b.ts" }),
      tool("apply_patch", { file: "src/c.ts" }),
    ]);
    expect(result.map((r) => r.path)).toEqual(["src/a.ts", "src/b.ts", "src/c.ts"]);
    expect(result.every((r) => r.count === 1)).toBe(true);
  });

  test("ignores read-only tools", () => {
    const result = modifiedFiles([
      tool("read_file", { path: "src/a.ts" }),
      tool("list_dir", { path: "src" }),
    ]);
    expect(result).toEqual([]);
  });

  test("ignores failed tool calls", () => {
    const result = modifiedFiles([
      tool("edit_file", { path: "src/a.ts" }, false),
      tool("edit_file", { path: "src/b.ts" }, true),
    ]);
    expect(result.map((r) => r.path)).toEqual(["src/b.ts"]);
  });

  test("counts duplicate edits to the same path", () => {
    const result = modifiedFiles([
      tool("edit_file", { path: "src/a.ts" }),
      tool("edit_file", { path: "src/a.ts" }),
      tool("write_file", { file_path: "src/a.ts" }),
    ]);
    expect(result).toEqual([{ path: "src/a.ts", count: 3 }]);
  });

  test("ignores tool calls without a path-like arg", () => {
    const result = modifiedFiles([
      tool("edit_file", { contents: "..." } as Record<string, unknown>),
    ]);
    expect(result).toEqual([]);
  });

  test("ignores non-tool-call messages", () => {
    const messages: Message[] = [
      { kind: "user_message", content: "hi" },
      { kind: "assistant_message", content: "hello" },
      { kind: "info", message: "compacted" },
    ];
    expect(modifiedFiles(messages)).toEqual([]);
  });
});
