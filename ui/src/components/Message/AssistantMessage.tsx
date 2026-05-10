import { Markdown } from "../../lib/markdown";
import { ThinkingBlock } from "./ThinkingBlock";

interface Props {
  content: string;
  thinking?: string;
}

export function AssistantMessage({ content, thinking }: Props) {
  return (
    <div className="mb-4">
      <div className="text-xs text-gray-500 mb-1">Agent</div>
      {thinking && <ThinkingBlock content={thinking} />}
      <div className="text-gray-800">
        {content ? <Markdown>{content}</Markdown> : "…"}
      </div>
    </div>
  );
}
