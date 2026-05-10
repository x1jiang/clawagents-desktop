interface Props {
  projectId: string | null;
  chatId: string;
}

export function ChatSurface({ projectId, chatId }: Props) {
  return (
    <div className="p-6">
      <p className="text-sm text-gray-500">
        Chat surface (project={projectId ?? "none"}, chat={chatId}) — implemented in Task 8.
      </p>
    </div>
  );
}
