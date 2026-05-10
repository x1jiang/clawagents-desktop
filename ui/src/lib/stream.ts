import type { StreamEvent } from "../stores/chats";

export interface ParsedEvent {
  kind: string;
  data: unknown;
}

/**
 * Parse a complete SSE blob into discrete events. Designed for tests; the
 * runtime consumer keeps a tail buffer and feeds chunks through this in a loop.
 *
 * Only emits events where the original block ended with the SSE terminator
 * (\n\n). A trailing block without the terminator is treated as "partial"
 * and dropped.
 */
export function parseSSE(blob: string): ParsedEvent[] {
  const events: ParsedEvent[] = [];

  // Iterate by walking the string and splitting at the explicit terminator.
  // We only consume up to the last complete \n\n boundary; anything after
  // is partial and ignored.
  let lastTerminator = blob.lastIndexOf("\n\n");
  if (lastTerminator === -1) return [];
  const consumable = blob.slice(0, lastTerminator + 2);

  for (const block of consumable.split("\n\n")) {
    if (!block.trim()) continue;
    let kind = "";
    let dataRaw = "";
    for (const line of block.split("\n")) {
      if (line.startsWith("event:")) kind = line.slice(6).trim();
      else if (line.startsWith("data:")) dataRaw += line.slice(5).trim();
    }
    if (!kind) continue;
    events.push({ kind, data: dataRaw ? JSON.parse(dataRaw) : null });
  }

  return events;
}

/**
 * Open an SSE connection by POST-ing to the gateway, then stream parsed
 * events into the callback until the body ends or the abort signal fires.
 */
export async function streamMessages(
  url: string,
  token: string,
  body: { content: string; model_override?: string; mode_override?: string },
  signal: AbortSignal,
  onEvent: (ev: StreamEvent) => void,
): Promise<void> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok || !response.body) {
    const text = await response.text().catch(() => response.statusText);
    throw new Error(`${response.status}: ${text}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // Drain complete events from the buffer.
    let idx;
    while ((idx = buffer.indexOf("\n\n")) !== -1) {
      const block = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const parsed = parseSSE(block + "\n\n");
      for (const p of parsed) {
        onEvent({ kind: p.kind, ...((p.data as object) ?? {}) } as StreamEvent);
      }
    }
  }
}
