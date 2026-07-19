/**
 * Owns the single active gateway connection: builds the GatewayClient,
 * (re)starts the health monitor, and republishes it into the projects store.
 * Shared by the initial boot in main.tsx and the "Restart gateway" recovery
 * action (ConnectionBanner) so a restart replaces the connection exactly the
 * same way the app connects on first launch, instead of duplicating it.
 */
import { GatewayClient } from "./gateway";
import { tauriApi } from "./tauri";
import { useProjects } from "../stores/projects";
import { useConnection } from "../stores/connection";
import { startHealthMonitor } from "./health_monitor";

let stopHealthMonitor: (() => void) | null = null;

function connect(info: { url: string; token: string }): GatewayClient {
  stopHealthMonitor?.();
  const client = new GatewayClient(info.url, info.token);
  useProjects.getState().setClient(client);
  stopHealthMonitor = startHealthMonitor(info.url);
  return client;
}

/** Initial boot: fetch gateway info from Tauri and connect. */
export async function connectGateway(): Promise<GatewayClient> {
  const info = await tauriApi.getGatewayInfo();
  return connect(info);
}

/**
 * Recovery action: ask the Rust side to shut down the (likely dead) sidecar
 * and boot a fresh one, then repoint the client + health monitor at its new
 * port/token. Rejects with the boot error on failure — callers should
 * surface it (the existing "offline" banner state already does once the
 * health monitor's next probe fails again).
 */
export async function restartGateway(): Promise<GatewayClient> {
  useConnection.getState().setRestarting(true);
  try {
    const info = await tauriApi.restartGateway();
    return connect(info);
  } finally {
    useConnection.getState().setRestarting(false);
  }
}
