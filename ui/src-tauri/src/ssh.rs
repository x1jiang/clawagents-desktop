//! Remote SSH gateway lifecycle (Cursor/VS Code–style).
//!
//! Spawns `python -m clawagents --serve` on the remote host over OpenSSH,
//! with local port-forward so the Tauri UI talks to `127.0.0.1`. Jumpboxes
//! are inherited from `~/.ssh/config` (`ProxyJump` / `ProxyCommand`).

use std::collections::HashMap;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

use crate::port::pick_free_port;
use crate::sidecar::Sidecar;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RemoteConnectRequest {
    pub project_id: String,
    pub project_name: String,
    pub host: String,
    pub remote_path: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct RemoteGatewayInfo {
    pub project_id: String,
    pub url: String,
    pub token: String,
    pub host: String,
    pub remote_path: String,
    pub local_port: u16,
}

struct RemoteSession {
    info: RemoteGatewayInfo,
    child: Child,
}

#[derive(Default)]
pub struct RemoteManager {
    sessions: HashMap<String, RemoteSession>,
}

impl RemoteManager {
    pub fn get(&self, project_id: &str) -> Option<&RemoteGatewayInfo> {
        self.sessions.get(project_id).map(|s| &s.info)
    }

    pub fn disconnect(&mut self, project_id: &str) -> Result<(), String> {
        if let Some(mut session) = self.sessions.remove(project_id) {
            let _ = session.child.kill();
            let _ = session.child.wait();
        }
        Ok(())
    }

    pub fn disconnect_all(&mut self) {
        let ids: Vec<String> = self.sessions.keys().cloned().collect();
        for id in ids {
            let _ = self.disconnect(&id);
        }
    }
}

fn shell_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', "'\"'\"'"))
}

fn ssh_base_args(host: &str) -> Vec<String> {
    vec![
        "-o".into(),
        "BatchMode=yes".into(),
        "-o".into(),
        "ConnectTimeout=20".into(),
        "-o".into(),
        "StrictHostKeyChecking=accept-new".into(),
        host.into(),
    ]
}

fn run_ssh(host: &str, remote_cmd: &str, timeout: Duration) -> Result<String, String> {
    let mut args = ssh_base_args(host);
    args.push(remote_cmd.into());
    let mut child = Command::new("ssh")
        .args(&args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("ssh spawn failed: {e}"))?;

    let deadline = Instant::now() + timeout;
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                let mut stdout = String::new();
                let mut stderr = String::new();
                if let Some(mut out) = child.stdout.take() {
                    let _ = out.read_to_string(&mut stdout);
                }
                if let Some(mut err) = child.stderr.take() {
                    let _ = err.read_to_string(&mut stderr);
                }
                if status.success() {
                    return Ok(stdout);
                }
                let detail = stderr.trim();
                if detail.is_empty() {
                    return Err(format!("ssh exited with {status}"));
                }
                return Err(format!("ssh failed: {detail}"));
            }
            Ok(None) => {
                if Instant::now() >= deadline {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err(format!("ssh timed out after {:?}", timeout));
                }
                std::thread::sleep(Duration::from_millis(100));
            }
            Err(e) => return Err(format!("ssh wait error: {e}")),
        }
    }
}

/// Ensure `~/.ssh/config` exists and open it in the default macOS text editor.
pub fn open_ssh_config() -> Result<String, String> {
    let home = std::env::var_os("HOME").ok_or_else(|| "HOME not set".to_string())?;
    let ssh_dir = PathBuf::from(&home).join(".ssh");
    let path = ssh_dir.join("config");
    if !ssh_dir.is_dir() {
        std::fs::create_dir_all(&ssh_dir).map_err(|e| format!("mkdir ~/.ssh: {e}"))?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(&ssh_dir, std::fs::Permissions::from_mode(0o700));
        }
    }
    if !path.is_file() {
        let starter = "\
# ClawAgents Desktop — edit Host entries here (ProxyJump / IdentityFile / etc.)\n\
# Example:\n\
# Host my-server\n\
#     HostName 1.2.3.4\n\
#     User you\n\
#     ProxyJump bastion\n\
#     IdentityFile ~/.ssh/id_ed25519\n\
";
        std::fs::write(&path, starter).map_err(|e| format!("create ~/.ssh/config: {e}"))?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
        }
    }
    // `-e` = TextEdit (reliable for plain config files on macOS).
    std::process::Command::new("open")
        .args(["-e", &path.to_string_lossy()])
        .spawn()
        .map_err(|e| format!("open ~/.ssh/config failed: {e}"))?;
    Ok(path.to_string_lossy().into_owned())
}

/// Parse `Host` aliases from `~/.ssh/config` (skip patterns with `*`).
pub fn list_ssh_hosts() -> Result<Vec<String>, String> {
    let home = std::env::var_os("HOME").ok_or_else(|| "HOME not set".to_string())?;
    let path = PathBuf::from(home).join(".ssh/config");
    if !path.is_file() {
        return Ok(Vec::new());
    }
    let text = std::fs::read_to_string(&path).map_err(|e| format!("read ssh config: {e}"))?;
    let mut hosts = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for line in text.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        let lower = trimmed.to_ascii_lowercase();
        if !lower.starts_with("host ") {
            continue;
        }
        for token in trimmed[5..].split_whitespace() {
            if token.contains('*') || token.contains('?') {
                continue;
            }
            if seen.insert(token.to_string()) {
                hosts.push(token.to_string());
            }
        }
    }
    hosts.sort();
    Ok(hosts)
}

pub fn test_ssh_connection(host: &str, remote_path: &str) -> Result<(), String> {
    let host = host.trim();
    let remote_path = remote_path.trim();
    if host.is_empty() {
        return Err("host is required".into());
    }
    if remote_path.is_empty() {
        return Err("remote_path is required".into());
    }
    if !remote_path.starts_with('/') {
        return Err("remote_path must be an absolute path".into());
    }
    let cmd = format!(
        "test -d {} && echo CLAW_SSH_OK",
        shell_quote(remote_path)
    );
    let out = run_ssh(host, &cmd, Duration::from_secs(30))?;
    if out.contains("CLAW_SSH_OK") {
        Ok(())
    } else {
        Err(format!(
            "remote path not found or not a directory: {remote_path}"
        ))
    }
}

fn resolve_backend_dir() -> Result<PathBuf, String> {
    if let Ok(override_path) = std::env::var("CLAWAGENTS_DESKTOP_BACKEND") {
        let p = PathBuf::from(override_path);
        if p.join("src/clawagents").is_dir() {
            return Ok(p);
        }
        return Err(format!(
            "CLAWAGENTS_DESKTOP_BACKEND={} missing src/clawagents",
            p.display()
        ));
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(macos_dir) = exe.parent() {
            if let Some(contents_dir) = macos_dir.parent() {
                let bundled = contents_dir.join("Resources/backend");
                if bundled.join("src/clawagents").is_dir() {
                    return Ok(bundled);
                }
            }
        }
        for ancestor in exe.ancestors() {
            let candidate = ancestor.join("backend");
            if candidate.join("src/clawagents").is_dir() {
                return Ok(candidate);
            }
            let nested = ancestor.join("clawagents_desktop/backend");
            if nested.join("src/clawagents").is_dir() {
                return Ok(nested);
            }
        }
    }
    let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    for ancestor in cwd.ancestors() {
        let candidate = ancestor.join("backend");
        if candidate.join("src/clawagents").is_dir() {
            return Ok(candidate);
        }
        let nested = ancestor.join("clawagents_desktop/backend");
        if nested.join("src/clawagents").is_dir() {
            return Ok(nested);
        }
    }
    Err("Could not locate clawagents_desktop/backend for remote sync".into())
}

fn sync_backend_to_remote(host: &str, backend: &Path) -> Result<(), String> {
    let remote_dir = "~/.cache/clawagents-desktop-remote/";
    run_ssh(
        host,
        "mkdir -p \"$HOME/.cache/clawagents-desktop-remote\"",
        Duration::from_secs(30),
    )?;

    let status = Command::new("rsync")
        .args([
            "-az",
            "--delete",
            "--exclude",
            ".venv",
            "--exclude",
            "__pycache__",
            "--exclude",
            ".ruff_cache",
            "--exclude",
            "tests",
            "--exclude",
            ".pytest_cache",
            "-e",
            "ssh -o BatchMode=yes -o ConnectTimeout=20 -o StrictHostKeyChecking=accept-new",
        ])
        .arg(format!("{}/", backend.display()))
        .arg(format!("{host}:{remote_dir}"))
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .status()
        .map_err(|e| format!("rsync spawn failed (is rsync installed?): {e}"))?;

    if !status.success() {
        return Err(format!("rsync to remote failed with {status}"));
    }
    Ok(())
}

fn remote_venv_python() -> &'static str {
    "$HOME/.cache/clawagents-desktop-remote/.venv/bin/python"
}

fn ensure_remote_deps(host: &str) -> Result<(), String> {
    // Debian/Ubuntu block system pip (PEP 668). Always use a dedicated venv
    // under ~/.cache and PYTHONPATH for the synced desktop backend source.
    let setup = r#"
set -e
CACHE="$HOME/.cache/clawagents-desktop-remote"
VENV="$CACHE/.venv"
PY="$VENV/bin/python"
export PYTHONPATH="$CACHE/src${PYTHONPATH:+:$PYTHONPATH}"

if [ ! -x "$PY" ]; then
  if ! python3 -m venv "$VENV" 2>/tmp/claw-venv.err; then
    echo "VENV_CREATE_FAILED"
    cat /tmp/claw-venv.err 2>/dev/null || true
    echo "HINT: on the remote host run: sudo apt install -y python3-venv python3-full"
    exit 1
  fi
fi

if "$PY" -c "import fastapi,uvicorn,pydantic,openai,clawagents" 2>/dev/null; then
  echo OK
  exit 0
fi

"$PY" -m pip install -q --upgrade pip
"$PY" -m pip install -q \
  'openai>=1.0.0' 'fastapi>=0.100.0' 'uvicorn>=0.20.0' \
  'python-dotenv>=1.0.0' 'pydantic>=2.0.0' 'pydantic-settings>=2.0.0' \
  'anthropic>=0.40.0' 'google-genai>=0.1.0' 'mcp>=1.0.0'
"$PY" -c "import fastapi,uvicorn,pydantic,openai,clawagents; print('OK')"
"#;
    let out = run_ssh(host, setup, Duration::from_secs(420)).map_err(|e| {
        if e.contains("externally-managed-environment") || e.contains("VENV_CREATE_FAILED") {
            format!(
                "{e}\n\nRemote Python is protected (PEP 668). ClawAgents now uses a venv; \
                 if venv creation failed, SSH in and run: sudo apt install -y python3-venv python3-full"
            )
        } else {
            e
        }
    })?;
    if out.contains("OK") {
        Ok(())
    } else {
        Err(format!("remote dependency install failed: {}", out.trim()))
    }
}

fn pick_remote_port(host: &str) -> Result<u16, String> {
    let out = run_ssh(
        host,
        "python3 -c \"import socket;s=socket.socket();s.bind(('127.0.0.1',0));print(s.getsockname()[1]);s.close()\"",
        Duration::from_secs(30),
    )?;
    let port: u16 = out
        .trim()
        .lines()
        .last()
        .unwrap_or("")
        .trim()
        .parse()
        .map_err(|_| format!("could not parse remote port from: {out}"))?;
    Ok(port)
}

fn random_hex_token() -> String {
    use rand::RngCore;
    let mut bytes = [0u8; 16];
    rand::thread_rng().fill_bytes(&mut bytes);
    hex::encode(bytes)
}

fn seed_remote_project(
    local_port: u16,
    token: &str,
    project_id: &str,
    project_name: &str,
    remote_path: &str,
) -> Result<(), String> {
    let url = format!("http://127.0.0.1:{local_port}/projects");
    let body = serde_json::json!({
        "id": project_id,
        "name": project_name,
        "root_path": remote_path,
        "kind": "local",
    });
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|e| format!("seed client: {e}"))?;
    let resp = client
        .post(&url)
        .header("Authorization", format!("Bearer {token}"))
        .json(&body)
        .send()
        .map_err(|e| format!("seed project POST failed: {e}"))?;
    if resp.status().is_success() {
        return Ok(());
    }
    let status = resp.status();
    let text = resp.text().unwrap_or_default();
    Err(format!("seed project failed: HTTP {status} {text}"))
}

fn push_api_keys(local_port: u16, token: &str, keys: &[(String, String)]) {
    let Ok(client) = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(5))
        .build()
    else {
        return;
    };
    for (env_name, value) in keys {
        let provider = match env_name.as_str() {
            "OPENAI_API_KEY" => "openai",
            "ANTHROPIC_API_KEY" => "anthropic",
            "GEMINI_API_KEY" => "gemini",
            _ => continue,
        };
        let url = format!("http://127.0.0.1:{local_port}/settings/api-keys");
        let body = serde_json::json!({ "provider": provider, "api_key": value });
        let _ = client
            .post(&url)
            .header("Authorization", format!("Bearer {token}"))
            .json(&body)
            .send();
    }
}

pub fn connect_remote(
    manager: &Mutex<RemoteManager>,
    req: RemoteConnectRequest,
    extra_env: Vec<(String, String)>,
) -> Result<RemoteGatewayInfo, String> {
    let host = req.host.trim().to_string();
    let remote_path = req.remote_path.trim().to_string();
    if host.is_empty() || remote_path.is_empty() {
        return Err("host and remote_path are required".into());
    }
    if !remote_path.starts_with('/') {
        return Err("remote_path must be an absolute path".into());
    }

    {
        let guard = manager.lock().map_err(|e| e.to_string())?;
        if let Some(existing) = guard.get(&req.project_id) {
            if Sidecar::wait_healthy(existing.local_port, &existing.token, Duration::from_secs(2))
                .is_ok()
            {
                return Ok(existing.clone());
            }
        }
    }
    {
        let mut guard = manager.lock().map_err(|e| e.to_string())?;
        let _ = guard.disconnect(&req.project_id);
    }

    test_ssh_connection(&host, &remote_path)?;
    let backend = resolve_backend_dir()?;
    sync_backend_to_remote(&host, &backend)?;
    ensure_remote_deps(&host)?;

    let local_port = pick_free_port().map_err(|e| format!("local port: {e}"))?;
    let remote_port = pick_remote_port(&host)?;
    let token = random_hex_token();

    let app_support = format!("{remote_path}/.clawagents/desktop-app-support");
    let mut env_exports = String::from(
        "export PYTHONPATH=\"$HOME/.cache/clawagents-desktop-remote/src${PYTHONPATH:+:$PYTHONPATH}\"; ",
    );
    env_exports.push_str(&format!(
        "export GATEWAY_HOST=127.0.0.1; export GATEWAY_API_KEY={}; ",
        shell_quote(&token)
    ));
    env_exports.push_str(&format!(
        "export CLAWAGENTS_DESKTOP_APP_SUPPORT={}; ",
        shell_quote(&app_support)
    ));
    for (k, v) in &extra_env {
        env_exports.push_str(&format!("export {}={}; ", k, shell_quote(v)));
    }

    // Use the remote venv python (avoids system pip / PEP 668).
    let remote_py = remote_venv_python();
    let remote_cmd = format!(
        "{env_exports} mkdir -p {app} {rp_dot} && cd {rp} && \
         exec {remote_py} -m clawagents --serve --port {remote_port}",
        env_exports = env_exports,
        app = shell_quote(&app_support),
        rp_dot = shell_quote(&format!("{remote_path}/.clawagents")),
        rp = shell_quote(&remote_path),
        remote_py = remote_py,
        remote_port = remote_port,
    );

    let forward = format!("{local_port}:127.0.0.1:{remote_port}");
    let mut child = Command::new("ssh")
        .args([
            "-o",
            "BatchMode=yes",
            "-o",
            "ConnectTimeout=20",
            "-o",
            "StrictHostKeyChecking=accept-new",
            "-o",
            "ExitOnForwardFailure=yes",
            "-o",
            "ServerAliveInterval=30",
            "-L",
            &forward,
            &host,
            &remote_cmd,
        ])
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("ssh tunnel spawn failed: {e}"))?;

    if let Err(e) = Sidecar::wait_healthy(local_port, &token, Duration::from_secs(60)) {
        let mut err = String::new();
        if let Some(mut stderr) = child.stderr.take() {
            let _ = stderr.read_to_string(&mut err);
        }
        let _ = child.kill();
        let _ = child.wait();
        let detail = err.trim();
        if detail.is_empty() {
            return Err(e);
        }
        return Err(format!("{e}\n{detail}"));
    }

    seed_remote_project(
        local_port,
        &token,
        &req.project_id,
        &req.project_name,
        &remote_path,
    )?;
    push_api_keys(local_port, &token, &extra_env);

    let info = RemoteGatewayInfo {
        project_id: req.project_id.clone(),
        url: format!("http://127.0.0.1:{local_port}"),
        token,
        host,
        remote_path,
        local_port,
    };

    let mut guard = manager.lock().map_err(|e| e.to_string())?;
    if let Some(existing) = guard.get(&req.project_id) {
        let _ = child.kill();
        let _ = child.wait();
        return Ok(existing.clone());
    }
    guard.sessions.insert(
        req.project_id.clone(),
        RemoteSession {
            info: info.clone(),
            child,
        },
    );
    Ok(info)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shell_quote_escapes_single_quotes() {
        assert_eq!(shell_quote("a'b"), "'a'\"'\"'b'");
    }

    #[test]
    fn list_hosts_tolerates_missing_config() {
        let _ = list_ssh_hosts();
    }
}
