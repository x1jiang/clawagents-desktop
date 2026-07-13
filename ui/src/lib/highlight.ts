/**
 * Split `text` on case-insensitive occurrences of `needle`. Returns a flat
 * list of segments so callers can render them inline — each segment is
 * either a plain `{ text }` chunk or a `{ text, match: true }` hit.
 *
 * Empty/whitespace needle returns one non-match segment so renderers can
 * still rely on the array shape.
 */
export interface HighlightSegment {
  text: string;
  match?: boolean;
}

export function splitHighlight(text: string, needle: string): HighlightSegment[] {
  if (!needle.trim()) return [{ text }];
  const lower = text.toLowerCase();
  const target = needle.toLowerCase();
  const out: HighlightSegment[] = [];
  let cursor = 0;
  let idx = lower.indexOf(target, cursor);
  while (idx !== -1) {
    if (idx > cursor) out.push({ text: text.slice(cursor, idx) });
    out.push({ text: text.slice(idx, idx + target.length), match: true });
    cursor = idx + target.length;
    idx = lower.indexOf(target, cursor);
  }
  if (cursor < text.length) out.push({ text: text.slice(cursor) });
  return out;
}
