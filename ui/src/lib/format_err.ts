/** Normalize thrown values from fetch / Tauri invoke into a readable string. */
export function formatErr(e: unknown): string {
  if (e == null) return "unknown error";
  if (typeof e === "string") return e || "unknown error";
  if (e instanceof Error) return e.message || e.name || String(e);
  if (typeof e === "object") {
    const obj = e as Record<string, unknown>;
    if (typeof obj.message === "string" && obj.message.trim()) return obj.message;
    if (typeof obj.error === "string" && obj.error.trim()) return obj.error;
    try {
      return JSON.stringify(e);
    } catch {
      /* fall through */
    }
  }
  return String(e);
}
