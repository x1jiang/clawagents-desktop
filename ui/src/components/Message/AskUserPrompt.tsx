import { useState } from "react";

interface Props {
  requestId: string;
  question: string;
  resolved?: boolean;
  answer?: string | null;
  onReply: (answer: string | null, skip: boolean) => void;
}

export function AskUserPrompt({ question, resolved, answer, onReply }: Props) {
  const [draft, setDraft] = useState("");

  if (resolved) {
    return (
      <div className="mb-3 border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 rounded-md px-3 py-2 text-xs text-gray-600 dark:text-gray-300">
        Agent asked: {question}
        <div className="mt-1">
          {answer == null ? "Skipped" : <>Answer: <span className="font-medium text-gray-800 dark:text-gray-100">{answer}</span></>}
        </div>
      </div>
    );
  }

  return (
    <div className="mb-3 border border-sky-300 dark:border-sky-700 bg-sky-50 dark:bg-sky-950/40 rounded-md px-3 py-2 text-sm">
      <div className="font-medium text-sky-900 dark:text-sky-200 mb-1">Agent asks</div>
      <div className="text-gray-800 dark:text-gray-100 mb-2 whitespace-pre-wrap">{question}</div>
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        rows={2}
        className="w-full text-sm border border-gray-300 dark:border-gray-600 rounded px-2 py-1 bg-white dark:bg-gray-900 mb-2"
        placeholder="Your answer…"
      />
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => onReply(draft.trim() || null, false)}
          className="px-2 py-1 text-xs bg-gray-900 text-white rounded hover:bg-gray-700 dark:bg-gray-100 dark:text-gray-900"
        >
          Reply
        </button>
        <button
          type="button"
          onClick={() => onReply(null, true)}
          className="px-2 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded"
        >
          Skip
        </button>
      </div>
    </div>
  );
}
