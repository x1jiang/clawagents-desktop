export function ErrorMessage({ message }: { message: string }) {
  return (
    <div className="mb-4 border border-red-200 bg-red-50 text-red-800 rounded-md px-3 py-2 text-sm">
      Error: {message}
    </div>
  );
}
