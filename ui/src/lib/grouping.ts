import type { Chat } from "../stores/chats";

export type ChatBucket = "Today" | "Yesterday" | "This week" | "This month" | "Older";

const ORDER: ChatBucket[] = ["Today", "Yesterday", "This week", "This month", "Older"];

function bucketFor(iso: string, now: Date): ChatBucket {
  const ts = Date.parse(iso);
  if (isNaN(ts)) return "Older";
  const diffMs = now.getTime() - ts;
  const day = 24 * 60 * 60 * 1000;
  if (diffMs < day && now.toDateString() === new Date(ts).toDateString()) return "Today";
  if (diffMs < 2 * day) return "Yesterday";
  if (diffMs < 7 * day) return "This week";
  if (diffMs < 31 * day) return "This month";
  return "Older";
}

/**
 * Group chats by recency. Preserves the original sort order *within* a
 * bucket — the caller should sort by last_message_at desc before calling.
 */
export function groupChatsByDate(
  chats: Chat[],
  now: Date = new Date(),
): Array<{ bucket: ChatBucket; chats: Chat[] }> {
  const map = new Map<ChatBucket, Chat[]>();
  for (const c of chats) {
    const b = bucketFor(c.last_message_at, now);
    const arr = map.get(b) ?? [];
    arr.push(c);
    map.set(b, arr);
  }
  return ORDER
    .filter((b) => map.has(b))
    .map((b) => ({ bucket: b, chats: map.get(b)! }));
}
