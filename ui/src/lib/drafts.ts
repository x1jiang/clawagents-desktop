/**
 * Per-chat composer drafts stored in localStorage so that reloading the app
 * (Tauri webview crash, accidental Cmd+R, etc.) doesn't lose the user's
 * half-typed prompt.
 *
 * Keyed by chat id. Drafts are wiped on send.
 */

const KEY_PREFIX = "clawagents:draft:";

export function loadDraft(chatId: string): string {
  try {
    return window.localStorage.getItem(KEY_PREFIX + chatId) ?? "";
  } catch {
    return "";
  }
}

export function saveDraft(chatId: string, text: string): void {
  try {
    if (text) window.localStorage.setItem(KEY_PREFIX + chatId, text);
    else window.localStorage.removeItem(KEY_PREFIX + chatId);
  } catch {
    // ignore (private mode, quota, etc.)
  }
}

export function clearDraft(chatId: string): void {
  try {
    window.localStorage.removeItem(KEY_PREFIX + chatId);
  } catch { /* ignore */ }
}

/** Wipe every saved draft. Returns the number removed for UI feedback. */
export function clearAllDrafts(): number {
  let n = 0;
  try {
    const toRemove: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (k && k.startsWith(KEY_PREFIX)) toRemove.push(k);
    }
    for (const k of toRemove) {
      window.localStorage.removeItem(k);
      n++;
    }
  } catch { /* ignore */ }
  return n;
}
