/** Split model ``<think>…</think>`` blocks from visible assistant text. */
export function splitThinking(raw: string): { content: string; thinking?: string } {
  const complete = /<think>([\s\S]*?)<\/think>/gi;
  const parts: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = complete.exec(raw)) !== null) {
    const t = m[1].trim();
    if (t) parts.push(t);
  }
  let content = raw.replace(complete, "");
  // Hide an incomplete open think block while tokens are still streaming.
  const open = content.search(/<think>/i);
  if (open !== -1) {
    content = content.slice(0, open);
  }
  content = content.replace(/<\/think>/gi, "");
  return {
    content,
    thinking: parts.length ? parts.join("\n\n") : undefined,
  };
}
