import type { Message } from "../stores/chats";

const MUTATING_TOOL = /^(edit|write|apply_patch|append|patch|create_file|delete_file)/;

/**
 * Distinct project-relative paths touched by mutating tool calls. Failed calls
 * are excluded — the agent might have aborted before writing. Returned in
 * first-mention order with a count per path.
 */
export function modifiedFiles(messages: Message[]): Array<{ path: string; count: number }> {
  const counts = new Map<string, number>();
  for (const m of messages) {
    if (m.kind !== "tool_call") continue;
    if (!MUTATING_TOOL.test(m.name)) continue;
    if (m.success === false) continue;
    const args = m.args as Record<string, unknown> | null;
    if (!args || typeof args !== "object") continue;
    const path = String(args.path ?? args.file_path ?? args.file ?? "").trim();
    if (!path) continue;
    counts.set(path, (counts.get(path) ?? 0) + 1);
  }
  return Array.from(counts, ([path, count]) => ({ path, count }));
}
