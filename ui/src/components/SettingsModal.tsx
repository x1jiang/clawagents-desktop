import { useEffect, useState } from "react";
import { useSettings } from "../stores/settings";
import { useProjects } from "../stores/projects";
import { BackupPanel } from "./BackupPanel";
import { clearAllDrafts } from "../lib/drafts";
import { pushToast } from "../stores/toasts";

interface Props {
  onClose: () => void;
}

type ProviderId = "openai" | "anthropic" | "gemini";

const PROVIDERS: Array<{ id: ProviderId; name: string }> = [
  { id: "openai", name: "OpenAI" },
  { id: "anthropic", name: "Anthropic" },
  { id: "gemini", name: "Google Gemini" },
];

export function SettingsModal({ onClose }: Props) {
  const apiKeys = useSettings((s) => s.apiKeys);
  const setApiKey = useSettings((s) => s.setApiKey);
  const client = useProjects((s) => s.client);
  const [drafts, setDrafts] = useState<Record<string, string>>(() =>
    Object.fromEntries(PROVIDERS.map((p) => [p.id, apiKeys[p.id] ?? ""])),
  );
  const [workspacePrompt, setWorkspacePrompt] = useState<string>("");
  const [workspacePromptLoaded, setWorkspacePromptLoaded] = useState<string>("");
  const [defaultMode, setDefaultMode] = useState<string>("auto");
  const [defaultModeLoaded, setDefaultModeLoaded] = useState<string>("auto");
  const [defaultModel, setDefaultModel] = useState<string>("");
  const [defaultModelLoaded, setDefaultModelLoaded] = useState<string>("");
  const [mcpEnabled, setMcpEnabled] = useState(false);
  const [mcpTrust, setMcpTrust] = useState(false);
  const [contextMode, setContextMode] = useState(true);
  const [browserTools, setBrowserTools] = useState(false);
  const [trajectory, setTrajectory] = useState(false);
  const [learn, setLearn] = useState(false);
  const [actionMode, setActionMode] = useState("tools");
  const [agentMode, setAgentMode] = useState("");
  const [allowFullAccess, setAllowFullAccess] = useState(false);
  const [agentLoaded, setAgentLoaded] = useState({
    mcp_enabled: false,
    mcp_trust_workspace: false,
    context_mode: true,
    browser_tools: false,
    trajectory: false,
    learn: false,
    action_mode: "tools",
    agent_mode: "",
    allow_full_access: false,
  });
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  // Per-provider verify state — the "Test" button output lives here.
  const [verifying, setVerifying] = useState<Record<string, boolean>>({});
  const [verdicts, setVerdicts] = useState<Record<string, {
    ok: boolean; status: number; message: string; model_count: number | null;
  } | undefined>>({});

  useEffect(() => {
    if (!client) return;
    void (async () => {
      try {
        const s = await client.getAppSettings();
        setWorkspacePrompt(s.workspace_system_prompt);
        setWorkspacePromptLoaded(s.workspace_system_prompt);
        setDefaultMode(s.default_mode || "auto");
        setDefaultModeLoaded(s.default_mode || "auto");
        setDefaultModel(s.default_model || "");
        setDefaultModelLoaded(s.default_model || "");
        setMcpEnabled(Boolean(s.mcp_enabled));
        setMcpTrust(Boolean(s.mcp_trust_workspace));
        setContextMode(s.context_mode !== false);
        setBrowserTools(Boolean(s.browser_tools));
        setTrajectory(Boolean(s.trajectory));
        setLearn(Boolean(s.learn));
        setActionMode(s.action_mode || "tools");
        setAgentMode(s.agent_mode || "");
        setAllowFullAccess(Boolean(s.allow_full_access));
        setAgentLoaded({
          mcp_enabled: Boolean(s.mcp_enabled),
          mcp_trust_workspace: Boolean(s.mcp_trust_workspace),
          context_mode: s.context_mode !== false,
          browser_tools: Boolean(s.browser_tools),
          trajectory: Boolean(s.trajectory),
          learn: Boolean(s.learn),
          action_mode: s.action_mode || "tools",
          agent_mode: s.agent_mode || "",
          allow_full_access: Boolean(s.allow_full_access),
        });
      } catch {
        // ignore — defaults stay empty
      }
    })();
    void client.listProviders().then((providers) => {
      setAvailableModels(
        providers.flatMap((p) => p.models.filter((m) => m.available).map((m) => m.id)),
      );
    }).catch(() => setAvailableModels([]));
  }, [client]);

  // Dismiss on Escape so it behaves like the other modals (Search, About,
  // Shortcuts). Listener lives on window because the modal grabs focus and
  // some children steal key events.
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

  async function save() {
    setSaving(true);
    try {
      for (const p of PROVIDERS) {
        if (drafts[p.id] !== (apiKeys[p.id] ?? "")) {
          // 1. Persist to Keychain so the value survives app restarts.
          await setApiKey(p.id, drafts[p.id]);
          // 2. Push into the running gateway's env so the next chat turn
          //    picks it up without an app restart.
          if (client) {
            try {
              await client.setApiKey(p.id, drafts[p.id]);
            } catch {
              // Best-effort. Keychain write already succeeded; user can
              // restart the app if the live update path fails.
            }
          }
        }
      }
      if (client && workspacePrompt !== workspacePromptLoaded) {
        try {
          await client.patchAppSettings({ workspace_system_prompt: workspacePrompt });
        } catch {
          // best-effort
        }
      }
      if (client && defaultModel !== defaultModelLoaded) {
        try {
          await client.patchAppSettings({ default_model: defaultModel });
        } catch {
          // best-effort
        }
      }
      if (client && defaultMode !== defaultModeLoaded) {
        try {
          await client.patchAppSettings({ default_mode: defaultMode });
        } catch {
          // best-effort
        }
      }
      if (client) {
        const agentPatch = {
          mcp_enabled: mcpEnabled,
          mcp_trust_workspace: mcpTrust,
          context_mode: contextMode,
          browser_tools: browserTools,
          trajectory,
          learn,
          action_mode: actionMode,
          agent_mode: agentMode,
          allow_full_access: allowFullAccess,
        };
        const changed = Object.entries(agentPatch).some(
          ([k, v]) => (agentLoaded as Record<string, unknown>)[k] !== v,
        );
        if (changed) {
          try {
            await client.patchAppSettings(agentPatch);
          } catch {
            // best-effort
          }
        }
      }
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-stretch sm:items-center justify-center bg-black/30 p-0 sm:p-4">
      <div className="bg-white dark:bg-gray-900 border-0 sm:border border-gray-200 dark:border-gray-700 rounded-none sm:rounded-lg shadow-xl w-full sm:max-w-4xl h-full sm:h-auto sm:max-h-[min(94vh,960px)] flex flex-col">
        <div className="flex items-center justify-between gap-3 shrink-0 px-5 sm:px-6 pt-5 pb-3 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-base font-semibold text-gray-800 dark:text-gray-100">Settings</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-sm text-gray-500 hover:text-gray-800 dark:hover:text-gray-200 px-2 py-1"
            aria-label="Close settings"
          >
            Close
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-5 sm:px-6 py-4 space-y-4">
        <section className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-medium text-gray-700 dark:text-gray-200">API Keys (stored in macOS Keychain)</h3>
            <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={async () => {
                if (!client) return;
                // Run all three providers in parallel; collect verdicts.
                const todo = PROVIDERS.filter((pp) => (drafts[pp.id] ?? "").trim().length > 0);
                if (todo.length === 0) return;
                setVerifying((v) => ({ ...v, ...Object.fromEntries(todo.map((pp) => [pp.id, true])) }));
                const results = await Promise.all(
                  todo.map(async (pp) => {
                    try {
                      const key = drafts[pp.id]!.trim();
                      const v = await client.verifyApiKey(pp.id, key);
                      if (v.ok) {
                        await setApiKey(pp.id, key);
                        try {
                          await client.setApiKey(pp.id, key);
                        } catch {
                          return [
                            pp.id,
                            {
                              ...v,
                              message: `${v.message} (saved to Keychain; live gateway update failed — restart the app)`,
                            },
                          ] as const;
                        }
                      }
                      return [pp.id, v] as const;
                    } catch (e) {
                      return [
                        pp.id,
                        { ok: false, status: 0, message: (e as Error).message, model_count: null },
                      ] as const;
                    }
                  }),
                );
                setVerdicts((prev) => ({ ...prev, ...Object.fromEntries(results) }));
                setVerifying((v) => ({ ...v, ...Object.fromEntries(todo.map((pp) => [pp.id, false])) }));
              }}
              disabled={!client || Object.values(verifying).some(Boolean) || PROVIDERS.every((pp) => !(drafts[pp.id] ?? "").trim())}
              className="text-xs px-2 py-0.5 border border-gray-300 dark:border-gray-700 dark:text-gray-200 rounded hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50"
            >
              Test all
            </button>
            <button
              type="button"
              title="Remove every provider key from Keychain and the running gateway"
              onClick={async () => {
                const next: Record<string, string> = {};
                for (const p of PROVIDERS) {
                  next[p.id] = "";
                  await setApiKey(p.id, null);
                  if (client) {
                    try {
                      await client.setApiKey(p.id, "");
                    } catch {
                      // best-effort
                    }
                  }
                }
                setDrafts(next);
                setVerdicts({});
              }}
              disabled={PROVIDERS.every((pp) => !apiKeys[pp.id] && !(drafts[pp.id] ?? "").trim())}
              className="text-xs px-2 py-0.5 border border-gray-300 dark:border-gray-700 text-red-600 dark:text-red-400 rounded hover:bg-red-50 dark:hover:bg-red-950/30 disabled:opacity-50"
            >
              Clear all
            </button>
            </div>
          </div>
          {PROVIDERS.map((p) => {
            const verdict = verdicts[p.id];
            return (
              <div key={p.id} className="text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-gray-600 dark:text-gray-400">{p.name}</span>
                  {verdict && (
                    <span
                      className={
                        "text-[10px] " +
                        (verdict.ok
                          ? "text-emerald-600 dark:text-emerald-400"
                          : "text-red-600 dark:text-red-400")
                      }
                      title={verdict.message}
                    >
                      {verdict.ok
                        ? `✓ valid${verdict.model_count !== null ? ` · ${verdict.model_count} models` : ""}`
                        : `✗ ${verdict.message.slice(0, 40)}${verdict.message.length > 40 ? "…" : ""}`}
                    </span>
                  )}
                </div>
                <div className="mt-1 flex items-center gap-2">
                  <input
                    type="password"
                    className="flex-1 border border-gray-300 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded px-2 py-1 text-sm font-mono"
                    value={drafts[p.id] ?? ""}
                    onChange={(e) => {
                      setDrafts({ ...drafts, [p.id]: e.target.value });
                      // Clear the verdict when the key changes — it's stale now.
                      if (verdicts[p.id]) setVerdicts({ ...verdicts, [p.id]: undefined });
                    }}
                    placeholder={apiKeys[p.id] ? "(saved)" : "(unset)"}
                  />
                  <button
                    type="button"
                    onClick={async () => {
                      const key = (drafts[p.id] ?? "").trim();
                      if (!key || !client) return;
                      setVerifying({ ...verifying, [p.id]: true });
                      try {
                        const v = await client.verifyApiKey(p.id, key);
                        setVerdicts({ ...verdicts, [p.id]: v });
                        // Test alone used to leave chat on a stale gateway env key.
                        // On success, persist + push so the next turn uses this key.
                        if (v.ok) {
                          await setApiKey(p.id, key);
                          try {
                            await client.setApiKey(p.id, key);
                          } catch {
                            setVerdicts({
                              ...verdicts,
                              [p.id]: {
                                ...v,
                                message: `${v.message} (saved to Keychain; live gateway update failed — restart the app)`,
                              },
                            });
                          }
                        }
                      } catch (e) {
                        setVerdicts({
                          ...verdicts,
                          [p.id]: { ok: false, status: 0, message: (e as Error).message, model_count: null },
                        });
                      } finally {
                        setVerifying({ ...verifying, [p.id]: false });
                      }
                    }}
                    disabled={!drafts[p.id] || !!verifying[p.id]}
                    className="px-2 py-1 text-xs border border-gray-300 dark:border-gray-700 dark:text-gray-200 rounded hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50"
                  >
                    {verifying[p.id] ? "Testing…" : "Test"}
                  </button>
                  <button
                    type="button"
                    title="Remove this key from Keychain and the running gateway"
                    onClick={async () => {
                      setDrafts({ ...drafts, [p.id]: "" });
                      if (verdicts[p.id]) setVerdicts({ ...verdicts, [p.id]: undefined });
                      await setApiKey(p.id, null);
                      if (client) {
                        try {
                          await client.setApiKey(p.id, "");
                        } catch {
                          // best-effort live clear
                        }
                      }
                    }}
                    disabled={!apiKeys[p.id] && !(drafts[p.id] ?? "").trim()}
                    className="px-2 py-1 text-xs border border-gray-300 dark:border-gray-700 text-red-600 dark:text-red-400 rounded hover:bg-red-50 dark:hover:bg-red-950/30 disabled:opacity-50"
                  >
                    Clear
                  </button>
                </div>
              </div>
            );
          })}
        </section>

        <section className="space-y-2 pt-4 border-t border-gray-200 dark:border-gray-700">
          <h3 className="text-sm font-medium text-gray-700 dark:text-gray-200">Default model for new chats</h3>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Used when a new chat is created without an explicit model. Leave blank to fall back to
            the first available provider.
          </p>
          <select
            value={defaultModel}
            onChange={(e) => setDefaultModel(e.target.value)}
            className="w-full px-2 py-1 text-sm border border-gray-300 dark:border-gray-700 rounded bg-white dark:bg-gray-800 dark:text-gray-100"
          >
            <option value="">(auto — first available provider)</option>
            {availableModels.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
            {/* Allow keeping a previously-saved model even if its provider currently
                has no key (so saving doesn't silently clear it). */}
            {defaultModel && !availableModels.includes(defaultModel) && (
              <option value={defaultModel}>{defaultModel} (no key)</option>
            )}
          </select>
        </section>

        <section className="space-y-2 pt-4 border-t border-gray-200 dark:border-gray-700">
          <h3 className="text-sm font-medium text-gray-700 dark:text-gray-200">Default mode for new chats</h3>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Read-only blocks writes outright. Auto allows writes inside the project root.
            Ask prompts before each write. Full access allows everything.
          </p>
          <select
            value={defaultMode}
            onChange={(e) => setDefaultMode(e.target.value)}
            className="w-full px-2 py-1 text-sm border border-gray-300 dark:border-gray-700 rounded bg-white dark:bg-gray-800 dark:text-gray-100"
          >
            <option value="read_only">Read-only</option>
            <option value="ask">Ask</option>
            <option value="auto">Auto (recommended)</option>
            <option value="full_access">Full access</option>
          </select>
        </section>

        <section className="space-y-2 pt-4 border-t border-gray-200 dark:border-gray-700">
          <h3 className="text-sm font-medium text-gray-700 dark:text-gray-200">Workspace system prompt</h3>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Prepended to the first user message of every chat in this app, before any project-level prompt or CLAUDE.md.
            Stays in conversation history — no per-turn token cost.
          </p>
          <textarea
            value={workspacePrompt}
            onChange={(e) => setWorkspacePrompt(e.target.value)}
            rows={4}
            placeholder="You are an experienced engineer. Bias toward small, reversible diffs."
            className="w-full px-2 py-1 text-sm font-mono border border-gray-300 dark:border-gray-700 rounded bg-white dark:bg-gray-900 dark:text-gray-100"
          />
        </section>

        <section className="space-y-3 pt-4 border-t border-gray-200 dark:border-gray-700">
          <h3 className="text-sm font-medium text-gray-700 dark:text-gray-200">Agent power</h3>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Same opt-in surfaces as the VS Code plugin. Defaults stay safe (MCP / browser / full access off).
          </p>
          <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
            <input type="checkbox" checked={mcpEnabled} onChange={(e) => setMcpEnabled(e.target.checked)} />
            Enable MCP servers (~/.clawagents/mcp.json)
          </label>
          <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
            <input type="checkbox" checked={mcpTrust} onChange={(e) => setMcpTrust(e.target.checked)} />
            Trust workspace .clawagents/mcp.json
          </label>
          <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
            <input type="checkbox" checked={contextMode} onChange={(e) => setContextMode(e.target.checked)} />
            Context Mode tools (when <code className="text-xs">context-mode</code> is installed)
          </label>
          <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
            <input type="checkbox" checked={browserTools} onChange={(e) => setBrowserTools(e.target.checked)} />
            Browser tools (Playwright)
          </label>
          <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
            <input type="checkbox" checked={trajectory} onChange={(e) => setTrajectory(e.target.checked)} />
            Trajectory logging
          </label>
          <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
            <input type="checkbox" checked={learn} onChange={(e) => setLearn(e.target.checked)} />
            Learn from trajectories (implies trajectory)
          </label>
          <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
            <input type="checkbox" checked={allowFullAccess} onChange={(e) => setAllowFullAccess(e.target.checked)} />
            Allow Full Access mode
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs text-gray-500 dark:text-gray-400">
              Action mode
              <select
                value={actionMode}
                onChange={(e) => setActionMode(e.target.value)}
                className="mt-1 w-full px-2 py-1 text-sm border border-gray-300 dark:border-gray-700 rounded bg-white dark:bg-gray-800 dark:text-gray-100"
              >
                <option value="tools">Tools</option>
                <option value="code">CodeAct</option>
              </select>
            </label>
            <label className="text-xs text-gray-500 dark:text-gray-400">
              Persona mode
              <input
                value={agentMode}
                onChange={(e) => setAgentMode(e.target.value)}
                placeholder="ask / architect / code / …"
                className="mt-1 w-full px-2 py-1 text-sm border border-gray-300 dark:border-gray-700 rounded bg-white dark:bg-gray-800 dark:text-gray-100"
              />
            </label>
          </div>
        </section>

        <BackupPanel />

        <section className="space-y-2 mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
          <h3 className="text-sm font-medium text-gray-700 dark:text-gray-200">Housekeeping</h3>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Composer drafts are kept in localStorage per chat. Clear them if you ever feel like the UI
            is "remembering" too much.
          </p>
          <button
            onClick={() => {
              const n = clearAllDrafts();
              pushToast(`Cleared ${n} draft${n === 1 ? "" : "s"}.`, "success");
            }}
            className="px-3 py-1 text-xs border border-gray-300 dark:border-gray-700 rounded bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700"
          >
            Clear all composer drafts
          </button>
        </section>
        </div>

        <div className="flex justify-end gap-2 shrink-0 px-5 sm:px-6 py-3 border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
          <button onClick={onClose} className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200" disabled={saving}>
            Cancel
          </button>
          <button onClick={save} className="px-3 py-1.5 text-sm bg-gray-900 text-white rounded hover:bg-gray-700 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-gray-300" disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
