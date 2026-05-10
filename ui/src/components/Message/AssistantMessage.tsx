export function AssistantMessage({ content }: { content: string }) {
  return (
    <div className="mb-4">
      <div className="text-xs text-gray-500 mb-1">Agent</div>
      <div className="text-gray-800 whitespace-pre-wrap">{content || "…"}</div>
    </div>
  );
}
