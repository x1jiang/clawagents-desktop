/**
 * Lightweight health poller. Pings GET /health on the gateway every 10s.
 * Backs off to every 3s on failure so the user sees the "Reconnecting" state
 * recover quickly when the gateway comes back. Updates the connection store
 * so the banner can react.
 */

import { useConnection } from "../stores/connection";

const HEALTHY_INTERVAL_MS = 10_000;
const UNHEALTHY_INTERVAL_MS = 3_000;
const REQUEST_TIMEOUT_MS = 4_000;

export function startHealthMonitor(baseUrl: string): () => void {
  let active = true;
  let timer: number | undefined;

  async function probe() {
    if (!active) return;
    const ctrl = new AbortController();
    const tid = window.setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
    try {
      const resp = await fetch(`${baseUrl}/health`, { signal: ctrl.signal });
      if (!active) return;
      if (resp.ok) {
        useConnection.getState().setStatus("online");
        schedule(HEALTHY_INTERVAL_MS);
      } else {
        useConnection.getState().setStatus("reconnecting", `${resp.status}`);
        schedule(UNHEALTHY_INTERVAL_MS);
      }
    } catch (e) {
      if (!active) return;
      useConnection.getState().setStatus("offline", (e as Error).message);
      schedule(UNHEALTHY_INTERVAL_MS);
    } finally {
      window.clearTimeout(tid);
    }
  }

  function schedule(delay: number) {
    if (!active) return;
    timer = window.setTimeout(probe, delay);
  }

  // Kick off immediately.
  probe();

  return () => {
    active = false;
    if (timer !== undefined) window.clearTimeout(timer);
  };
}
