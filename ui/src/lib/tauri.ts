import { invoke } from "@tauri-apps/api/core";
import { devMockInvoke } from "./dev_mock_gateway";

export interface GatewayInfo {
  url: string;
  token: string;
}

export interface RemoteGatewayInfo {
  project_id: string;
  url: string;
  token: string;
  host: string;
  remote_path: string;
  local_port: number;
}

function hasTauriRuntime(): boolean {
  return typeof window !== "undefined" && !!(window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
}

function invokeDesktop<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (hasTauriRuntime() || !import.meta.env.DEV) return invoke<T>(command, args);
  return devMockInvoke<T>(command, args);
}

export const tauriApi = {
  getGatewayInfo: () => invokeDesktop<GatewayInfo>("get_gateway_info"),
  restartGateway: () => invokeDesktop<GatewayInfo>("restart_gateway"),
  pickFolder: () => invokeDesktop<string | null>("pick_folder"),
  keyringSet: (service: string, account: string, secret: string) =>
    invokeDesktop<void>("keyring_set", { service, account, secret }),
  keyringGet: (service: string, account: string) =>
    invokeDesktop<string | null>("keyring_get", { service, account }),
  keyringGetApiKeys: () =>
    invokeDesktop<Record<string, string | null>>("keyring_get_api_keys"),
  keyringDelete: (service: string, account: string) =>
    invokeDesktop<void>("keyring_delete", { service, account }),
  openInFinder: (path: string) => invokeDesktop<void>("open_in_finder", { path }),
  gatewayLogPath: () => invokeDesktop<string>("gateway_log_path"),
  listSshHosts: () => invokeDesktop<string[]>("list_ssh_hosts"),
  openSshConfig: () => invokeDesktop<string>("open_ssh_config"),
  testSshConnection: (host: string, remotePath: string) =>
    invokeDesktop<void>("test_ssh_connection", { host, remotePath }),
  connectRemoteProject: (args: {
    projectId: string;
    projectName: string;
    host: string;
    remotePath: string;
  }) =>
    invokeDesktop<RemoteGatewayInfo>("connect_remote_project", {
      projectId: args.projectId,
      projectName: args.projectName,
      host: args.host,
      remotePath: args.remotePath,
    }),
  disconnectRemoteProject: (projectId: string) =>
    invokeDesktop<void>("disconnect_remote_project", { projectId }),
  getRemoteGatewayInfo: (projectId: string) =>
    invokeDesktop<RemoteGatewayInfo | null>("get_remote_gateway_info", { projectId }),
};
