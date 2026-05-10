import { describe, expect, test } from "vitest";
import { parseSSE } from "./stream";

describe("parseSSE", () => {
  test("parses a single event", () => {
    const events = parseSSE('event: turn_started\ndata: {"chat_id":"x"}\n\n');
    expect(events).toEqual([{ kind: "turn_started", data: { chat_id: "x" } }]);
  });

  test("parses multiple events", () => {
    const blob =
      'event: turn_started\ndata: {}\n\n' +
      'event: assistant_token\ndata: {"text":"hi"}\n\n' +
      'event: turn_completed\ndata: {"status":"ok"}\n\n';
    const events = parseSSE(blob);
    expect(events.map((e) => e.kind)).toEqual([
      "turn_started",
      "assistant_token",
      "turn_completed",
    ]);
  });

  test("ignores partial trailing event without double newline", () => {
    const events = parseSSE('event: full\ndata: {}\n\nevent: partial\ndata:');
    expect(events.map((e) => e.kind)).toEqual(["full"]);
  });

  test("handles multi-line data", () => {
    const events = parseSSE('event: msg\ndata: {"a":\ndata: 1}\n\n');
    expect(events).toEqual([{ kind: "msg", data: { a: 1 } }]);
  });
});
