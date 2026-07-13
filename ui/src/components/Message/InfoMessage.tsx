interface Props {
  message: string;
}

export function InfoMessage({ message }: Props) {
  return (
    <div className="mb-3 px-3 py-2 bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900 rounded text-xs text-blue-700 dark:text-blue-200 whitespace-pre-wrap font-mono">
      {message}
    </div>
  );
}
