import { splitHighlight } from "../lib/highlight";

interface Props {
  text: string;
  query: string;
}

/**
 * Render `text` with every case-insensitive occurrence of `query` wrapped in
 * a subtle amber <mark>. Used by FindInChat, SearchModal, and the
 * ConversationOutline filter so the user can see *where* in the snippet
 * the match landed without scanning by eye.
 */
export function HighlightedText({ text, query }: Props) {
  return (
    <>
      {splitHighlight(text, query).map((seg, i) =>
        seg.match ? (
          <mark key={i} className="bg-yellow-200 dark:bg-yellow-700/60 text-inherit rounded px-0.5">
            {seg.text}
          </mark>
        ) : (
          <span key={i}>{seg.text}</span>
        ),
      )}
    </>
  );
}
