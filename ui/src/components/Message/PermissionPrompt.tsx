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
      <div className="mb-3 border border-gray-200 bg-gray-50 rounded-md px-3 py-2 text-xs text-gray-600">
        <strong>{tool}</strong>{file_path ? ` ${file_path}` : ""} — decision: {resolved}
      </div>
    );
  }

  return (
    <div className="mb-3 border border-amber-300 bg-amber-50 rounded-md px-3 py-2 text-sm">
      <div className="font-medium text-amber-900 mb-1">⚠ Permission required</div>
      <div className="text-gray-800 mb-2">
        Agent wants to use <strong>{tool}</strong>
        {file_path && <> on <code className="font-mono text-xs">{file_path}</code></>}.
      </div>
      <div className="text-xs text-gray-600 mb-2">{reason}</div>
      <div className="flex gap-2">
        <button
          onClick={() => onResolve("allow_once")}
          className="px-2 py-1 text-xs bg-gray-900 text-white rounded hover:bg-gray-700"
        >
          Allow once
        </button>
        {projectId !== null && (
          <button
            onClick={() => onResolve("allow_always")}
            className="px-2 py-1 text-xs border border-gray-300 rounded hover:bg-white"
          >
            Allow always for project
          </button>
        )}
        <button
          onClick={() => onResolve("deny")}
          className="px-2 py-1 text-xs border border-gray-300 rounded hover:bg-white"
        >
          Deny
        </button>
      </div>
    </div>
  );
}
