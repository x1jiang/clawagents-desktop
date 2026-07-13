import { useConnection } from "../stores/connection";

/**
 * Show a thin banner across the top of the app when the gateway is
 * offline or recovering. Hidden when the connection is healthy or its
 * state hasn't been determined yet.
 */
export function ConnectionBanner() {
  const status = useConnection((s) => s.status);
  const error = useConnection((s) => s.lastError);

  if (status === "online" || status === "unknown") return null;

  const isOffline = status === "offline";
  return (
    <div
      className={
        "px-4 py-1 text-xs text-white text-center " +
        (isOffline ? "bg-red-600" : "bg-yellow-600")
      }
    >
      {isOffline
        ? `Gateway unreachable${error ? ` — ${error}` : ""}. Retrying…`
        : `Reconnecting to gateway…`}
    </div>
  );
}
