/**
 * Heuristic: does `text` look like a project-relative file path the agent
 * dropped into inline code? We use this to decide whether to make
 * `` `src/foo.ts` `` a clickable link to the file viewer.
 *
 * Rules (conservative — false positives are worse than false negatives):
 *   - contains at least one "/", AND
 *   - contains at least one "." (a file extension), AND
 *   - the basename starts with an alphanumeric, AND
 *   - no whitespace, AND
 *   - not absolute (no leading "/")
 *   - not a URL (no "://")
 *
 * `extractPath(raw)` strips a trailing `:LINENO[:COL]` suffix so a path like
 * "src/foo.ts:42" still resolves to "src/foo.ts".
 */
export function looksLikePath(text: string): boolean {
  if (!text) return false;
  if (/\s/.test(text)) return false;
  if (text.includes("://")) return false;
  if (text.startsWith("/")) return false;
  if (!text.includes("/")) return false;
  if (!text.includes(".")) return false;
  const stripped = extractPath(text);
  const basename = stripped.split("/").pop() ?? "";
  // Must look like a real filename — starts alnum, ends in an alnum-ext.
  if (!/^[A-Za-z0-9_.]/.test(basename)) return false;
  if (!/\.[A-Za-z0-9_+\-]{1,10}$/.test(basename)) return false;
  return true;
}

export function extractPath(text: string): string {
  // Drop a trailing :LINE or :LINE:COL — common in stack traces / search hits.
  return text.replace(/(:[0-9]+){1,2}$/, "");
}
