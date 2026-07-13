import { Markdown } from "../../lib/markdown";
import { useUI } from "../../stores/ui";
import { linkifyPaths } from "../../lib/linkify_paths";

interface Props {
  name: string;
  args: unknown;
  result: string;
  /** When set, list_dir entries become clickable links to the file viewer. */
  projectId?: string | null;
}

/**
 * Render a tool result with formatting that suits the specific tool. We keep
 * the raw `<pre>` fallback for any tool we don't recognize so nothing is ever
 * hidden — readability is a bonus, not a requirement.
 */
export function ToolResultPreview({ name, args, result, projectId = null }: Props) {
  const openFile = useUI((s) => s.openFileViewer);
  // Try to read a path-like argument so we can label the preview with what
  // file/dir this is showing.
  const pathArg =
    typeof args === "object" && args !== null
      ? String((args as Record<string, unknown>).path ??
              (args as Record<string, unknown>).file_path ??
              (args as Record<string, unknown>).file ??
              "")
      : "";

  if (name === "read_file" || name === "view_file") {
    // Render as a code block, with language inferred from the extension.
    const ext = pathArg.split(".").pop()?.toLowerCase() ?? "";
    const lang = LANG_BY_EXT[ext] ?? "";
    return (
      <div>
        {pathArg && <div className="text-[10px] text-gray-400 mb-1 font-mono">{pathArg}</div>}
        <Markdown>{"```" + lang + "\n" + truncate(result) + "\n```"}</Markdown>
      </div>
    );
  }

  if (name === "list_dir" || name === "list_files") {
    // Most list tools emit one entry per line. Show as a compact, scrollable list.
    // When the chat has a project context, each row links to the file viewer —
    // dir entries are heuristically skipped (trailing "/" or no dot in basename).
    const entries = result.split("\n").filter((l) => l.trim());
    function resolvePath(entry: string): string {
      // Strip common annotation suffixes ("  (dir)", "  42b", etc.) by taking
      // the first whitespace-delimited token.
      const head = entry.trim().split(/\s+/)[0];
      const cleaned = head.replace(/\/$/, "");
      if (cleaned.startsWith("/") || cleaned.includes(":/")) return cleaned; // absolute
      if (!pathArg || pathArg === "." || pathArg === "") return cleaned;
      return `${pathArg.replace(/\/$/, "")}/${cleaned}`;
    }
    return (
      <div>
        {pathArg && <div className="text-[10px] text-gray-400 mb-1 font-mono">{pathArg}</div>}
        <div className="max-h-64 overflow-y-auto bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded">
          {entries.map((e, i) => {
            const looksLikeDir = e.trim().endsWith("/");
            const clickable = !!projectId && !looksLikeDir;
            return clickable ? (
              <button
                key={i}
                onClick={() => openFile(projectId!, resolvePath(e))}
                title={`Open ${resolvePath(e)}`}
                className="block w-full text-left px-2 py-0.5 text-xs font-mono text-gray-700 dark:text-gray-200 border-b last:border-b-0 border-gray-100 dark:border-gray-800 hover:bg-blue-50 dark:hover:bg-blue-950/40"
              >
                {e}
              </button>
            ) : (
              <div key={i} className="px-2 py-0.5 text-xs font-mono text-gray-700 dark:text-gray-200 border-b last:border-b-0 border-gray-100 dark:border-gray-800">
                {e}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  if (name === "edit_file" || name === "write_file" || name === "apply_patch") {
    // Try to render diff-like output if it looks like a unified diff.
    if (/^[\s\S]*?^[-+]/m.test(result) || result.startsWith("---") || result.startsWith("@@")) {
      const lines = result.split("\n");
      // Skip header lines (---/+++) when counting + and - so the stats only
      // reflect actual changes.
      let added = 0;
      let removed = 0;
      for (const ln of lines) {
        if (ln.startsWith("+++") || ln.startsWith("---")) continue;
        if (ln.startsWith("+")) added++;
        else if (ln.startsWith("-")) removed++;
      }
      return (
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded text-xs font-mono">
          {(added > 0 || removed > 0) && (
            <div className="px-2 py-1 border-b border-gray-200 dark:border-gray-700 text-[10px] text-gray-500 dark:text-gray-400 flex items-center gap-2">
              {added > 0 && <span className="text-green-700 dark:text-green-400">+{added}</span>}
              {removed > 0 && <span className="text-red-700 dark:text-red-400">−{removed}</span>}
              <span>line{added + removed === 1 ? "" : "s"}</span>
            </div>
          )}
          <div className="p-2 whitespace-pre-wrap">
            {lines.map((line, i) => (
              <div key={i} className={diffLineClass(line)}>{line || " "}</div>
            ))}
          </div>
        </div>
      );
    }
    return (
      <div className="text-xs text-gray-700 dark:text-gray-200 whitespace-pre-wrap font-mono">
        {truncate(result)}
      </div>
    );
  }

  // Fallback: raw text (preserved exactly as the agent emitted it), with
  // path-like tokens converted to clickable file-viewer links when a project
  // context is known.
  return (
    <pre className="text-xs font-mono whitespace-pre-wrap break-words text-gray-800 dark:text-gray-200">
      {linkifyPaths(truncate(result), projectId)}
    </pre>
  );
}

function diffLineClass(line: string): string {
  if (line.startsWith("+++") || line.startsWith("---")) return "text-gray-400";
  if (line.startsWith("@@")) return "text-blue-600 dark:text-blue-400";
  if (line.startsWith("+")) return "text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-950/40";
  if (line.startsWith("-")) return "text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-950/40";
  return "text-gray-700 dark:text-gray-300";
}

const MAX_PREVIEW = 8_000; // chars; the JSONL itself caps at 2000 bytes per result.
function truncate(s: string): string {
  if (s.length <= MAX_PREVIEW) return s;
  return s.slice(0, MAX_PREVIEW) + `\n\n… (${(s.length - MAX_PREVIEW).toLocaleString()} more characters)`;
}

const LANG_BY_EXT: Record<string, string> = {
  py: "python", js: "javascript", jsx: "jsx", ts: "typescript", tsx: "tsx",
  go: "go", rs: "rust", java: "java", kt: "kotlin", swift: "swift",
  rb: "ruby", php: "php", sh: "bash", bash: "bash", zsh: "bash",
  yml: "yaml", yaml: "yaml", json: "json", toml: "toml", md: "markdown",
  html: "html", css: "css", scss: "scss", sql: "sql", c: "c", h: "c",
  cpp: "cpp", hpp: "cpp", cs: "csharp", lua: "lua", r: "r",
};
