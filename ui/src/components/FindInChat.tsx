import { useEffect, useMemo, useRef, useState } from "react";
import type { Message } from "../stores/chats";
import { HighlightedText } from "./HighlightedText";

interface Props {
  messages: Message[];
  open: boolean;
  onClose: () => void;
  onJump: (idx: number) => void;
}

/**
 * Cmd+F-style find overlay. Searches every message body (user, assistant,
 * tool_call args + result, info, error) case-insensitively. Up/Down cycles
 * matches; Enter jumps to the current match; Esc dismisses.
 */
export function FindInChat({ messages, open, onClose, onJump }: Props) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const hits: Array<{ idx: number; snippet: string }> = [];
    for (let i = 0; i < messages.length; i++) {
      const m = messages[i];
      let haystack = "";
      switch (m.kind) {
        case "user_message":
        case "assistant_message":
        case "info":
        case "error":
          haystack = (m as { content?: string; message?: string }).content
            ?? (m as { message?: string }).message
            ?? "";
          break;
        case "tool_call":
          haystack = `${m.name} ${JSON.stringify(m.args)} ${m.result ?? ""}`;
          break;
        case "permission_required":
          haystack = `${m.tool} ${m.file_path ?? ""} ${m.reason ?? ""}`;
          break;
        case "ask_user_required":
          haystack = m.question;
          break;
        case "file_changed":
          haystack = m.path;
          break;
        case "checkpoint":
          haystack = `${m.sha ?? ""} ${m.label ?? ""} ${m.tool ?? ""}`;
          break;
        case "compact_progress":
          haystack = `${m.phase ?? ""} ${m.message ?? ""}`;
          break;
      }
      const at = haystack.toLowerCase().indexOf(q);
      if (at === -1) continue;
      const start = Math.max(0, at - 30);
      const end = Math.min(haystack.length, at + q.length + 30);
      const snippet = (start > 0 ? "…" : "") + haystack.slice(start, end) + (end < haystack.length ? "…" : "");
      hits.push({ idx: i, snippet });
    }
    return hits;
  }, [messages, query]);

  useEffect(() => { setActive(0); }, [query]);

  if (!open) return null;

  return (
    <div className="absolute top-2 right-2 z-20 w-80 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded shadow-lg">
      <div className="flex items-center gap-1 px-2 py-1 border-b border-gray-200 dark:border-gray-800">
        <input
          ref={inputRef}
          type="text"
          placeholder="Find in chat…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") { e.preventDefault(); onClose(); }
            else if (e.key === "ArrowDown" || (e.key === "Enter" && !e.shiftKey)) {
              e.preventDefault();
              if (matches.length === 0) return;
              const next = (active + 1) % matches.length;
              setActive(next);
              onJump(matches[next].idx);
            } else if (e.key === "ArrowUp" || (e.key === "Enter" && e.shiftKey)) {
              e.preventDefault();
              if (matches.length === 0) return;
              const next = (active - 1 + matches.length) % matches.length;
              setActive(next);
              onJump(matches[next].idx);
            }
          }}
          className="flex-1 px-1 py-0.5 text-xs bg-transparent dark:text-gray-100 outline-none"
        />
        <span className="text-[10px] text-gray-400 font-mono">
          {matches.length === 0 && query ? "0" : matches.length === 0 ? "" : `${active + 1}/${matches.length}`}
        </span>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 text-sm leading-none"
          aria-label="Close find"
        >
          ×
        </button>
      </div>
      {matches.length > 0 && (
        <div className="max-h-48 overflow-y-auto">
          {matches.map((m, i) => (
            <button
              key={i}
              onMouseEnter={() => setActive(i)}
              onClick={() => { onJump(m.idx); }}
              className={
                "block w-full text-left px-2 py-1 text-[11px] truncate " +
                (i === active
                  ? "bg-blue-100 dark:bg-blue-900/50 text-blue-900 dark:text-blue-100"
                  : "text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800")
              }
            >
              <HighlightedText text={m.snippet} query={query} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
