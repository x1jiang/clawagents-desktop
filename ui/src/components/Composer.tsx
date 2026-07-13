import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useProjectGateway } from "../lib/project_client";
import { SLASH_COMMANDS } from "../lib/slash_commands";
import { useCustomCommands } from "../stores/custom_commands";
import { estimateCostUsd, formatCostUsd } from "../lib/pricing";
import { pushToast } from "../stores/toasts";

interface Props {
  onSend: (content: string) => void;
  disabled?: boolean;
  leftSlot?: ReactNode;
  /** Project id to drive @-mention autocomplete; null for projectless chats. */
  projectId?: string | null;
  /** External value control (e.g. for slash-command insertion or draft sync). */
  value?: string;
  onChange?: (value: string) => void;
  /** Ordered list of past user prompts in this chat, oldest first.
   *  ↑/↓ in an empty composer cycles through them (most recent first).
   */
  history?: string[];
  /** Model id, used for the cost preview alongside the char/token counter. */
  model?: string;
  onFilesSelected?: (files: File[]) => void;
  canSendEmpty?: boolean;
  emptySendContent?: string;
}

interface MentionState {
  /** Index of the `@` that started the current mention. */
  start: number;
  /** Substring after `@` up to caret (the live filter). */
  query: string;
  /** Files matching the query. */
  matches: Array<{ path: string }>;
  /** Active index in `matches` for arrow-key navigation. */
  active: number;
}

interface SlashState {
  /** Substring after `/` up to caret (live filter). */
  query: string;
  /** Matching commands. */
  matches: Array<{ name: string; description: string; usage?: string }>;
  active: number;
}

export function Composer({ onSend, disabled, leftSlot, projectId, value, onChange, history = [], model, onFilesSelected, canSendEmpty = false, emptySendContent = "Analyze the attached files." }: Props) {
  const [internalText, setInternalText] = useState("");
  const text = value !== undefined ? value : internalText;
  const setText = (next: string) => {
    if (onChange) onChange(next);
    else setInternalText(next);
  };
  /**
   * Index into `history` for the up-arrow recall feature.
   * -1 means "no history entry active" (current draft is freely edited).
   * The list is treated as newest-last, so we count from the end.
   */
  const [historyIdx, setHistoryIdx] = useState(-1);

  const client = useProjectGateway(projectId);
  const customCommands = useCustomCommands((s) => s.commands);
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [mention, setMention] = useState<MentionState | null>(null);
  const [slash, setSlash] = useState<SlashState | null>(null);
  const [preview, setPreview] = useState<{ path: string; content: string; truncated: boolean } | null>(null);

  function send() {
    const trimmed = text.trim();
    if ((!trimmed && !canSendEmpty) || disabled) return;
    onSend(trimmed || emptySendContent);
    setText("");
    setMention(null);
    setSlash(null);
    setHistoryIdx(-1);
  }

  function updateAutocomplete(nextText: string, caret: number) {
    // Slash command: at the very start, or after a leading whitespace burst.
    if (nextText.startsWith("/") && caret <= nextText.length) {
      const upToCaret = nextText.slice(0, caret);
      if (!/\s/.test(upToCaret)) {
        const query = upToCaret.slice(1).toLowerCase();
        const builtins = SLASH_COMMANDS
          .filter((c) => c.name.startsWith(query))
          .map((c) => ({ name: c.name, description: c.description, usage: c.usage as string | undefined }));
        const customs = customCommands
          .filter((c) => c.name.toLowerCase().startsWith(query))
          .map((c) => ({ name: c.name, description: `(custom) ${c.description}`, usage: undefined }));
        const matches = [...builtins, ...customs];
        setSlash({ query, matches, active: 0 });
        setMention(null);
        return;
      }
    }
    setSlash(null);

    // @-mention: find the latest @ in the text-before-caret, with no whitespace
    // between @ and caret.
    if (!projectId || !client) { setMention(null); return; }
    const before = nextText.slice(0, caret);
    const at = before.lastIndexOf("@");
    if (at === -1) { setMention(null); return; }
    const sliver = before.slice(at + 1);
    if (/\s/.test(sliver)) { setMention(null); return; }
    // Need either start-of-text or whitespace before the @.
    if (at > 0 && !/\s/.test(nextText[at - 1])) { setMention(null); return; }

    setMention((prev) => ({
      start: at,
      query: sliver,
      matches: prev?.matches ?? [],
      active: 0,
    }));
    // Fire the file fetch (debounced by overwriting the state).
    void (async () => {
      try {
        const matches = await client.listProjectFiles(projectId, sliver);
        setMention((current) =>
          current && current.start === at && current.query === sliver
            ? { ...current, matches }
            : current,
        );
      } catch {
        // best-effort autocomplete; silently ignore failures
      }
    })();
  }

  // Debounced preview fetch — fires when the active mention candidate
  // changes. Keeps the popup responsive instead of one request per keystroke.
  useEffect(() => {
    if (!mention || !projectId || !client || mention.matches.length === 0) {
      setPreview(null);
      return;
    }
    const active = mention.matches[mention.active];
    if (!active) { setPreview(null); return; }
    let cancelled = false;
    const id = setTimeout(async () => {
      try {
        const p = await client.previewProjectFile(projectId, active.path);
        if (!cancelled) setPreview({ path: p.path, content: p.content, truncated: p.truncated });
      } catch {
        if (!cancelled) setPreview(null);
      }
    }, 120);
    return () => { cancelled = true; clearTimeout(id); };
  }, [mention, projectId, client]);

  function applyMention(selectedPath: string) {
    if (!mention) return;
    const before = text.slice(0, mention.start);
    const after = text.slice(mention.start + 1 + mention.query.length);
    const next = `${before}@${selectedPath} ${after.startsWith(" ") ? after.trimStart() : after}`;
    setText(next);
    setMention(null);
    // Move caret to right after the inserted path + trailing space.
    requestAnimationFrame(() => {
      const ta = taRef.current;
      if (!ta) return;
      const pos = before.length + 1 + selectedPath.length + 1;
      ta.setSelectionRange(pos, pos);
      ta.focus();
    });
  }

  function applySlash(name: string) {
    setText(`/${name} `);
    setSlash(null);
    requestAnimationFrame(() => taRef.current?.focus());
  }

  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    // Mention popup keybindings take priority over send.
    if (mention && mention.matches.length > 0) {
      if (e.key === "ArrowDown") { e.preventDefault(); setMention({ ...mention, active: (mention.active + 1) % mention.matches.length }); return; }
      if (e.key === "ArrowUp")   { e.preventDefault(); setMention({ ...mention, active: (mention.active - 1 + mention.matches.length) % mention.matches.length }); return; }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        applyMention(mention.matches[mention.active].path);
        return;
      }
      if (e.key === "Escape") { e.preventDefault(); setMention(null); return; }
    }
    if (slash && slash.matches.length > 0) {
      if (e.key === "ArrowDown") { e.preventDefault(); setSlash({ ...slash, active: (slash.active + 1) % slash.matches.length }); return; }
      if (e.key === "ArrowUp")   { e.preventDefault(); setSlash({ ...slash, active: (slash.active - 1 + slash.matches.length) % slash.matches.length }); return; }
      if (e.key === "Tab") { e.preventDefault(); applySlash(slash.matches[slash.active].name); return; }
      // Enter falls through to send if the user wants to send /help as-is; Tab is the picker.
      if (e.key === "Escape") { e.preventDefault(); setSlash(null); return; }
    }

    // Enter sends; Shift+Enter inserts a newline. Cmd/Ctrl+Enter still
    // works for muscle memory. Composition mode (IME) is bypassed so
    // committing a Japanese/Chinese character doesn't accidentally send.
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send();
      return;
    }

    // History recall: ↑/↓ when nothing else is active.
    // Only triggers when the composer is empty OR the user is already navigating
    // history (so it doesn't hijack arrow keys mid-edit).
    if (history.length > 0 && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      const ta = taRef.current;
      const isEmpty = !text;
      const inHistory = historyIdx !== -1;
      if (!isEmpty && !inHistory) return;
      // Only at caret position 0 — otherwise the arrow should move the cursor.
      if (ta && ta.selectionStart !== 0) return;

      e.preventDefault();
      if (e.key === "ArrowUp") {
        const next = historyIdx === -1 ? history.length - 1 : Math.max(0, historyIdx - 1);
        setHistoryIdx(next);
        setText(history[next] ?? "");
      } else {
        // Down: move toward newest, then exit history into empty draft.
        if (historyIdx === -1) return;
        const next = historyIdx + 1;
        if (next >= history.length) {
          setHistoryIdx(-1);
          setText("");
        } else {
          setHistoryIdx(next);
          setText(history[next] ?? "");
        }
      }
    }
  }

  function onTextChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const next = e.target.value;
    setText(next);
    // Once the user types after recalling history, decouple from the
    // history index so further ↑/↓ doesn't yank their edits.
    if (historyIdx !== -1 && next !== history[historyIdx]) {
      setHistoryIdx(-1);
    }
    const caret = e.target.selectionStart ?? next.length;
    updateAutocomplete(next, caret);
  }

  function onDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    // 1. In-app drop from the file tree — preserves the project-relative path.
    const inApp = e.dataTransfer.getData("application/x-clawagents-path");
    if (inApp) {
      const sep = text.length === 0 || /\s$/.test(text) ? "" : " ";
      setText(`${text}${sep}@${inApp} `);
      return;
    }
    // 2. External file drop — browsers only expose the bare filename for
    // security. Useful as a starting point; the user can add a path prefix.
    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      if (onFilesSelected) {
        onFilesSelected(Array.from(files));
        return;
      }
      const names = Array.from(files).map((f) => f.name);
      const inserted = names.map((n) => `@${n}`).join(" ");
      const sep = text.length === 0 || /\s$/.test(text) ? "" : " ";
      setText(`${text}${sep}${inserted} `);
    }
  }

  // Refresh autocomplete on caret moves (so clicking inside the text re-shows
  // the popup if appropriate).
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    const handler = () => updateAutocomplete(ta.value, ta.selectionStart ?? ta.value.length);
    ta.addEventListener("click", handler);
    ta.addEventListener("keyup", handler);
    return () => {
      ta.removeEventListener("click", handler);
      ta.removeEventListener("keyup", handler);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, client]);

  // Auto-grow textarea: collapse to natural content height while typing, then
  // let the max-h-[200px] tailwind class clamp it (scrollbar kicks in past 200px).
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${ta.scrollHeight}px`;
  }, [text]);

  return (
    <div className="border-t border-gray-200 dark:border-gray-800 p-3">
      {leftSlot && <div className="mb-2 flex items-center gap-2">{leftSlot}</div>}
      <div className="relative">
        {mention && mention.matches.length > 0 && (
          <div className="absolute bottom-full left-0 mb-1 flex gap-0 z-10">
            <div className="w-80 max-h-64 overflow-y-auto bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-l shadow-lg">
              {mention.matches.map((f, i) => (
                <button
                  type="button"
                  key={f.path}
                  onMouseEnter={() => setMention({ ...mention, active: i })}
                  onMouseDown={(e) => { e.preventDefault(); applyMention(f.path); }}
                  className={
                    "block w-full text-left px-3 py-1.5 text-xs font-mono truncate " +
                    (i === mention.active
                      ? "bg-blue-100 text-blue-900 dark:bg-blue-900 dark:text-blue-100"
                      : "text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700")
                  }
                >
                  {f.path}
                </button>
              ))}
            </div>
            {preview && (
              <div className="w-96 max-h-64 overflow-y-auto bg-gray-50 dark:bg-gray-900 border-t border-r border-b border-gray-300 dark:border-gray-700 rounded-r shadow-lg p-2 text-[10px] font-mono whitespace-pre text-gray-700 dark:text-gray-300">
                <div className="mb-1 text-gray-400 dark:text-gray-500">
                  {preview.path}{preview.truncated && " · (truncated)"}
                </div>
                {preview.content}
              </div>
            )}
          </div>
        )}
        {slash && slash.matches.length > 0 && (
          <div className="absolute bottom-full left-0 mb-1 w-80 max-h-64 overflow-y-auto bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded shadow-lg z-10">
            {slash.matches.map((c, i) => (
              <button
                type="button"
                key={c.name}
                onMouseDown={(e) => { e.preventDefault(); applySlash(c.name); }}
                className={
                  "block w-full text-left px-3 py-1.5 text-xs " +
                  (i === slash.active
                    ? "bg-blue-100 text-blue-900 dark:bg-blue-900 dark:text-blue-100"
                    : "text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700")
                }
              >
                <span className="font-mono">/{c.name}{c.usage ? " " + c.usage : ""}</span>
                <span className="ml-2 text-gray-500 dark:text-gray-400">{c.description}</span>
              </button>
            ))}
          </div>
        )}
        <div
          className="flex items-end gap-2 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-lg p-2"
          onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; }}
          onDrop={onDrop}
        >
          {onFilesSelected && (
            <>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                accept=".txt,.md,.csv,.tsv,.json,.xml,.log,.pdf,.docx,.xlsx,.pptx,.png,.jpg,.jpeg,.gif,.webp,.bmp,.svg,image/*,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.openxmlformats-officedocument.presentationml.presentation"
                onChange={(e) => {
                  const files = Array.from(e.target.files ?? []);
                  if (files.length > 0) onFilesSelected(files);
                  e.currentTarget.value = "";
                }}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={disabled}
                title="Attach files for analysis"
                className="rounded-md border border-gray-200 px-2 py-1.5 text-sm text-gray-500 hover:bg-gray-50 hover:text-gray-800 disabled:opacity-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800 dark:hover:text-gray-100"
              >
                📎
              </button>
            </>
          )}
          <textarea
            ref={taRef}
            data-composer
            className="flex-1 resize-none outline-none text-sm leading-snug min-h-[36px] max-h-[200px] bg-transparent dark:text-gray-100 dark:placeholder-gray-500"
            placeholder={projectId ? "Ask something… (↵ to send, ⇧↵ for newline, @ for files)" : "Ask something… (↵ to send, ⇧↵ for newline)"}
            value={text}
            onChange={onTextChange}
            onKeyDown={onKey}
            onPaste={(e) => {
              // Big pastes are usually log dumps / file contents. Hint the
              // user that @-mentioning the file is cheaper than pasting it,
              // and that they can /compact afterwards if the context fills up.
              const pasted = e.clipboardData.getData("text") ?? "";
              if (pasted.length > 5000) {
                const tip = projectId
                  ? "Tip: prefer @path/to/file over pasting a whole file — the agent reads it on demand."
                  : "Long paste — consider /compact later to free context space.";
                pushToast(`Pasted ${pasted.length.toLocaleString()} chars. ${tip}`, "info");
              }
            }}
            rows={1}
            disabled={disabled}
          />
          <button
            className="px-3 py-1.5 bg-gray-900 text-white text-sm rounded-md hover:bg-gray-700 disabled:opacity-50 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-gray-300"
            onClick={send}
            disabled={disabled || (!text.trim() && !canSendEmpty)}
          >
            Send
          </button>
        </div>
        {text.length > 300 && (() => {
          // Heuristic: ~4 chars per token. Real tokenization depends on the
          // model — this is just a useful order-of-magnitude.
          const approxTokens = Math.round(text.length / 4);
          const cost = model
            ? estimateCostUsd(model, { input_tokens: approxTokens, output_tokens: 0, cached_input_tokens: 0 })
            : null;
          return (
            <div className="mt-1 text-right text-[10px] text-gray-400 dark:text-gray-500 font-mono">
              {text.length.toLocaleString()} ch · ~{approxTokens.toLocaleString()} tok
              {cost !== null && ` · ~${formatCostUsd(cost)} input`}
            </div>
          );
        })()}
      </div>
    </div>
  );
}
