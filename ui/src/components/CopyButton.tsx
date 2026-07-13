import { useState } from "react";
import { pushToast } from "../stores/toasts";

interface Props {
  text: string;
  className?: string;
  label?: string;
  title?: string;
}

export function CopyButton({ text, className, label, title }: Props) {
  const [copied, setCopied] = useState(false);

  async function handleClick() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // Clipboard blocked (insecure context, focus issue) — surface to the
      // user instead of silently swallowing, since the affordance otherwise
      // looks broken.
      pushToast("Could not access the clipboard.", "error");
    }
  }

  return (
    <button
      onClick={handleClick}
      type="button"
      title={title ?? "Copy to clipboard"}
      className={
        className ??
        "text-xs px-2 py-0.5 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 hover:text-gray-700 dark:hover:text-gray-200"
      }
    >
      {copied ? "Copied" : (label ?? "Copy")}
    </button>
  );
}
