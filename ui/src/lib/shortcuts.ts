import { useEffect } from "react";

export interface ShortcutHandler {
  key: string;
  meta?: boolean;
  shift?: boolean;
  handler: (e: KeyboardEvent) => void;
  description: string;
}

/**
 * Bind keyboard shortcuts to window. Designed for global, app-wide
 * shortcuts — composer-local bindings (e.g. shift+enter) are owned by the
 * Composer itself. Shortcuts are intentionally ignored when the user is
 * typing in an input or textarea, except where the handler explicitly
 * matches the active element (e.g. Esc).
 */
export function useShortcuts(shortcuts: ShortcutHandler[]): void {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      const inEditableField =
        tag === "input" ||
        tag === "textarea" ||
        target?.isContentEditable;

      for (const s of shortcuts) {
        if (e.key.toLowerCase() !== s.key.toLowerCase()) continue;
        if (!!s.meta !== (e.metaKey || e.ctrlKey)) continue;
        if (!!s.shift !== e.shiftKey) continue;
        // Allow Esc inside an input/textarea (e.g. cancel streaming or close
        // a modal even with the composer focused). Block everything else
        // since otherwise Cmd+N would steal typing-typed-letter "n".
        if (inEditableField && s.key !== "Escape" && !s.meta) continue;
        e.preventDefault();
        s.handler(e);
        return;
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [shortcuts]);
}
