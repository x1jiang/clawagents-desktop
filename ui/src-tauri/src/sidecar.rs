//! Python sidecar lifecycle.

use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

pub struct Sidecar {
    pub child: Child,
    pub log_path: PathBuf,
}

#[derive(Debug, Clone)]
pub struct SpawnConfig {
    /// Path to the venv's Python interpreter.
    pub python: PathBuf,
    /// Port the gateway should bind on 127.0.0.1.
    pub port: u16,
    /// Random Bearer token (32 hex chars).
    pub api_key: String,
    /// Where to redirect stdout/stderr (one combined log file per launch).
    pub log_path: PathBuf,
    /// Optional override for `CLAWAGENTS_DESKTOP_APP_SUPPORT` (used by tests).
    pub app_support_override: Option<PathBuf>,
    /// Path to a `.env` file to load before constructing providers.
    /// Translated into the `CLAWAGENTS_ENV_FILE` env var for the subprocess.
    pub env_file: Option<PathBuf>,
    /// Additional env vars merged into the subprocess (e.g., API keys from Keychain).
    pub extra_env: Vec<(String, String)>,
}

impl Sidecar {
    /// Spawn the gateway. The caller is responsible for calling
    /// [`Sidecar::shutdown`] on app exit.
    pub fn spawn(cfg: &SpawnConfig) -> std::io::Result<Sidecar> {
        if let Some(parent) = cfg.log_path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let log_file = std::fs::File::create(&cfg.log_path)?;
        let log_dup = log_file.try_clone()?;

        let mut cmd = Command::new(&cfg.python);
        cmd.args([
            "-m", "clawagents",
            "--serve",
            "--port", &cfg.port.to_string(),
        ]);
        cmd.env("GATEWAY_HOST", "127.0.0.1");
        cmd.env("GATEWAY_API_KEY", &cfg.api_key);
        // Keychain-injected keys must win over any workspace .env the library
        // might load mid-process (VS Code 1.0.22–1.0.23 parity).
        cmd.env("CLAWAGENTS_SKIP_DOTENV", "1");
        cmd.env("CLAWAGENTS_DOTENV_OVERRIDE", "0");
        if let Some(override_path) = &cfg.app_support_override {
            cmd.env("CLAWAGENTS_DESKTOP_APP_SUPPORT", override_path);
        }
        if let Some(env_file) = &cfg.env_file {
            cmd.env("CLAWAGENTS_ENV_FILE", env_file);
        }
        for (k, v) in &cfg.extra_env {
            cmd.env(k, v);
        }
        cmd.stdout(Stdio::from(log_file));
        cmd.stderr(Stdio::from(log_dup));

        let child = cmd.spawn()?;
        Ok(Sidecar { child, log_path: cfg.log_path.clone() })
    }

    /// Poll `GET /health` until it returns 200 or `timeout` elapses.
    /// Returns `Ok(())` on success, `Err(...)` on timeout or transport error.
    pub fn wait_healthy(
        port: u16,
        api_key: &str,
        timeout: Duration,
    ) -> Result<(), String> {
        let url = format!("http://127.0.0.1:{}/health", port);
        let bearer = format!("Bearer {}", api_key);
        let client = reqwest::blocking::Client::builder()
            .timeout(Duration::from_millis(500))
            .build()
            .map_err(|e| format!("client build: {e}"))?;
        let deadline = Instant::now() + timeout;
        while Instant::now() < deadline {
            let req = client.get(&url).header("Authorization", &bearer).send();
            if let Ok(resp) = req {
                if resp.status().is_success() {
                    return Ok(());
                }
            }
            std::thread::sleep(Duration::from_millis(250));
        }
        Err(format!("gateway health check timed out after {:?}", timeout))
    }

    /// Send SIGTERM (or platform equivalent), wait up to `grace`, then SIGKILL.
    pub fn shutdown(&mut self, grace: Duration) {
        let _ = self.child.kill_with_term();
        let deadline = Instant::now() + grace;
        while Instant::now() < deadline {
            match self.child.try_wait() {
                Ok(Some(_)) => return,
                _ => std::thread::sleep(Duration::from_millis(50)),
            }
        }
        let _ = self.child.kill();
    }
}

trait ChildKillTerm {
    fn kill_with_term(&mut self) -> std::io::Result<()>;
}

#[cfg(unix)]
impl ChildKillTerm for Child {
    fn kill_with_term(&mut self) -> std::io::Result<()> {
        let pid = self.id() as i32;
        // SIGTERM = 15
        unsafe {
            if libc::kill(pid, libc::SIGTERM) == -1 {
                return Err(std::io::Error::last_os_error());
            }
        }
        Ok(())
    }
}

#[cfg(not(unix))]
impl ChildKillTerm for Child {
    fn kill_with_term(&mut self) -> std::io::Result<()> {
        self.kill()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Read;

    #[test]
    fn spawn_runs_and_writes_to_log() {
        // Sanity test: spawn `python3 -c "print('hi')"` (the real Python CLI)
        // and verify the log captures stdout.
        let tmp = tempfile::tempdir().unwrap();
        let log = tmp.path().join("test.log");

        // For a pure unit test, exec a one-line python that just exits. We
        // re-use Sidecar's basic shape but bypass the gateway-specific args.
        let mut cmd = Command::new("python3");
        cmd.args(["-c", "import sys; sys.stdout.write('OK\\n'); sys.exit(0)"]);
        let log_file = std::fs::File::create(&log).unwrap();
        cmd.stdout(Stdio::from(log_file));
        cmd.stderr(Stdio::null());
        let child = cmd.spawn().expect("python3 must be on PATH");
        let mut sidecar = Sidecar { child, log_path: log.clone() };
        let _ = sidecar.child.wait();

        let mut s = String::new();
        std::fs::File::open(&log).unwrap().read_to_string(&mut s).unwrap();
        assert!(s.contains("OK"), "log should contain stdout, got: {s}");
    }

    #[test]
    fn wait_healthy_times_out_against_dead_port() {
        // Pick a port that nothing is listening on; expect the wait to time out.
        let port = crate::port::pick_free_port().unwrap();
        let result = Sidecar::wait_healthy(port, "key", Duration::from_millis(300));
        assert!(result.is_err());
    }
}
