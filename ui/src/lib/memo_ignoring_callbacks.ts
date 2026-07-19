/**
 * A React.memo comparator for message-row components.
 *
 * ChatSurface's message list is rebuilt from a fresh array on every
 * streamed token (see stores/chats.ts appendEvent), and every row is handed
 * inline callback props (`onRetry={() => ...}` etc) that get a NEW function
 * identity on every ChatSurface render regardless of whether that row's own
 * data changed. Plain `React.memo` would see those "changed" callback props
 * and re-render (and, for AssistantMessage, re-parse Markdown for) every row
 * on every token — exactly the cost memoization was meant to remove.
 *
 * Callback *identity* doesn't matter for correctness here: each closure
 * reads whatever it needs from ChatSurface's live scope at call time, and
 * unchanged rows keep the same underlying message object reference (see
 * appendEvent — only the currently-streaming row's object is replaced). So
 * comparing only the non-function props is the right equality check: it
 * correctly treats an unchanged row as equal even though its callbacks were
 * freshly re-created, and correctly treats a changed row (new content/args/
 * result reference) as different.
 */
export function equalIgnoringFunctionProps<P extends Record<string, unknown>>(
  prev: P,
  next: P,
): boolean {
  const keys = Object.keys({ ...prev, ...next }) as Array<keyof P>;
  for (const key of keys) {
    const a = prev[key];
    const b = next[key];
    if (typeof a === "function" && typeof b === "function") continue;
    if (!Object.is(a, b)) return false;
  }
  return true;
}
