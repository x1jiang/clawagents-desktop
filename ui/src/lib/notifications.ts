/**
 * Browser-/Tauri-Notification wrapper. Triggers only when the window is
 * unfocused so we don't pop a toast on top of a chat the user is actively
 * watching.
 *
 * We request permission lazily — the first time we'd actually fire — to keep
 * the boot path clean.
 */

let permission: NotificationPermission | "unsupported" =
  typeof Notification !== "undefined" ? Notification.permission : "unsupported";

async function ensurePermission(): Promise<boolean> {
  if (permission === "unsupported") return false;
  if (permission === "granted") return true;
  if (permission === "denied") return false;
  try {
    permission = await Notification.requestPermission();
  } catch {
    permission = "denied";
  }
  return permission === "granted";
}

export async function notifyTurnComplete(opts: {
  chatTitle: string;
  preview?: string;
}): Promise<void> {
  if (typeof document === "undefined") return;
  if (document.visibilityState === "visible" && document.hasFocus()) return;
  const ok = await ensurePermission();
  if (!ok) return;
  try {
    new Notification(`Agent finished: ${opts.chatTitle}`, {
      body: opts.preview?.slice(0, 200) ?? "Turn complete.",
      tag: "clawagents-turn",
    });
  } catch {
    // Some platforms throw when not user-initiated; safe to ignore.
  }
}

export async function notifyPermissionRequested(opts: {
  chatTitle: string;
  tool: string;
  filePath?: string;
}): Promise<void> {
  if (typeof document === "undefined") return;
  // Always notify for permissions — even when focused — because the agent is
  // paused waiting on the user and the UI prompt is easy to miss in a long
  // scrolled-up chat.
  const ok = await ensurePermission();
  if (!ok) return;
  try {
    const body = opts.filePath
      ? `${opts.tool} on ${opts.filePath}`
      : `${opts.tool} requires approval`;
    new Notification(`Agent needs permission: ${opts.chatTitle}`, {
      body,
      tag: "clawagents-permission",
      requireInteraction: false,
    });
  } catch {
    // ignore
  }
}
