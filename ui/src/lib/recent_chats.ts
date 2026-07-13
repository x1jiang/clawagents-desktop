/**
 * Tiny in-memory recent-chats stack so ⌘` can jump to the previously-viewed
 * chat. Records the chat id observed in the URL each time the router lands
 * on a chat page; keeps the last N (we only need 2 for the toggle, but we
 * keep a few so we can show a list in the palette later).
 */

const MAX = 8;
const LAST_PATH_KEY = "clawagents:lastChatPath";
let recent: string[] = [];

export function recordVisit(chatId: string): void {
  // Move-to-front: dedupe and bump to head.
  recent = [chatId, ...recent.filter((id) => id !== chatId)].slice(0, MAX);
}

/**
 * Persisted URL path of the last-visited chat. Used to restore the user to
 * the same chat across app launches. Stored as a path (e.g.
 * "/project/abc/chat/xyz") so the project scoping survives the trip.
 */
export function recordLastPath(path: string): void {
  try { window.localStorage.setItem(LAST_PATH_KEY, path); } catch { /* ignore */ }
}

export function getLastPath(): string | null {
  try { return window.localStorage.getItem(LAST_PATH_KEY); } catch { return null; }
}

export function previousChatId(currentChatId: string | null): string | null {
  if (recent.length === 0) return null;
  for (const id of recent) {
    if (id !== currentChatId) return id;
  }
  return null;
}

/**
 * Walk `offset` steps backwards through history, skipping the currently-active
 * chat. Used by ⌘⇧` to dig deeper than ⌘`. Returns null if we don't have
 * enough history yet.
 */
export function nthBackChatId(currentChatId: string | null, offset: number): string | null {
  const others = recent.filter((id) => id !== currentChatId);
  if (offset < 1 || offset > others.length) return null;
  return others[offset - 1] ?? null;
}

export function recentChatIds(): string[] {
  return [...recent];
}
