interface Props {
  request_id: string;
  plan_text: string;
  resolved?: "approve" | "request_changes" | "reject";
  onResolve: (decision: "approve" | "request_changes" | "reject", comment?: string) => void | Promise<void>;
}

export function PlanApprovalPrompt({ plan_text, resolved, onResolve }: Props) {
  if (resolved) {
    const label =
      resolved === "approve"
        ? "Approved"
        : resolved === "request_changes"
          ? "Changes requested"
          : "Rejected";
    return (
      <div className="mb-3 border border-gray-200 dark:border-gray-700 rounded-md px-3 py-2 text-sm text-gray-600 dark:text-gray-300">
        Plan exit: {label}
      </div>
    );
  }

  return (
    <div className="mb-3 border border-sky-300 dark:border-sky-700 bg-sky-50 dark:bg-sky-950/40 rounded-md px-3 py-2 text-sm">
      <div className="font-medium text-sky-900 dark:text-sky-200 mb-1">Plan approval required</div>
      <div className="text-xs text-gray-700 dark:text-gray-200 mb-2 max-h-48 overflow-y-auto whitespace-pre-wrap font-mono">
        {plan_text.trim() || "(empty plan)"}
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void onResolve("approve")}
          className="px-2 py-1 text-xs bg-gray-900 text-white rounded hover:bg-gray-700 dark:bg-gray-100 dark:text-gray-900"
        >
          Approve
        </button>
        <button
          type="button"
          onClick={() => {
            const comment = window.prompt("What should change in the plan?") || "";
            void onResolve("request_changes", comment);
          }}
          className="px-2 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded"
        >
          Request changes
        </button>
        <button
          type="button"
          onClick={() => void onResolve("reject")}
          className="px-2 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded"
        >
          Reject
        </button>
      </div>
    </div>
  );
}
