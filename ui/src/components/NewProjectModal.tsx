import { useEffect, useState, type FormEvent } from "react";
import { tauriApi } from "../lib/tauri";
import { formatErr } from "../lib/format_err";
import { useProjects } from "../stores/projects";

interface Props {
  onClose: () => void;
}

type Tab = "local" | "ssh";

export function NewProjectModal({ onClose }: Props) {
  const create = useProjects((s) => s.create);
  const [tab, setTab] = useState<Tab>("local");
  const [name, setName] = useState("");
  const [rootPath, setRootPath] = useState("");
  const [sshHost, setSshHost] = useState("");
  const [remotePath, setRemotePath] = useState("");
  const [hosts, setHosts] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testOk, setTestOk] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [configHint, setConfigHint] = useState<string | null>(null);

  async function reloadHosts() {
    try {
      setHosts(await tauriApi.listSshHosts());
    } catch {
      setHosts([]);
    }
  }

  useEffect(() => {
    if (tab !== "ssh") return;
    void reloadHosts();
  }, [tab]);

  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function openSshConfig() {
    setError(null);
    try {
      const path = await tauriApi.openSshConfig();
      setConfigHint(`Opened ${path} — save, then Reload hosts`);
    } catch (err) {
      setError(formatErr(err));
    }
  }

  async function pickFolder() {
    const picked = await tauriApi.pickFolder();
    if (!picked) return;
    setRootPath(picked);
    if (name.trim() === "") {
      const basename = picked.replace(/\/+$/, "").split("/").pop() ?? "";
      if (basename) setName(basename);
    }
  }

  async function testConnection() {
    setTesting(true);
    setError(null);
    setTestOk(null);
    try {
      await tauriApi.testSshConnection(sshHost.trim(), remotePath.trim());
      setTestOk("Connection OK — remote path exists.");
      if (name.trim() === "") {
        const basename = remotePath.trim().replace(/\/+$/, "").split("/").pop() ?? "";
        if (basename) setName(basename);
      }
    } catch (err) {
      setError(formatErr(err));
    } finally {
      setTesting(false);
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      if (tab === "ssh") {
        const host = sshHost.trim();
        const remote = remotePath.trim();
        if (!host || !remote) throw new Error("SSH host and remote path are required");
        await create(name.trim(), remote, {
          kind: "ssh",
          ssh_host: host,
          remote_path: remote,
        });
      } else {
        await create(name.trim(), rootPath.trim());
      }
      onClose();
    } catch (err) {
      setError(formatErr(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/30 flex items-center justify-center z-50"
      onClick={onClose}
    >
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl p-5 w-[26rem] space-y-3"
      >
        <h2 className="text-base font-semibold text-gray-800 dark:text-gray-100">New project</h2>

        <div className="flex gap-1 p-0.5 rounded-md bg-gray-100 dark:bg-gray-800">
          <button
            type="button"
            onClick={() => { setTab("local"); setError(null); setTestOk(null); }}
            className={`flex-1 px-2 py-1 text-sm rounded ${
              tab === "local"
                ? "bg-white dark:bg-gray-700 shadow text-gray-900 dark:text-gray-100"
                : "text-gray-600 dark:text-gray-400"
            }`}
          >
            Local
          </button>
          <button
            type="button"
            onClick={() => { setTab("ssh"); setError(null); setTestOk(null); }}
            className={`flex-1 px-2 py-1 text-sm rounded ${
              tab === "ssh"
                ? "bg-white dark:bg-gray-700 shadow text-gray-900 dark:text-gray-100"
                : "text-gray-600 dark:text-gray-400"
            }`}
          >
            SSH
          </button>
        </div>

        <label className="block text-sm">
          <span className="text-gray-600 dark:text-gray-400">Name</span>
          <input
            className="mt-1 w-full border border-gray-300 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded px-2 py-1 text-sm"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            autoFocus
          />
        </label>

        {tab === "local" ? (
          <label className="block text-sm">
            <span className="text-gray-600 dark:text-gray-400">Folder</span>
            <div className="flex gap-2 mt-1">
              <input
                className="flex-1 border border-gray-300 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded px-2 py-1 text-sm font-mono"
                value={rootPath}
                onChange={(e) => setRootPath(e.target.value)}
                placeholder="/Users/you/code/my-project"
                required
              />
              <button
                type="button"
                onClick={pickFolder}
                className="px-2 py-1 text-sm border border-gray-300 dark:border-gray-700 dark:text-gray-200 rounded hover:bg-gray-50 dark:hover:bg-gray-800"
              >
                Choose…
              </button>
            </div>
          </label>
        ) : (
          <>
            <label className="block text-sm">
              <span className="text-gray-600 dark:text-gray-400 flex items-center justify-between gap-2">
                <span>
                  SSH host
                  <span className="ml-1 text-xs text-gray-400">(from ~/.ssh/config — ProxyJump OK)</span>
                </span>
                <span className="flex shrink-0 gap-2 text-xs">
                  <button
                    type="button"
                    onClick={() => void openSshConfig()}
                    className="text-blue-600 dark:text-blue-300 hover:underline"
                    title="Open ~/.ssh/config in TextEdit"
                  >
                    Edit config…
                  </button>
                  <button
                    type="button"
                    onClick={() => void reloadHosts()}
                    className="text-gray-500 dark:text-gray-400 hover:underline"
                    title="Reload Host list after saving config"
                  >
                    Reload hosts
                  </button>
                </span>
              </span>
              <input
                list="claw-ssh-hosts"
                className="mt-1 w-full border border-gray-300 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded px-2 py-1 text-sm font-mono"
                value={sshHost}
                onChange={(e) => { setSshHost(e.target.value); setTestOk(null); }}
                placeholder="my-jump-box-host"
                required
              />
              <datalist id="claw-ssh-hosts">
                {hosts.map((h) => (
                  <option key={h} value={h} />
                ))}
              </datalist>
              {configHint && (
                <div className="mt-1 text-[11px] text-gray-500 dark:text-gray-400 font-mono truncate" title={configHint}>
                  {configHint}
                </div>
              )}
            </label>
            <label className="block text-sm">
              <span className="text-gray-600 dark:text-gray-400">Remote path</span>
              <input
                className="mt-1 w-full border border-gray-300 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded px-2 py-1 text-sm font-mono"
                value={remotePath}
                onChange={(e) => { setRemotePath(e.target.value); setTestOk(null); }}
                placeholder="/home/you/code/my-project"
                required
              />
            </label>
            <button
              type="button"
              onClick={() => void testConnection()}
              disabled={testing || !sshHost.trim() || !remotePath.trim()}
              className="w-full px-2 py-1.5 text-sm border border-gray-300 dark:border-gray-700 rounded hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50"
            >
              {testing ? "Testing… (can take up to ~30s via jumpbox)" : "Test connection"}
            </button>
            {testing && (
              <div className="text-xs text-amber-700 dark:text-amber-300">
                Running <span className="font-mono">ssh</span> through your config… UI should stay responsive.
              </div>
            )}
            {testOk && (
              <div className="text-xs text-green-700 dark:text-green-400">{testOk}</div>
            )}
          </>
        )}

        {error && (
          <div className="text-xs text-red-600 dark:text-red-400 whitespace-pre-wrap border border-red-200 dark:border-red-900 rounded p-2 bg-red-50 dark:bg-red-950/30">
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1 text-sm text-gray-600 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200"
            disabled={submitting}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="px-3 py-1 text-sm bg-gray-900 text-white rounded hover:bg-gray-700 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-gray-300"
            disabled={submitting}
          >
            {submitting ? "Creating…" : "Create"}
          </button>
        </div>
      </form>
    </div>
  );
}
