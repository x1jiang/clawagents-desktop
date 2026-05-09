import { invoke } from "@tauri-apps/api/core";

export interface GatewayInfo {
  url: string;
  token: string;
}

export const tauriApi = {
  getGatewayInfo: () => invoke<GatewayInfo>("get_gateway_info"),
  pickFolder: () => invoke<string | null>("pick_folder"),
  keyringSet: (service: string, account: string, secret: string) =>
    invoke<void>("keyring_set", { service, account, secret }),
  keyringGet: (service: string, account: string) =>
    invoke<string | null>("keyring_get", { service, account }),
  openInFinder: (path: string) => invoke<void>("open_in_finder", { path }),
  gatewayLogPath: () => invoke<string>("gateway_log_path"),
};
