import { memo, useState } from "react";
import type { ChatAttachment } from "../../lib/gateway";
import { equalIgnoringFunctionProps } from "../../lib/memo_ignoring_callbacks";

interface Props {
  content: string;
  /** If provided, an Edit pencil appears on hover; clicking calls onRetry. */
  onRetry?: (newContent: string, attachments?: ChatAttachment[]) => Promise<void> | void;
  bookmarked?: boolean;
  onToggleBookmark?: () => void;
  attachments?: ChatAttachment[];
  onRevealAttachment?: (attachment: ChatAttachment) => void;
  onDownloadAttachment?: (attachment: ChatAttachment) => void;
  onDeleteAttachment?: (attachment: ChatAttachment) => void;
}

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function UserMessageImpl({
  content,
  onRetry,
  bookmarked,
  onToggleBookmark,
  attachments = [],
  onRevealAttachment,
  onDownloadAttachment,
  onDeleteAttachment,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(content);

  if (editing && onRetry) {
    return (
      <div className="mb-4">
        <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">You (editing)</div>
        <textarea
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") { e.preventDefault(); setEditing(false); setDraft(content); return; }
            // Enter resends; Shift+Enter inserts a newline (matches the
            // main composer's behavior). Cmd/Ctrl+Enter still works.
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              const final = draft.trim();
              if (final && final !== content) {
                setEditing(false);
                void onRetry(final, attachments);
              } else {
                setEditing(false);
              }
            }
          }}
          rows={Math.min(8, Math.max(2, draft.split("\n").length))}
          className="w-full px-3 py-2 text-sm bg-gray-50 dark:bg-gray-800 dark:text-gray-100 border border-gray-300 dark:border-gray-700 rounded outline-none"
        />
        <div className="mt-1 flex items-center gap-2 text-xs">
          <button
            onClick={() => {
              const final = draft.trim();
              if (final && final !== content) {
                setEditing(false);
                void onRetry(final);
              } else {
                setEditing(false);
              }
            }}
            className="px-2 py-1 bg-gray-900 text-white rounded hover:bg-gray-700 dark:bg-gray-100 dark:text-gray-900"
          >
            Resend
          </button>
          <button
            onClick={() => { setEditing(false); setDraft(content); }}
            className="px-2 py-1 text-gray-500 dark:text-gray-300 hover:text-gray-800"
          >
            Cancel
          </button>
          <span className="text-gray-400">↵ to resend · ⇧↵ for newline · Esc to cancel</span>
        </div>
      </div>
    );
  }

  return (
    <div className="mb-5 group">
      <div className="text-xs text-gray-500 dark:text-gray-400 mb-1 flex items-center justify-between">
        <span>You</span>
        <span className="flex items-center gap-2">
          {onToggleBookmark && (
            <button
              onClick={onToggleBookmark}
              title={bookmarked ? "Remove bookmark" : "Bookmark this turn"}
              className={
                "text-xs " +
                (bookmarked
                  ? "text-yellow-500 hover:text-yellow-600"
                  : "opacity-0 group-hover:opacity-100 transition-opacity text-gray-400 hover:text-yellow-500")
              }
            >
              ★
            </button>
          )}
          {onRetry && (
            <button
              onClick={() => { setDraft(content); setEditing(true); }}
              title="Edit & resend (drops everything after this turn)"
              className="opacity-0 group-hover:opacity-100 transition-opacity text-xs text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
            >
              ✎ edit
            </button>
          )}
        </span>
      </div>
      <div className="inline-block max-w-[88%] whitespace-pre-wrap rounded-lg bg-gray-100 px-3 py-2 leading-6 text-gray-800 dark:bg-gray-800 dark:text-gray-100">
        {content}
      </div>
      {attachments.length > 0 && (
        <div className="mt-2 flex max-w-[88%] flex-wrap gap-2">
          {attachments.map((attachment) => (
            <div
              key={attachment.id}
              className="min-w-0 rounded-md border border-gray-200 bg-white px-2 py-1.5 text-xs shadow-sm dark:border-gray-700 dark:bg-gray-900"
            >
              <div className="flex min-w-0 items-center gap-2">
                <span className="truncate font-medium text-gray-700 dark:text-gray-200">{attachment.filename}</span>
                <span className="shrink-0 text-gray-400">{attachment.kind} · {formatBytes(attachment.size)}</span>
              </div>
              {attachment.warnings?.length > 0 && (
                <div className="mt-1 max-w-sm truncate text-[11px] text-amber-600 dark:text-amber-400">
                  {attachment.warnings[0]}
                </div>
              )}
              <div className="mt-1 flex items-center gap-2 text-[11px]">
                {onRevealAttachment && (
                  <button
                    type="button"
                    className="text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100"
                    onClick={() => onRevealAttachment(attachment)}
                  >
                    Reveal
                  </button>
                )}
                {onDownloadAttachment && (
                  <button
                    type="button"
                    className="text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100"
                    onClick={() => onDownloadAttachment(attachment)}
                  >
                    Download
                  </button>
                )}
                {onDeleteAttachment && (
                  <button
                    type="button"
                    className="text-red-500 hover:text-red-700"
                    onClick={() => onDeleteAttachment(attachment)}
                  >
                    Delete
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// See lib/memo_ignoring_callbacks — ChatSurface hands every row a fresh
// inline callback per render; a plain memo would re-render (and, indirectly
// via list re-flow, cost) every row on every streamed token.
export const UserMessage = memo(UserMessageImpl, equalIgnoringFunctionProps);
