import { useState } from "react";

export function ThinkingBlock({ content }: { content: string }) {
  const [open, setOpen] = useState(false);

  if (!content) return null;

  return (
    <div className="mb-2 text-xs">
      <button
        className="text-gray-500 hover:text-gray-800 italic"
        onClick={() => setOpen((o) => !o)}
      >
        {open ? "▾" : "▸"} thinking ({content.length} chars)
      </button>
      {open && (
        <div className="mt-1 pl-3 border-l-2 border-gray-200 text-gray-500 whitespace-pre-wrap">
          {content}
        </div>
      )}
    </div>
  );
}
