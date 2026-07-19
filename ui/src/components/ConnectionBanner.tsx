import { useEffect, useState } from "react";
import { useConnection } from "../stores/connection";
import { restartGateway } from "../lib/gateway_connection";

// Wait a beat before offering the disruptive restart action — a brief
// health-check blip shouldn't immediately prompt the user to kill the
// sidecar. Below this the plain "Retrying…" message still shows.
const RESTART_OFFER_AFTER_MS = 15_000;

/**
 * Show a thin banner across the top of the app when the gateway is
 * offline or recovering. Hidden when the connection is healthy or its
 * state hasn't been determined yet.
 */
export function ConnectionBanner() {
  const status = useConnection((s) => s.status);
  const error = useConnection((s) => s.lastError);
  const offlineSince = useConnection((s) => s.offlineSince);
  const restarting = useConnection((s) => s.restarting);
  const [longOffline, setLongOffline] = useState(false);
  const [restartError, setRestartError] = useState<string | null>(null);

  useEffect(() => {
    if (!offlineSince) {
      setLongOffline(false);
      return;
    }
    const elapsed = Date.now() - offlineSince;
    if (elapsed >= RESTART_OFFER_AFTER_MS) {
      setLongOffline(true);
      return;
    }
    const t = window.setTimeout(() => setLongOffline(true), RESTART_OFFER_AFTER_MS - elapsed);
    return () => window.clearTimeout(t);
  }, [offlineSince]);

  if (status === "online" || status === "unknown") return null;

  const isOffline = status === "offline";

  async function handleRestart() {
    setRestartError(null);
    try {
      await restartGateway();
    } catch (e) {
      setRestartError((e as Error).message);
    }
  }

  return (
    <div
      className={
        "px-4 py-1 text-xs text-white text-center flex items-center justify-center gap-2 " +
        (isOffline ? "bg-red-600" : "bg-yellow-600")
      }
    >
      <span>
        {isOffline
          ? `Gateway unreachable${error ? ` — ${error}` : ""}. Retrying…`
          : `Reconnecting to gateway…`}
        {restartError ? ` Restart failed: ${restartError}` : ""}
      </span>
      {isOffline && longOffline && (
        <button
          type="button"
          onClick={() => void handleRestart()}
          disabled={restarting}
          className="shrink-0 rounded border border-white/40 px-2 py-0.5 text-[10px] hover:bg-white/10 disabled:opacity-60"
        >
          {restarting ? "Restarting…" : "Restart gateway"}
        </button>
      )}
    </div>
  );
}
