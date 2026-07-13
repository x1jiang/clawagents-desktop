import { useEffect, useState } from "react";
import { useUI } from "../stores/ui";
import { useProjects } from "../stores/projects";
import { pushToast } from "../stores/toasts";
import { CopyButton } from "./CopyButton";

interface Diag {
  backend_version: string;
  python_version: string;
  platform: string;
  host: string;
  app_support_dir: string;
  counts: { projects: number; projectless_chats: number; project_chats: number; custom_commands: number; chat_templates: number };
  providers_with_env_keys: string[];
  external_tools?: Record<string, boolean>;
}

function formatDiagText(d: Diag): string {
  const tools = d.external_tools
    ? `External tools: ${Object.entries(d.external_tools).map(([k, v]) => `${k}=${v ? "yes" : "no"}`).join(", ")}`
    : "";
  return [
    `Backend: ${d.backend_version}`,
    `Python:  ${d.python_version}`,
    `Platform: ${d.platform}`,
    `App support: ${d.app_support_dir}`,
    `Projects: ${d.counts.projects}`,
    `Project chats: ${d.counts.project_chats}`,
    `Projectless chats: ${d.counts.projectless_chats}`,
    `Custom commands: ${d.counts.custom_commands}`,
    `Templates: ${d.counts.chat_templates}`,
    `API keys in env: ${d.providers_with_env_keys.length === 0 ? "(none)" : d.providers_with_env_keys.join(", ")}`,
    tools,
  ].filter(Boolean).join("\n");
}

/**
 * Plain-text rundown of what's running. Surfaces gateway version, paths,
 * counts, and which provider env vars are set (the names, never the values).
 */
export function AboutModal() {
  const open = useUI((s) => s.aboutOpen);
  const close = useUI((s) => s.closeAbout);
  const client = useProjects((s) => s.client);
  const [diag, setDiag] = useState<Diag | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !client) return;
    let cancelled = false;
    (async () => {
      try {
        const d = await client.diagnostics();
        if (!cancelled) setDiag(d);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    })();
    return () => { cancelled = true; };
  }, [open, client]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={close}>
      <div
        className="bg-white dark:bg-gray-900 rounded-lg shadow-lg w-[28rem] p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3 gap-2">
          <h2 className="text-base font-semibold text-gray-800 dark:text-gray-100">About ClawAgents Desktop</h2>
          <div className="flex items-center gap-2">
            {diag && (
              <CopyButton
                text={formatDiagText(diag)}
                title="Copy diagnostics for bug reports"
                label="Copy"
              />
            )}
            <button
              className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 text-xl leading-none"
              onClick={close}
            >
              ×
            </button>
          </div>
        </div>
        {error && <p className="text-xs text-red-600">{error}</p>}
        {!diag && !error && <p className="text-xs text-gray-400">Loading…</p>}
        {diag && (
          <dl className="text-xs grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-gray-700 dark:text-gray-300">
            <dt className="text-gray-500 dark:text-gray-400">Backend</dt>
            <dd className="font-mono break-all">{diag.backend_version}</dd>
            <dt className="text-gray-500 dark:text-gray-400">Python</dt>
            <dd className="font-mono">{diag.python_version}</dd>
            <dt className="text-gray-500 dark:text-gray-400">Platform</dt>
            <dd className="font-mono break-all">{diag.platform}</dd>
            <dt className="text-gray-500 dark:text-gray-400">App support</dt>
            <dd className="font-mono break-all">
              {diag.app_support_dir}
              {client && (
                <button
                  onClick={async () => {
                    try { await client.revealFolder(diag.app_support_dir); }
                    catch (e) { pushToast(`Open failed: ${(e as Error).message}`, "error"); }
                  }}
                  title="Reveal in Finder"
                  className="ml-2 text-blue-600 dark:text-blue-300 hover:underline"
                >
                  ↗
                </button>
              )}
            </dd>
            <dt className="text-gray-500 dark:text-gray-400">Projects</dt>
            <dd>{diag.counts.projects}</dd>
            <dt className="text-gray-500 dark:text-gray-400">Project chats</dt>
            <dd>{diag.counts.project_chats}</dd>
            <dt className="text-gray-500 dark:text-gray-400">Projectless chats</dt>
            <dd>{diag.counts.projectless_chats}</dd>
            <dt className="text-gray-500 dark:text-gray-400">Custom commands</dt>
            <dd>{diag.counts.custom_commands}</dd>
            <dt className="text-gray-500 dark:text-gray-400">Templates</dt>
            <dd>{diag.counts.chat_templates}</dd>
            <dt className="text-gray-500 dark:text-gray-400">API keys</dt>
            <dd className="font-mono">
              {diag.providers_with_env_keys.length === 0
                ? "(none in env)"
                : diag.providers_with_env_keys.join(", ")}
            </dd>
            {diag.external_tools && (
              <>
                <dt className="text-gray-500 dark:text-gray-400">Tools on PATH</dt>
                <dd className="font-mono">
                  {Object.entries(diag.external_tools).map(([name, present]) => (
                    <span
                      key={name}
                      title={present ? `${name} found on PATH` : `${name} not on PATH`}
                      className={
                        "mr-2 " +
                        (present ? "text-emerald-700 dark:text-emerald-400" : "text-gray-400 dark:text-gray-500 line-through")
                      }
                    >
                      {name}
                    </span>
                  ))}
                </dd>
              </>
            )}
          </dl>
        )}
      </div>
    </div>
  );
}
