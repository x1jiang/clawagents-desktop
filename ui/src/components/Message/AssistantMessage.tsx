import { Markdown } from "../../lib/markdown";
import { ThinkingBlock } from "./ThinkingBlock";
import { CopyButton } from "../CopyButton";

function TypingDots() {
  return (
    <span aria-label="Assistant is thinking" className="inline-flex items-center gap-1 text-gray-400 dark:text-gray-500">
      <span className="w-1.5 h-1.5 rounded-full bg-current animate-bounce" style={{ animationDelay: "0ms" }} />
      <span className="w-1.5 h-1.5 rounded-full bg-current animate-bounce" style={{ animationDelay: "150ms" }} />
      <span className="w-1.5 h-1.5 rounded-full bg-current animate-bounce" style={{ animationDelay: "300ms" }} />
    </span>
  );
}

interface Props {
  content: string;
  thinking?: string;
  projectId?: string | null;
  /** If provided, a Regenerate button appears on hover. */
  onRegenerate?: () => void;
}

export function AssistantMessage({ content, thinking, projectId, onRegenerate }: Props) {
  return (
    <div className="mb-5 group">
      <div className="text-xs text-gray-500 dark:text-gray-400 mb-1 flex items-center justify-between">
        <span>Agent</span>
        {content && (
          <span className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1">
            {onRegenerate && (
              <button
                onClick={onRegenerate}
                title="Drop this reply and re-run the previous turn"
                className="text-xs px-2 py-0.5 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-500 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
              >
                ↻ Regenerate
              </button>
            )}
            <CopyButton text={content} title="Copy message" />
          </span>
        )}
      </div>
      {thinking && <ThinkingBlock content={thinking} />}
      <div className="text-gray-800 dark:text-gray-100 leading-7">
        {content ? <Markdown projectId={projectId}>{content}</Markdown> : <TypingDots />}
      </div>
    </div>
  );
}
