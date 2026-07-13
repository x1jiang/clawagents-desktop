import { describe, test, expect } from "vitest";
import { groupChatsByDate } from "./grouping";
import type { Chat } from "../stores/chats";

function chat(id: string, ago: { hours?: number; days?: number }, now: Date): Chat {
  const ms = (ago.hours ?? 0) * 60 * 60 * 1000 + (ago.days ?? 0) * 24 * 60 * 60 * 1000;
  const ts = new Date(now.getTime() - ms).toISOString();
  return {
    id,
    project_id: null,
    title: id,
    model: "",
    mode: "auto",
    created_at: ts,
    last_message_at: ts,
    status: "idle",
  };
}

describe("groupChatsByDate", () => {
  const now = new Date("2026-05-10T12:00:00Z");

  test("buckets by recency", () => {
    const groups = groupChatsByDate(
      [
        chat("now", { hours: 1 }, now),
        chat("yest", { days: 1, hours: 1 }, now),
        chat("week", { days: 4 }, now),
        chat("month", { days: 20 }, now),
        chat("old", { days: 60 }, now),
      ],
      now,
    );
    const buckets = groups.map((g) => g.bucket);
    expect(buckets).toEqual(["Today", "Yesterday", "This week", "This month", "Older"]);
  });

  test("empty buckets are dropped", () => {
    const groups = groupChatsByDate(
      [chat("a", { hours: 2 }, now), chat("b", { hours: 5 }, now)],
      now,
    );
    expect(groups.map((g) => g.bucket)).toEqual(["Today"]);
    expect(groups[0].chats.map((c) => c.id)).toEqual(["a", "b"]);
  });

  test("ordering preserved within bucket", () => {
    const groups = groupChatsByDate(
      [
        chat("alpha", { hours: 2 }, now),
        chat("beta",  { hours: 1 }, now),
        chat("gamma", { hours: 3 }, now),
      ],
      now,
    );
    expect(groups[0].chats.map((c) => c.id)).toEqual(["alpha", "beta", "gamma"]);
  });
});
