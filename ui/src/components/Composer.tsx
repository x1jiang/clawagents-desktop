import { useState, type KeyboardEvent, type ReactNode } from "react";

interface Props {
  onSend: (content: string) => void;
  disabled?: boolean;
  leftSlot?: ReactNode;
}

export function Composer({ onSend, disabled, leftSlot }: Props) {
  const [text, setText] = useState("");

  function send() {
    const trimmed = text.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setText("");
  }

  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      send();
    }
  }

  return (
    <div className="border-t border-gray-200 p-3">
      {leftSlot && <div className="mb-2 flex items-center gap-2">{leftSlot}</div>}
      <div className="flex items-end gap-2 bg-white border border-gray-300 rounded-lg p-2">
        <textarea
          className="flex-1 resize-none outline-none text-sm leading-snug min-h-[36px] max-h-[200px]"
          placeholder="Ask something… (⌘↵ to send)"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKey}
          rows={1}
          disabled={disabled}
        />
        <button
          className="px-3 py-1.5 bg-gray-900 text-white text-sm rounded-md hover:bg-gray-700 disabled:opacity-50"
          onClick={send}
          disabled={disabled || !text.trim()}
        >
          Send
        </button>
      </div>
    </div>
  );
}
