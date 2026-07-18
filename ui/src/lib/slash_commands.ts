/**
 * Slash command registry. Commands are intercepted client-side before the
 * composer sends to the gateway — they never reach the agent. Keeps the
 * composer multi-purpose without overloading the agent prompt with magic
 * strings.
 */

export interface SlashCommand {
  name: string;
  description: string;
  usage?: string;
  /** Returns true if the command consumed the input (do not send to agent). */
  run: (args: string, ctx: SlashContext) => void | Promise<void>;
}

export interface SlashContext {
  chatId: string;
  clearMessages: () => void;
  exportChat: () => Promise<void>;
  openShortcuts: () => void;
  patchChat: (body: { title?: string; model?: string; mode?: string }) => Promise<void>;
  forkChat?: () => Promise<void>;
  compactChat?: () => Promise<void>;
  uncompactChat?: () => Promise<void>;
  showGitStatus?: () => Promise<void>;
  openTrash?: () => void;
  refreshChat?: () => Promise<void>;
  openCheckpoints?: () => void;
  openRewind?: () => void;
  /** Optional list of user-defined slash commands (for /help to surface). */
  getCustomCommands?: () => Array<{ name: string; description: string }>;
  /** Optional snapshot of the chat's cumulative usage for /usage. */
  getUsage?: () => {
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
    cached_input_tokens: number;
    cache_creation_tokens: number;
    last_input_tokens: number;
    model?: string;
  } | undefined;
  appendError: (msg: string) => void;
  appendInfo: (msg: string) => void;
}

export const SLASH_COMMANDS: SlashCommand[] = [
  {
    name: "clear",
    description: "Clear messages from view (does not delete history)",
    run: (_args, ctx) => { ctx.clearMessages(); },
  },
  {
    name: "export",
    description: "Download this chat as a Markdown file",
    run: async (_args, ctx) => { await ctx.exportChat(); },
  },
  {
    name: "shortcuts",
    description: "Show keyboard shortcuts",
    run: (_args, ctx) => { ctx.openShortcuts(); },
  },
  {
    name: "help",
    description: "List available slash commands",
    run: (_args, ctx) => {
      const lines = ["Built-in commands:"];
      for (const c of SLASH_COMMANDS) {
        lines.push(`  /${c.name}${c.usage ? " " + c.usage : ""} — ${c.description}`);
      }
      const customs = ctx.getCustomCommands?.() ?? [];
      if (customs.length > 0) {
        lines.push("", "Your custom commands:");
        for (const c of customs) {
          lines.push(`  /${c.name} — ${c.description || "(no description)"}`);
        }
      }
      ctx.appendInfo(lines.join("\n"));
    },
  },
  {
    name: "mode",
    description: "Switch execution mode",
    usage: "<auto|read_only|ask|full_access>",
    run: async (args, ctx) => {
      const m = args.trim();
      const valid = ["auto", "read_only", "ask", "full_access"];
      if (!valid.includes(m)) {
        ctx.appendError(`Unknown mode: "${m}". Use ${valid.join(" / ")}.`);
        return;
      }
      await ctx.patchChat({ mode: m });
      ctx.appendInfo(`Mode set to ${m}.`);
    },
  },
  {
    name: "model",
    description: "Switch model for this chat",
    usage: "<model-id>",
    run: async (args, ctx) => {
      const m = args.trim();
      if (!m) {
        ctx.appendError("Usage: /model <model-id>");
        return;
      }
      await ctx.patchChat({ model: m });
      ctx.appendInfo(`Model set to ${m}.`);
    },
  },
  {
    name: "title",
    description: "Rename this chat",
    usage: "<new title>",
    run: async (args, ctx) => {
      const t = args.trim();
      if (!t) {
        ctx.appendError("Usage: /title <new title>");
        return;
      }
      await ctx.patchChat({ title: t });
      ctx.appendInfo(`Title set to "${t}".`);
    },
  },
  {
    name: "fork",
    description: "Fork this chat — open an independent copy",
    run: async (_args, ctx) => {
      if (!ctx.forkChat) {
        ctx.appendError("Forking is not available in this context.");
        return;
      }
      await ctx.forkChat();
    },
  },
  {
    name: "compact",
    description: "Summarise this chat — frees context, keeps the gist",
    run: async (_args, ctx) => {
      if (!ctx.compactChat) {
        ctx.appendError("Compacting is not available in this context.");
        return;
      }
      await ctx.compactChat();
    },
  },
  {
    name: "checkpoints",
    description: "Open the shadow-git checkpoint restore panel",
    run: (_args, ctx) => {
      if (!ctx.openCheckpoints) {
        ctx.appendError("Checkpoints are not available in this context.");
        return;
      }
      ctx.openCheckpoints();
    },
  },
  {
    name: "rewind",
    description: "Rewind workspace files to a prior prompt snapshot",
    run: (_args, ctx) => {
      if (!ctx.openRewind) {
        ctx.appendError("Rewind is not available in this context.");
        return;
      }
      ctx.openRewind();
    },
  },
  {
    name: "diff",
    description: "Show git status + diff for this project",
    run: async (_args, ctx) => {
      if (!ctx.showGitStatus) {
        ctx.appendError("Git is only available inside a project chat.");
        return;
      }
      await ctx.showGitStatus();
    },
  },
  {
    name: "uncompact",
    description: "Restore the most recent pre-compact backup of this chat",
    run: async (_args, ctx) => {
      if (!ctx.uncompactChat) {
        ctx.appendError("Restore is not available in this context.");
        return;
      }
      await ctx.uncompactChat();
    },
  },
  {
    name: "trash",
    description: "Open the trash to recover recently-deleted chats",
    run: (_args, ctx) => {
      if (!ctx.openTrash) {
        ctx.appendError("Trash navigation is unavailable here.");
        return;
      }
      ctx.openTrash();
    },
  },
  {
    name: "refresh",
    description: "Reload this chat from disk (sync external edits)",
    run: async (_args, ctx) => {
      if (!ctx.refreshChat) {
        ctx.appendError("Refresh is not available in this context.");
        return;
      }
      await ctx.refreshChat();
    },
  },
  {
    name: "usage",
    description: "Show this chat's cumulative token usage",
    run: (_args, ctx) => {
      const u = ctx.getUsage?.();
      if (!u || u.total_tokens === 0) {
        ctx.appendInfo("No usage recorded yet for this chat.");
        return;
      }
      const cachedPct = u.input_tokens > 0
        ? Math.round((u.cached_input_tokens / u.input_tokens) * 100)
        : 0;
      const lines = [
        "Chat usage so far:",
        `  Model:           ${u.model ?? "(unknown)"}`,
        `  Input tokens:    ${u.input_tokens.toLocaleString()}`,
        `  Output tokens:   ${u.output_tokens.toLocaleString()}`,
        `  Cached input:    ${u.cached_input_tokens.toLocaleString()}${u.input_tokens ? ` (${cachedPct}%)` : ""}`,
        `  Cache write:     ${u.cache_creation_tokens.toLocaleString()}`,
        `  Total billed:    ${u.total_tokens.toLocaleString()}`,
        `  Last turn input: ${u.last_input_tokens.toLocaleString()}`,
      ];
      ctx.appendInfo(lines.join("\n"));
    },
  },
];

/**
 * Try to interpret `text` as a slash command. Returns true if handled.
 * Returns false (and runs no command) if the text isn't a slash command
 * or the command isn't recognised — the caller should then send it to
 * the agent as a normal message.
 */
export async function tryRunSlashCommand(
  text: string,
  ctx: SlashContext,
): Promise<boolean> {
  if (!text.startsWith("/")) return false;
  const space = text.indexOf(" ");
  const name = space === -1 ? text.slice(1) : text.slice(1, space);
  const args = space === -1 ? "" : text.slice(space + 1);
  const cmd = SLASH_COMMANDS.find((c) => c.name === name);
  if (!cmd) return false;
  await cmd.run(args, ctx);
  return true;
}
