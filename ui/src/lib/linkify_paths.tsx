import { useUI } from "../stores/ui";
import { looksLikePath, extractPath } from "./looks_like_path";

// Token candidates inside plain-text tool output. Captures things like
// "src/foo.ts", ".agents/skills/docx", "backend/src/...py:42". Conservative:
// allows letters/digits/underscore/dash/dot/slash/colon only.
const PATH_TOKEN_RE = /[\w.\-/]+(?::\d+(?::\d+)?)?/g;

/**
 * Split `text` into alternating plain-text / clickable-path segments.
 * Returned segments are React-renderable; callers drop them inline into
 * a `<pre>` or similar container. When `projectId` is null the helper
 * short-circuits and returns the text as one non-link segment so callers
 * can avoid an extra branch.
 */
export function linkifyPaths(text: string, projectId: string | null): React.ReactNode[] {
  if (!projectId || !text) return [text];
  PATH_TOKEN_RE.lastIndex = 0;
  const out: React.ReactNode[] = [];
  let cursor = 0;
  let key = 0;
  let m: RegExpExecArray | null;
  while ((m = PATH_TOKEN_RE.exec(text)) !== null) {
    const token = m[0];
    if (!looksLikePath(token)) continue;
    const start = m.index;
    if (cursor < start) out.push(text.slice(cursor, start));
    out.push(
      <InlinePathButton key={`p${key++}`} raw={token} projectId={projectId} />,
    );
    cursor = start + token.length;
  }
  if (cursor === 0) return [text];
  if (cursor < text.length) out.push(text.slice(cursor));
  return out;
}

function InlinePathButton({ raw, projectId }: { raw: string; projectId: string }) {
  const open = useUI((s) => s.openFileViewer);
  return (
    <button
      type="button"
      onClick={() => open(projectId, extractPath(raw))}
      title={`Open ${extractPath(raw)}`}
      className="text-inherit underline decoration-dotted decoration-blue-400/70 underline-offset-2 hover:text-blue-700 dark:hover:text-blue-300"
    >
      {raw}
    </button>
  );
}
