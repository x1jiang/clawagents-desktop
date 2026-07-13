#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod keyring_cmd;
mod port;
mod sidecar;
mod ssh;

use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use rand::RngCore;
use serde::Serialize;
use tauri::{Manager, State};

use crate::port::pick_free_port;
use crate::sidecar::{Sidecar, SpawnConfig};
use crate::ssh::{RemoteConnectRequest, RemoteGatewayInfo, RemoteManager};

struct AppState {
    inner: Mutex<Option<RuntimeInfo>>,
    /// Set when the Python gateway fails to start; UI shows this instead of aborting.
    boot_error: Mutex<Option<String>>,
    remotes: Arc<Mutex<RemoteManager>>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            inner: Mutex::new(None),
            boot_error: Mutex::new(None),
            remotes: Arc::new(Mutex::new(RemoteManager::default())),
        }
    }
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
    if let Ok(err) = state.boot_error.lock() {
        if let Some(msg) = err.as_ref() {
            return Err(msg.clone());
        }
    }
    let guard = state.inner.lock().map_err(|e| e.to_string())?;
    let info = guard.as_ref().ok_or_else(|| "gateway not started".to_string())?;
    Ok(GatewayInfo {
        url: info.url.clone(),
        token: info.token.clone(),
    })
}

fn random_hex_token() -> String {
    let mut bytes = [0u8; 16];
    rand::thread_rng().fill_bytes(&mut bytes);
    hex::encode(bytes)
}

fn candidate_python(path: PathBuf) -> Option<PathBuf> {
    // IMPORTANT: do not canonicalize. A venv's `bin/python3` is a symlink to the
    // base interpreter; resolving it drops the venv and loads user/system
    // site-packages (missing desktop routes like /diagnostics /settings/verify-key).
    if path.is_file() {
        Some(path)
    } else {
        None
    }
}

/// True when running inside a packaged macOS .app (not `tauri dev`).
fn running_as_app_bundle() -> bool {
    std::env::current_exe()
        .ok()
        .and_then(|exe| {
            exe.parent()
                .and_then(|macos| macos.parent())
                .map(|contents| contents.join("Info.plist").is_file() && contents.join("MacOS").is_dir())
        })
        .unwrap_or(false)
}

/// Resolve the Python that runs `python -m clawagents --serve`.
fn resolve_python_path() -> Result<PathBuf, String> {
    if let Ok(override_path) = std::env::var("CLAWAGENTS_DESKTOP_PYTHON") {
        if let Some(p) = candidate_python(PathBuf::from(&override_path)) {
            return Ok(p);
        }
        return Err(format!(
            "CLAWAGENTS_DESKTOP_PYTHON={override_path} not found"
        ));
    }

    if let Ok(exe) = std::env::current_exe() {
        if let Some(macos_dir) = exe.parent() {
            if let Some(contents_dir) = macos_dir.parent() {
                let bundled = contents_dir.join("Resources/backend/.venv/bin/python3");
                if let Some(p) = candidate_python(bundled.clone()) {
                    return Ok(p);
                }
                if running_as_app_bundle() {
                    return Err(format!(
                        "Bundled Python missing at {}. Reinstall from the DMG (build embeds Resources/backend/.venv).",
                        bundled.display()
                    ));
                }
            }
        }
        for ancestor in exe.ancestors() {
            if let Some(p) = candidate_python(ancestor.join("backend/.venv/bin/python3")) {
                return Ok(p);
            }
        }
    }

    let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    for ancestor in cwd.ancestors() {
        if let Some(p) = candidate_python(ancestor.join("backend/.venv/bin/python3")) {
            return Ok(p);
        }
    }

    if let Some(home) = std::env::var_os("HOME") {
        let as_venv = PathBuf::from(home)
            .join("Library/Application Support/ClawAgentsDesktop/venv/bin/python3");
        if let Some(p) = candidate_python(as_venv) {
            return Ok(p);
        }
    }

    if running_as_app_bundle() {
        return Err("No desktop Python runtime found inside the app bundle.".into());
    }
    Ok(PathBuf::from("python3"))
}

fn resolve_env_file() -> Option<PathBuf> {
    if let Ok(exe) = std::env::current_exe() {
        if let Some(macos_dir) = exe.parent() {
            if let Some(contents_dir) = macos_dir.parent() {
                let bundled = contents_dir.join("Resources/.env");
                if bundled.is_file() {
                    return Some(bundled);
                }
            }
        }
        for ancestor in exe.ancestors() {
            let candidate = ancestor.join(".env");
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    for ancestor in cwd.ancestors() {
        let candidate = ancestor.join(".env");
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}

fn resolve_log_path() -> PathBuf {
    let home = std::env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("/tmp"));
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    home.join("Library/Logs/ClawAgentsDesktop")
        .join(format!("gateway-{ts}.log"))
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
fn keyring_get_api_keys() -> Result<std::collections::HashMap<String, Option<String>>, String> {
    keyring_cmd::get_all_providers("com.clawagents.desktop")
}

#[tauri::command]
fn keyring_delete(service: String, account: String) -> Result<(), String> {
    keyring_cmd::delete(&service, &account)
}

#[tauri::command]
fn open_in_finder(path: String) -> Result<(), String> {
    std::process::Command::new("open")
        .arg(&path)
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn gateway_log_path(state: State<'_, AppState>) -> Result<String, String> {
    let guard = state.inner.lock().map_err(|e| e.to_string())?;
    let info = guard
        .as_ref()
        .ok_or_else(|| "gateway not started".to_string())?;
    Ok(info.sidecar.log_path.to_string_lossy().into_owned())
}

#[tauri::command]
async fn pick_folder(app: tauri::AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;

    let (tx, rx) = std::sync::mpsc::channel::<Option<String>>();
    app.dialog()
        .file()
        .set_title("Choose a project folder")
        .pick_folder(move |path| {
            let path_string = path
                .and_then(|p| p.into_path().ok())
                .map(|p| p.to_string_lossy().into_owned());
            let _ = tx.send(path_string);
        });
    rx.recv().map_err(|e| e.to_string())
}

#[tauri::command]
fn list_ssh_hosts() -> Result<Vec<String>, String> {
    ssh::list_ssh_hosts()
}

#[tauri::command]
fn open_ssh_config() -> Result<String, String> {
    ssh::open_ssh_config()
}

#[tauri::command]
fn test_ssh_connection(host: String, remote_path: String) -> Result<(), String> {
    // Run off the UI thread so the modal can show "Testing…" instead of freezing.
    std::thread::Builder::new()
        .name("clawagents-ssh-test".into())
        .spawn(move || ssh::test_ssh_connection(&host, &remote_path))
        .map_err(|e| format!("ssh test thread: {e}"))?
        .join()
        .unwrap_or_else(|_| Err("ssh test thread panicked".into()))
}

#[tauri::command]
fn connect_remote_project(
    state: State<'_, AppState>,
    project_id: String,
    project_name: String,
    host: String,
    remote_path: String,
) -> Result<RemoteGatewayInfo, String> {
    let req = RemoteConnectRequest {
        project_id,
        project_name,
        host,
        remote_path,
    };
    let remotes = Arc::clone(&state.remotes);
    let keys = collect_keychain_env_blocking();
    // Run off the main thread — rsync/pip/ssh can take minutes.
    std::thread::Builder::new()
        .name("clawagents-ssh-connect".into())
        .spawn(move || ssh::connect_remote(&remotes, req, keys))
        .map_err(|e| format!("ssh connect thread: {e}"))?
        .join()
        .unwrap_or_else(|_| Err("ssh connect thread panicked".into()))
}

#[tauri::command]
fn disconnect_remote_project(
    state: State<'_, AppState>,
    project_id: String,
) -> Result<(), String> {
    let mut guard = state.remotes.lock().map_err(|e| e.to_string())?;
    guard.disconnect(&project_id)
}

#[tauri::command]
fn get_remote_gateway_info(
    state: State<'_, AppState>,
    project_id: String,
) -> Result<Option<RemoteGatewayInfo>, String> {
    let guard = state.remotes.lock().map_err(|e| e.to_string())?;
    Ok(guard.get(&project_id).cloned())
}

fn collect_keychain_env_blocking() -> Vec<(String, String)> {
    let mut out = Vec::new();
    match keyring_cmd::get_all_providers("com.clawagents.desktop") {
        Ok(map) => {
            let mapping = [
                ("openai", "OPENAI_API_KEY"),
                ("anthropic", "ANTHROPIC_API_KEY"),
                ("gemini", "GEMINI_API_KEY"),
                ("bedrock", "BEDROCK_API_KEY"),
            ];
            for (account, env_name) in mapping {
                if let Some(Some(value)) = map.get(account) {
                    if !value.is_empty() {
                        out.push((env_name.to_string(), value.clone()));
                    }
                }
            }
        }
        Err(e) => {
            boot_debug(&format!("keychain bundle read failed: {e}"));
        }
    }
    out
}

fn collect_keychain_env() -> Vec<(String, String)> {
    // Keychain prompts can block indefinitely for a newly installed / re-signed
    // binary. Never stall gateway boot on them.
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let _ = tx.send(collect_keychain_env_blocking());
    });
    match rx.recv_timeout(Duration::from_secs(12)) {
        Ok(out) => {
            boot_debug(&format!("keychain env entries={}", out.len()));
            out
        }
        Err(_) => {
            boot_debug("keychain env timed out; starting without Keychain keys");
            Vec::new()
        }
    }
}

fn boot_debug(msg: &str) {
    let home = std::env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("/tmp"));
    let path = home.join("Library/Logs/ClawAgentsDesktop/boot.log");
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let line = format!(
        "{} {}\n",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0),
        msg
    );
    let _ = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .and_then(|mut f| {
            use std::io::Write;
            f.write_all(line.as_bytes())
        });
}

fn start_gateway() -> Result<RuntimeInfo, String> {
    // Tauri may invoke setup on a thread that already owns a Tokio runtime.
    // `reqwest::blocking` panics in that case — run the whole boot on a
    // fresh OS thread so health/diagnostics probes stay safe.
    std::thread::Builder::new()
        .name("clawagents-gateway-boot".into())
        .spawn(start_gateway_inner)
        .map_err(|e| format!("boot thread spawn: {e}"))?
        .join()
        .unwrap_or_else(|_| Err("boot thread panicked".into()))
}

fn start_gateway_inner() -> Result<RuntimeInfo, String> {
    boot_debug("start_gateway_inner");
    let port = pick_free_port().map_err(|e| format!("pick_free_port: {e}"))?;
    let token = random_hex_token();
    let python = resolve_python_path().map_err(|e| {
        boot_debug(&format!("resolve_python_path failed: {e}"));
        e
    })?;
    boot_debug(&format!("python={} port={port}", python.display()));
    let log_path = resolve_log_path();
    let keychain_env = collect_keychain_env();
    let cfg = SpawnConfig {
        python: python.clone(),
        port,
        api_key: token.clone(),
        log_path: log_path.clone(),
        app_support_override: None,
        env_file: resolve_env_file(),
        extra_env: keychain_env.clone(),
    };
    let sidecar = Sidecar::spawn(&cfg).map_err(|e| {
        let msg = format!(
            "spawn sidecar with {}: {e} (log: {})",
            python.display(),
            log_path.display()
        );
        boot_debug(&msg);
        msg
    })?;
    boot_debug("spawned; waiting for health");

    Sidecar::wait_healthy(port, &token, Duration::from_secs(20)).map_err(|e| {
        let hint = std::fs::read_to_string(&log_path).unwrap_or_default();
        let hint = hint.trim();
        let msg = if hint.is_empty() {
            format!(
                "{e} — python={} log={}",
                python.display(),
                log_path.display()
            )
        } else {
            format!(
                "{e} — python={} log={}\n{}",
                python.display(),
                log_path.display(),
                hint.chars().take(800).collect::<String>()
            )
        };
        boot_debug(&msg);
        msg
    })?;

    // Ensure this is the desktop gateway (not a bare clawagents_py install).
    let diag = format!("http://127.0.0.1:{port}/diagnostics");
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(2))
        .build()
        .map_err(|e| format!("client build: {e}"))?;
    let probe = client
        .get(&diag)
        .header("Authorization", format!("Bearer {token}"))
        .send()
        .map_err(|e| format!("desktop API probe failed: {e}"))?;
    if !probe.status().is_success() {
        let msg = format!(
            "Gateway started but /diagnostics returned {}. Wrong Python package (need desktop backend). python={}",
            probe.status(),
            python.display()
        );
        boot_debug(&msg);
        return Err(msg);
    }

    boot_debug("gateway ready");
    // Only re-read Keychain after boot if spawn-time collect timed out / got
    // nothing — avoid a second unlock when keys were already injected as env.
    if keychain_env.is_empty() {
        let port = port;
        let token = token.clone();
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_secs(1));
            let keys = collect_keychain_env_blocking();
            if keys.is_empty() {
                boot_debug("post-boot keychain sync: nothing to push");
                return;
            }
            let client = match reqwest::blocking::Client::builder()
                .timeout(Duration::from_secs(3))
                .build()
            {
                Ok(c) => c,
                Err(e) => {
                    boot_debug(&format!("post-boot keychain sync client: {e}"));
                    return;
                }
            };
            for (env_name, value) in keys {
                let provider = match env_name.as_str() {
                    "OPENAI_API_KEY" => "openai",
                    "ANTHROPIC_API_KEY" => "anthropic",
                    "GEMINI_API_KEY" => "gemini",
                    "BEDROCK_API_KEY" => "bedrock",
                    _ => continue,
                };
                let url = format!("http://127.0.0.1:{port}/settings/api-keys");
                let body = serde_json::json!({ "provider": provider, "api_key": value });
                match client
                    .post(&url)
                    .header("Authorization", format!("Bearer {token}"))
                    .json(&body)
                    .send()
                {
                    Ok(r) if r.status().is_success() => {
                        boot_debug(&format!("post-boot keychain sync ok: {provider}"));
                    }
                    Ok(r) => boot_debug(&format!(
                        "post-boot keychain sync {provider}: HTTP {}",
                        r.status()
                    )),
                    Err(e) => boot_debug(&format!("post-boot keychain sync {provider}: {e}")),
                }
            }
        });
    }
    Ok(RuntimeInfo {
        url: format!("http://127.0.0.1:{port}"),
        token,
        sidecar,
    })
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
            keyring_get_api_keys,
            keyring_delete,
            open_in_finder,
            gateway_log_path,
            list_ssh_hosts,
            open_ssh_config,
            test_ssh_connection,
            connect_remote_project,
            disconnect_remote_project,
            get_remote_gateway_info,
        ])
        .setup(|app| {
            match start_gateway() {
                Ok(info) => {
                    let state: State<'_, AppState> = app.state();
                    *state.inner.lock().map_err(|e| e.to_string())? = Some(info);
                }
                Err(err) => {
                    boot_debug(&format!("gateway failed: {err}"));
                    eprintln!("ClawAgents Desktop: gateway failed to start:\n{err}");
                    let state: State<'_, AppState> = app.state();
                    *state.boot_error.lock().map_err(|e| e.to_string())? = Some(err);
                }
            }
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
                if let Ok(mut remotes) = state.remotes.lock() {
                    remotes.disconnect_all();
                };
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
