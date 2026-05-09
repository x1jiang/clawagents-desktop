#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod port;
mod sidecar;
mod keyring_cmd;

use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;

use rand::RngCore;
use serde::Serialize;
use tauri::{Manager, State};

use crate::port::pick_free_port;
use crate::sidecar::{Sidecar, SpawnConfig};

#[derive(Default)]
struct AppState {
    inner: Mutex<Option<RuntimeInfo>>,
}

struct RuntimeInfo {
    url: String,
    token: String,
    sidecar: Sidecar,
}

#[derive(Serialize)]
struct GatewayInfo {
    url: String,
    token: String,
}

#[tauri::command]
fn get_gateway_info(state: State<'_, AppState>) -> Result<GatewayInfo, String> {
    let guard = state.inner.lock().map_err(|e| e.to_string())?;
    let info = guard.as_ref().ok_or_else(|| "gateway not started".to_string())?;
    Ok(GatewayInfo {
        url: info.url.clone(),
        token: info.token.clone(),
    })
}

fn random_hex_token() -> String {
    let mut bytes = [0u8; 16]; // 128 bits = 32 hex chars
    rand::thread_rng().fill_bytes(&mut bytes);
    hex::encode(bytes)
}

fn resolve_python_path() -> PathBuf {
    // Walk up from cwd until we find a `backend/.venv/bin/python3`.
    // This handles cwd=ui/, cwd=ui/src-tauri/, and cwd=clawagents_desktop/
    // without hardcoding a relative depth.
    let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    for ancestor in cwd.ancestors() {
        let candidate = ancestor.join("backend/.venv/bin/python3");
        if candidate.exists() {
            return candidate;
        }
    }
    PathBuf::from("python3")
}

fn resolve_log_path() -> PathBuf {
    let home = std::env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("/tmp"));
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    home.join("Library/Logs/ClawAgentsDesktop").join(format!("gateway-{ts}.log"))
}

#[tauri::command]
fn keyring_set(service: String, account: String, secret: String) -> Result<(), String> {
    keyring_cmd::set(&service, &account, &secret)
}

#[tauri::command]
fn keyring_get(service: String, account: String) -> Result<Option<String>, String> {
    keyring_cmd::get(&service, &account)
}

#[tauri::command]
async fn pick_folder(app: tauri::AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;

    let (tx, rx) = std::sync::mpsc::channel::<Option<String>>();
    app.dialog()
        .file()
        .set_title("Choose a project folder")
        .pick_folder(move |path| {
            let path_string = path.and_then(|p| p.into_path().ok()).map(|p| p.to_string_lossy().into_owned());
            let _ = tx.send(path_string);
        });
    rx.recv().map_err(|e| e.to_string())
}

fn main() {
    tauri::Builder::default()
        .manage(AppState::default())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            get_gateway_info,
            pick_folder,
            keyring_set,
            keyring_get,
        ])
        .setup(|app| {
            let port = pick_free_port().map_err(|e| format!("pick_free_port: {e}"))?;
            let token = random_hex_token();
            let cfg = SpawnConfig {
                python: resolve_python_path(),
                port,
                api_key: token.clone(),
                log_path: resolve_log_path(),
                app_support_override: None,
            };
            let sidecar = Sidecar::spawn(&cfg).map_err(|e| format!("spawn sidecar: {e}"))?;

            // Block the main thread until the gateway is healthy. v1 acceptable
            // since it usually takes <2 seconds.
            Sidecar::wait_healthy(port, &token, Duration::from_secs(10))
                .map_err(|e| format!("gateway not ready: {e}"))?;

            let state: State<'_, AppState> = app.state();
            *state.inner.lock().map_err(|e| e.to_string())? = Some(RuntimeInfo {
                url: format!("http://127.0.0.1:{port}"),
                token,
                sidecar,
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                let app = window.app_handle();
                let state: State<'_, AppState> = app.state();
                if let Ok(mut guard) = state.inner.lock() {
                    if let Some(mut info) = guard.take() {
                        info.sidecar.shutdown(Duration::from_secs(3));
                    }
                };
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
