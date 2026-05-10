export function UserMessage({ content }: { content: string }) {
  return (
    <div className="mb-4">
      <div className="text-xs text-gray-500 mb-1">You</div>
      <div className="bg-gray-100 rounded-lg px-3 py-2 inline-block whitespace-pre-wrap">{content}</div>
    </div>
  );
}
