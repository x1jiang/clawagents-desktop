import { memo } from "react";
import { equalIgnoringFunctionProps } from "../../lib/memo_ignoring_callbacks";

interface Props {
  message: string;
  onRetry?: () => void;
}

function ErrorMessageImpl({ message, onRetry }: Props) {
  return (
    <div className="mb-4 border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 text-red-800 dark:text-red-200 rounded-md px-3 py-2 text-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 break-words">
          <span className="font-medium">Error:</span> {message}
        </div>
        {onRetry && (
          <button
            onClick={onRetry}
            title="Retry the previous turn"
            className="shrink-0 text-xs px-2 py-1 border border-red-300 dark:border-red-800 bg-white dark:bg-red-950 text-red-700 dark:text-red-200 rounded hover:bg-red-50 dark:hover:bg-red-900"
          >
            Retry
          </button>
        )}
      </div>
    </div>
  );
}

// See lib/memo_ignoring_callbacks.
export const ErrorMessage = memo(ErrorMessageImpl, equalIgnoringFunctionProps);
