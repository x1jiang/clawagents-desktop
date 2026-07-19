import { memo } from "react";

interface Props {
  message: string;
}

function InfoMessageImpl({ message }: Props) {
  return (
    <div className="mb-3 px-3 py-2 bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900 rounded text-xs text-blue-700 dark:text-blue-200 whitespace-pre-wrap font-mono">
      {message}
    </div>
  );
}

// InfoMessage has no function-typed props, so a plain memo (no custom
// comparator needed) already avoids re-render when `message` is unchanged.
export const InfoMessage = memo(InfoMessageImpl);
