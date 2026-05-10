import { Markdown } from "../../lib/markdown";

export function AssistantMessage({ content }: { content: string }) {
  return (
    <div className="mb-4">
      <div className="text-xs text-gray-500 mb-1">Agent</div>
      <div className="text-gray-800">
        {content ? <Markdown>{content}</Markdown> : "…"}
      </div>
    </div>
  );
}
