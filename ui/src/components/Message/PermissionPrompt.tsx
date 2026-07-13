type Decision = "allow_once" | "allow_always" | "deny";

interface Props {
  request_id: string;
  tool: string;
  file_path?: string;
  reason: string;
  projectId: string | null;
  resolved?: Decision;
  onResolve: (decision: Decision) => void;
}

export function PermissionPrompt({ tool, file_path, reason, projectId, resolved, onResolve }: Props) {
  if (resolved) {
    return (
      <div className="mb-3 border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 rounded-md px-3 py-2 text-xs text-gray-600 dark:text-gray-300">
        <strong>{tool}</strong>{file_path ? ` ${file_path}` : ""} — decision: {resolved}
      </div>
    );
  }

  return (
    <div className="mb-3 border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/40 rounded-md px-3 py-2 text-sm">
      <div className="font-medium text-amber-900 dark:text-amber-200 mb-1">⚠ Permission required</div>
      <div className="text-gray-800 dark:text-gray-100 mb-2">
        Agent wants to use <strong>{tool}</strong>
        {file_path && <> on <code className="font-mono text-xs">{file_path}</code></>}.
      </div>
      <div className="text-xs text-gray-600 dark:text-gray-300 mb-2">{reason}</div>
      <div className="flex gap-2">
        <button
          onClick={() => onResolve("allow_once")}
          className="px-2 py-1 text-xs bg-gray-900 text-white rounded hover:bg-gray-700 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-gray-300"
        >
          Allow once
        </button>
        {projectId !== null && (
          <button
            onClick={() => onResolve("allow_always")}
            className="px-2 py-1 text-xs border border-gray-300 dark:border-gray-600 dark:text-gray-200 rounded hover:bg-white dark:hover:bg-gray-800"
          >
            Allow always for project
          </button>
        )}
        <button
          onClick={() => onResolve("deny")}
          className="px-2 py-1 text-xs border border-gray-300 dark:border-gray-600 dark:text-gray-200 rounded hover:bg-white dark:hover:bg-gray-800"
        >
          Deny
        </button>
      </div>
    </div>
  );
}
