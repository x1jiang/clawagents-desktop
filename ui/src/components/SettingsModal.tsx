import { useEffect, useMemo, useState } from "react";
import { useSettings } from "../stores/settings";
import { useProjects } from "../stores/projects";
import { BackupPanel } from "./BackupPanel";
import { clearAllDrafts } from "../lib/drafts";
import { pushToast } from "../stores/toasts";
import type { AppSettings, ProviderCatalogEntry } from "../lib/gateway";

interface Props {
  onClose: () => void;
}

type ProviderId = "openai" | "anthropic" | "gemini" | "bedrock";
type SettingsTab = "providers" | "defaults" | "agent" | "data";

const KEY_PROVIDERS: Array<{ id: ProviderId; name: string; hint: string }> = [
  { id: "openai", name: "OpenAI", hint: "Official API, or OpenAI-compatible proxies via Base URL" },
  { id: "anthropic", name: "Anthropic", hint: "Claude via Anthropic API (not Bedrock)" },
  { id: "gemini", name: "Google Gemini", hint: "Google AI Studio / Gemini API key" },
  { id: "bedrock", name: "AWS Bedrock", hint: "Native IAM (HIPAA) or optional Access Gateway" },
];

const TABS: Array<{ id: SettingsTab; label: string }> = [
  { id: "providers", label: "Providers" },
  { id: "defaults", label: "Defaults" },
  { id: "agent", label: "Agent" },
  { id: "data", label: "Data" },
];

type Verdict = { ok: boolean; status: number; message: string; model_count: number | null };

export function SettingsModal({ onClose }: Props) {
  const apiKeys = useSettings((s) => s.apiKeys);
  const setApiKey = useSettings((s) => s.setApiKey);
  const client = useProjects((s) => s.client);
  const projects = useProjects((s) => s.projects);

  const [tab, setTab] = useState<SettingsTab>("providers");
  const [drafts, setDrafts] = useState<Record<string, string>>(() =>
    Object.fromEntries(KEY_PROVIDERS.map((p) => [p.id, apiKeys[p.id] ?? ""])),
  );
  const [loaded, setLoaded] = useState<AppSettings | null>(null);
  const [provider, setProvider] = useState("auto");
  const [baseUrl, setBaseUrl] = useState("");
  const [trustBaseUrl, setTrustBaseUrl] = useState(false);
  const [awsRegion, setAwsRegion] = useState("us-east-1");
  const [awsProfile, setAwsProfile] = useState("");
  const [hasAwsCreds, setHasAwsCreds] = useState(false);
  const [workspacePrompt, setWorkspacePrompt] = useState("");
  const [defaultMode, setDefaultMode] = useState("auto");
  const [defaultModel, setDefaultModel] = useState("");
  const [mcpEnabled, setMcpEnabled] = useState(false);
  const [mcpTrust, setMcpTrust] = useState(false);
  const [contextMode, setContextMode] = useState(true);
  const [browserTools, setBrowserTools] = useState(false);
  const [trajectory, setTrajectory] = useState(false);
  const [learn, setLearn] = useState(false);
  const [actionMode, setActionMode] = useState("tools");
  const [agentMode, setAgentMode] = useState("");
  const [allowFullAccess, setAllowFullAccess] = useState(false);
  const [allowExternalSkillDirs, setAllowExternalSkillDirs] = useState(false);
  const [reasoningEffort, setReasoningEffort] = useState("medium");
  const [wireApi, setWireApi] = useState("auto");
  const [sslVerify, setSslVerify] = useState(true);
  const [skillUserHomes, setSkillUserHomes] = useState(true);
  const [catalog, setCatalog] = useState<ProviderCatalogEntry[]>([]);
  const [saving, setSaving] = useState(false);
  const [securityScope, setSecurityScope] = useState("projectless");
  const [verifying, setVerifying] = useState<Record<string, boolean>>({});
  const [verdicts, setVerdicts] = useState<Record<string, Verdict | undefined>>({});

  useEffect(() => {
    if (!client) return;
    void (async () => {
      try {
        const projectId = securityScope === "projectless" ? null : securityScope;
        const s = await client.getAppSettings(projectId, securityScope === "projectless");
        setLoaded(s);
        setWorkspacePrompt(s.workspace_system_prompt || "");
        setDefaultMode(s.default_mode || "auto");
        setDefaultModel(s.default_model || "");
        setProvider(s.provider || "auto");
        setBaseUrl(s.base_url || "");
        setTrustBaseUrl(Boolean(s.trust_custom_base_url));
        setAwsRegion(s.aws_region || "us-east-1");
        setAwsProfile(s.aws_profile || "");
        setHasAwsCreds(Boolean(s.has_aws_credentials));
        setMcpEnabled(Boolean(s.mcp_enabled));
        setMcpTrust(Boolean(s.mcp_trust_workspace));
        setContextMode(s.context_mode !== false);
        setBrowserTools(Boolean(s.browser_tools));
        setTrajectory(Boolean(s.trajectory));
        setLearn(Boolean(s.learn));
        setActionMode(s.action_mode || "tools");
        setAgentMode(s.agent_mode || "");
        setAllowFullAccess(Boolean(s.allow_full_access));
        setAllowExternalSkillDirs(Boolean(s.allow_external_skill_dirs));
        setReasoningEffort(s.reasoning_effort || "medium");
        setWireApi(s.wire_api || "auto");
        setSslVerify(s.ssl_verify !== false);
        setSkillUserHomes(s.skill_user_homes !== false);
      } catch {
        /* defaults */
      }
    })();
    const projectId = securityScope === "projectless" ? null : securityScope;
    void client.listProviders(projectId, securityScope === "projectless").then(setCatalog).catch(() => setCatalog([]));
  }, [client, securityScope]);

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

  const availableModels = useMemo(() => {
    const rows: Array<{ id: string; label: string; provider: string }> = [];
    for (const p of catalog) {
      for (const m of p.models || []) {
        if (!m.available && !(provider === p.id || provider === "auto")) continue;
        rows.push({ id: m.id, label: m.label || m.id, provider: p.id });
      }
    }
    return rows;
  }, [catalog, provider]);

  async function persistKey(id: ProviderId, key: string) {
    await setApiKey(id, key || null);
    if (client) {
      try {
        await client.setApiKey(id, key);
      } catch {
        /* Keychain ok; gateway may need restart */
      }
    }
  }

  async function testProvider(id: ProviderId) {
    if (!client) return;
    const key = (drafts[id] ?? "").trim();
    setVerifying((v) => ({ ...v, [id]: true }));
    try {
      const v = await client.verifyApiKey(id, key);
      setVerdicts((prev) => ({ ...prev, [id]: v }));
      if (v.ok && key && id !== "bedrock") {
        await persistKey(id, key);
      } else if (v.ok && key && id === "bedrock") {
        await persistKey(id, key);
      }
      if (id === "bedrock" && v.ok) {
        const projectId = securityScope === "projectless" ? null : securityScope;
        const s = await client.getAppSettings(projectId, securityScope === "projectless");
        setHasAwsCreds(Boolean(s.has_aws_credentials));
      }
    } catch (e) {
      setVerdicts((prev) => ({
        ...prev,
        [id]: { ok: false, status: 0, message: (e as Error).message, model_count: null },
      }));
    } finally {
      setVerifying((v) => ({ ...v, [id]: false }));
    }
  }

  async function save() {
    setSaving(true);
    try {
      for (const p of KEY_PROVIDERS) {
        if (drafts[p.id] !== (apiKeys[p.id] ?? "")) {
          await persistKey(p.id, drafts[p.id] ?? "");
        }
      }
      if (client) {
        const needsTrust =
          Boolean(baseUrl.trim()) &&
          !/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]|::1)(:|\/|$)/i.test(baseUrl.trim());
        if (needsTrust && !trustBaseUrl) {
          const ok = window.confirm(
            `Custom base URL "${baseUrl.trim()}" will receive API keys. Trust this endpoint?`,
          );
          if (!ok) {
            setSaving(false);
            return;
          }
          setTrustBaseUrl(true);
        }
        const projectId = securityScope === "projectless" ? null : securityScope;
        await client.patchAppSettings({
          workspace_system_prompt: workspacePrompt,
          default_model: defaultModel,
          default_mode: defaultMode,
          provider,
          base_url: baseUrl.trim(),
          trust_custom_base_url: needsTrust ? true : trustBaseUrl,
          aws_region: awsRegion.trim(),
          aws_profile: awsProfile.trim(),
          mcp_enabled: mcpEnabled,
          mcp_trust_workspace: mcpTrust,
          context_mode: contextMode,
          browser_tools: browserTools,
          trajectory,
          learn,
          action_mode: actionMode,
          agent_mode: agentMode,
          allow_full_access: allowFullAccess,
          allow_external_skill_dirs: allowExternalSkillDirs,
          reasoning_effort: reasoningEffort,
          wire_api: wireApi,
          ssl_verify: sslVerify,
          skill_user_homes: skillUserHomes,
        }, projectId, securityScope === "projectless");
        // Refresh catalog so custom base_url model probes show up.
        void client.listProviders(projectId, securityScope === "projectless").then(setCatalog).catch(() => undefined);
      }
      onClose();
    } finally {
      setSaving(false);
    }
  }

  function ProviderCard({
    id,
    name,
    hint,
  }: {
    id: ProviderId;
    name: string;
    hint: string;
  }) {
    const verdict = verdicts[id];
    const active = provider === id;
    return (
      <div
        className={
          "rounded-xl border p-4 transition-colors " +
          (active
            ? "border-teal-600/50 bg-teal-50/60 dark:border-teal-500/40 dark:bg-teal-950/20"
            : "border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900/40")
        }
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h4 className="text-sm font-semibold text-gray-800 dark:text-gray-100">{name}</h4>
              {active && (
                <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-teal-700 text-white">
                  preferred
                </span>
              )}
            </div>
            <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{hint}</p>
          </div>
          <button
            type="button"
            className="text-xs shrink-0 px-2 py-1 rounded border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800"
            onClick={() => {
              setProvider(id);
              if (id === "bedrock" && !defaultModel) {
                setDefaultModel("us.anthropic.claude-sonnet-4-5-20250929-v1:0");
              }
              if (id === "bedrock" && !awsRegion) setAwsRegion("us-east-1");
            }}
          >
            Use
          </button>
        </div>

        {id === "bedrock" ? (
          <div className="mt-3 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <label className="text-xs text-gray-500 dark:text-gray-400">
                AWS region
                <input
                  value={awsRegion}
                  onChange={(e) => setAwsRegion(e.target.value)}
                  placeholder="us-east-1"
                  className="mt-1 w-full px-2 py-1.5 text-sm border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 dark:text-gray-100"
                />
              </label>
              <label className="text-xs text-gray-500 dark:text-gray-400">
                AWS profile (optional)
                <input
                  value={awsProfile}
                  onChange={(e) => setAwsProfile(e.target.value)}
                  placeholder="default"
                  className="mt-1 w-full px-2 py-1.5 text-sm border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 dark:text-gray-100"
                />
              </label>
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Native IAM: leave Base URL empty. Credentials from ~/.aws, env, or instance role.
              Status:{" "}
              <span className={hasAwsCreds ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600"}>
                {hasAwsCreds ? "AWS creds detected" : "not detected yet"}
              </span>
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="text-xs px-2 py-1 rounded-lg border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800"
                onClick={() => {
                  setProvider("bedrock");
                  setBaseUrl("");
                  setDefaultModel(
                    defaultModel || "us.anthropic.claude-sonnet-4-5-20250929-v1:0",
                  );
                }}
              >
                Use native IAM
              </button>
              <button
                type="button"
                className="text-xs px-2 py-1 rounded-lg border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800"
                onClick={() => {
                  setProvider("bedrock");
                  setBaseUrl("http://localhost:8000/api/v1");
                }}
              >
                Local BAG URL
              </button>
              <button
                type="button"
                className="text-xs px-2 py-1 rounded-lg border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800"
                disabled={!!verifying[id]}
                onClick={() => void testProvider(id)}
              >
                {verifying[id] ? "Checking…" : "Check credentials"}
              </button>
            </div>
            <label className="text-xs text-gray-500 dark:text-gray-400 block">
              Gateway API key (optional — BAG / LiteLLM only)
              <div className="mt-1 flex gap-2">
                <input
                  type="password"
                  value={drafts.bedrock ?? ""}
                  onChange={(e) => {
                    setDrafts({ ...drafts, bedrock: e.target.value });
                    if (verdicts.bedrock) setVerdicts({ ...verdicts, bedrock: undefined });
                  }}
                  placeholder={apiKeys.bedrock ? "(saved)" : "only for gateway"}
                  className="flex-1 px-2 py-1.5 text-sm font-mono border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 dark:text-gray-100"
                />
                <button
                  type="button"
                  className="px-2 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded-lg disabled:opacity-50"
                  disabled={!drafts.bedrock}
                  onClick={() => void persistKey("bedrock", (drafts.bedrock ?? "").trim())}
                >
                  Save key
                </button>
              </div>
            </label>
          </div>
        ) : (
          <div className="mt-3 flex items-center gap-2">
            <input
              type="password"
              className="flex-1 border border-gray-300 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-2 py-1.5 text-sm font-mono"
              value={drafts[id] ?? ""}
              onChange={(e) => {
                setDrafts({ ...drafts, [id]: e.target.value });
                if (verdicts[id]) setVerdicts({ ...verdicts, [id]: undefined });
              }}
              placeholder={apiKeys[id] ? "(saved)" : "(unset)"}
            />
            <button
              type="button"
              onClick={() => void testProvider(id)}
              disabled={!drafts[id] || !!verifying[id]}
              className="px-2 py-1.5 text-xs border border-gray-300 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50"
            >
              {verifying[id] ? "Testing…" : "Test"}
            </button>
            <button
              type="button"
              onClick={async () => {
                setDrafts({ ...drafts, [id]: "" });
                if (verdicts[id]) setVerdicts({ ...verdicts, [id]: undefined });
                await persistKey(id, "");
              }}
              disabled={!apiKeys[id] && !(drafts[id] ?? "").trim()}
              className="px-2 py-1.5 text-xs border border-gray-300 dark:border-gray-700 text-red-600 dark:text-red-400 rounded-lg disabled:opacity-50"
            >
              Clear
            </button>
          </div>
        )}

        {verdict && (
          <p
            className={
              "mt-2 text-[11px] " +
              (verdict.ok
                ? "text-emerald-600 dark:text-emerald-400"
                : "text-red-600 dark:text-red-400")
            }
          >
            {verdict.ok ? "✓" : "✗"} {verdict.message}
            {verdict.model_count != null ? ` · ${verdict.model_count} models` : ""}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-stretch sm:items-center justify-center bg-black/35 p-0 sm:p-4">
      <div className="bg-white dark:bg-gray-950 border-0 sm:border border-gray-200 dark:border-gray-800 rounded-none sm:rounded-2xl shadow-2xl w-full sm:max-w-5xl h-full sm:h-[min(92vh,880px)] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between gap-3 shrink-0 px-5 sm:px-6 pt-5 pb-3 border-b border-gray-200 dark:border-gray-800">
          <div>
            <h2 className="text-base font-semibold text-gray-900 dark:text-gray-50">Settings</h2>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              Providers, defaults, and agent power — keys stay in macOS Keychain
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-sm text-gray-500 hover:text-gray-900 dark:hover:text-gray-100 px-2 py-1"
            aria-label="Close settings"
          >
            Close
          </button>
        </div>

        <div className="flex flex-1 min-h-0">
          <nav className="hidden sm:flex w-44 shrink-0 flex-col gap-1 border-r border-gray-200 dark:border-gray-800 p-3 bg-gray-50/80 dark:bg-gray-900/50">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={
                  "text-left text-sm px-3 py-2 rounded-lg transition-colors " +
                  (tab === t.id
                    ? "bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-50 shadow-sm font-medium"
                    : "text-gray-600 dark:text-gray-400 hover:bg-white/70 dark:hover:bg-gray-800/60")
                }
              >
                {t.label}
              </button>
            ))}
          </nav>

          <div className="flex-1 min-h-0 flex flex-col">
            <div className="sm:hidden flex gap-1 px-4 pt-3 overflow-x-auto">
              {TABS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTab(t.id)}
                  className={
                    "text-xs px-3 py-1.5 rounded-full border whitespace-nowrap " +
                    (tab === t.id
                      ? "border-teal-600 bg-teal-50 text-teal-900 dark:bg-teal-950 dark:text-teal-100 dark:border-teal-500"
                      : "border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-300")
                  }
                >
                  {t.label}
                </button>
              ))}
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto px-5 sm:px-6 py-4 space-y-4">
              {tab === "providers" && (
                <>
                  <section className="space-y-2">
                    <h3 className="text-sm font-medium text-gray-800 dark:text-gray-100">
                      Preferred provider
                    </h3>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      Used when creating chats without an explicit model, and for Bedrock / Ollama
                      routing.
                    </p>
                    <select
                      value={provider}
                      onChange={(e) => setProvider(e.target.value)}
                      className="w-full sm:w-72 px-2 py-1.5 text-sm border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 dark:text-gray-100"
                    >
                      <option value="auto">auto (first available key)</option>
                      <option value="openai">OpenAI</option>
                      <option value="anthropic">Anthropic</option>
                      <option value="gemini">Gemini</option>
                      <option value="bedrock">AWS Bedrock</option>
                      <option value="ollama">Ollama</option>
                    </select>
                  </section>

                  <section className="space-y-2">
                    <h3 className="text-sm font-medium text-gray-800 dark:text-gray-100">
                      Base URL (optional)
                    </h3>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      Empty = native provider APIs. Set for Azure, Ollama, LiteLLM, or Bedrock Access
                      Gateway.
                    </p>
                    <input
                      value={baseUrl}
                      onChange={(e) => setBaseUrl(e.target.value)}
                      placeholder={
                        provider === "bedrock"
                          ? "empty = native IAM · or http://localhost:8000/api/v1"
                          : provider === "ollama"
                            ? "http://localhost:11434/v1"
                            : "empty = official API"
                      }
                      className="w-full px-2 py-1.5 text-sm font-mono border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 dark:text-gray-100"
                    />
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1">
                      <label className="text-xs text-gray-500 dark:text-gray-400">
                        Wire API
                        <select
                          value={wireApi}
                          onChange={(e) => setWireApi(e.target.value)}
                          className="mt-1 w-full px-2 py-1.5 text-sm border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 dark:text-gray-100"
                        >
                          <option value="auto">auto</option>
                          <option value="responses">Responses</option>
                          <option value="chat_completions">Chat Completions</option>
                        </select>
                      </label>
                      <label className="text-xs text-gray-500 dark:text-gray-400">
                        Effort (GPT-5 / o-series)
                        <select
                          value={reasoningEffort}
                          onChange={(e) => setReasoningEffort(e.target.value)}
                          className="mt-1 w-full px-2 py-1.5 text-sm border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 dark:text-gray-100"
                        >
                          <option value="none">None</option>
                          <option value="low">Light</option>
                          <option value="medium">Medium</option>
                          <option value="high">High</option>
                          <option value="xhigh">Extra High</option>
                        </select>
                      </label>
                      <label className="flex items-end gap-2 text-xs text-gray-600 dark:text-gray-300 pb-1.5">
                        <input
                          type="checkbox"
                          checked={sslVerify}
                          onChange={(e) => setSslVerify(e.target.checked)}
                        />
                        Verify TLS
                      </label>
                    </div>
                  </section>

                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 pt-1">
                    {KEY_PROVIDERS.map((p) => (
                      <ProviderCard key={p.id} {...p} />
                    ))}
                  </div>

                  <div className="rounded-xl border border-dashed border-gray-300 dark:border-gray-700 p-4">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <h4 className="text-sm font-semibold text-gray-800 dark:text-gray-100">
                          Ollama (local)
                        </h4>
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                          No API key. Sets preferred provider to Ollama and Base URL to localhost.
                        </p>
                      </div>
                      <button
                        type="button"
                        className="text-xs px-2 py-1 rounded-lg border border-gray-300 dark:border-gray-600"
                        onClick={() => {
                          setProvider("ollama");
                          setBaseUrl("http://localhost:11434/v1");
                          setDefaultModel(defaultModel || "llama3.1");
                        }}
                      >
                        Use Ollama
                      </button>
                    </div>
                  </div>
                </>
              )}

              {tab === "defaults" && (
                <>
                  <section className="space-y-2">
                    <h3 className="text-sm font-medium text-gray-800 dark:text-gray-100">
                      Default model for new chats
                    </h3>
                    <select
                      value={defaultModel}
                      onChange={(e) => setDefaultModel(e.target.value)}
                      className="w-full px-2 py-1.5 text-sm border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 dark:text-gray-100"
                    >
                      <option value="">(auto)</option>
                      {availableModels.map((m) => (
                        <option key={`${m.provider}:${m.id}`} value={m.id}>
                          {m.label} · {m.provider}
                        </option>
                      ))}
                      {defaultModel && !availableModels.some((m) => m.id === defaultModel) && (
                        <option value={defaultModel}>{defaultModel}</option>
                      )}
                    </select>
                  </section>
                  <section className="space-y-2 pt-2">
                    <h3 className="text-sm font-medium text-gray-800 dark:text-gray-100">
                      Default mode
                    </h3>
                    <select
                      value={defaultMode}
                      onChange={(e) => setDefaultMode(e.target.value)}
                      className="w-full px-2 py-1.5 text-sm border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 dark:text-gray-100"
                    >
                      <option value="read_only">Read-only</option>
                      <option value="ask">Ask</option>
                      <option value="auto">Auto (recommended)</option>
                      <option value="full_access">Full access</option>
                    </select>
                  </section>
                  <section className="space-y-2 pt-2">
                    <h3 className="text-sm font-medium text-gray-800 dark:text-gray-100">
                      Workspace system prompt
                    </h3>
                    <textarea
                      value={workspacePrompt}
                      onChange={(e) => setWorkspacePrompt(e.target.value)}
                      rows={5}
                      placeholder="You are an experienced engineer. Bias toward small, reversible diffs."
                      className="w-full px-2 py-1.5 text-sm font-mono border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 dark:text-gray-100"
                    />
                  </section>
                </>
              )}

              {tab === "agent" && (
                <section className="space-y-3">
                  <h3 className="text-sm font-medium text-gray-800 dark:text-gray-100">Agent power</h3>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    Same opt-in surfaces as the VS Code plugin. Defaults stay safe.
                  </p>
                  <label className="text-xs text-gray-500 dark:text-gray-400">
                    Security scope
                    <select
                      value={securityScope}
                      onChange={(e) => setSecurityScope(e.target.value)}
                      className="mt-1 w-full px-2 py-1.5 text-sm border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 dark:text-gray-100"
                    >
                      <option value="projectless">Projectless chats</option>
                      {projects.filter((project) => project.kind !== "ssh").map((project) => (
                        <option key={project.id} value={project.id}>{project.name}</option>
                      ))}
                    </select>
                  </label>
                  {(
                    [
                      [mcpEnabled, setMcpEnabled, "Enable MCP servers (~/.clawagents/mcp.json)"],
                      [mcpTrust, setMcpTrust, "Trust workspace .clawagents/mcp.json"],
                      [contextMode, setContextMode, "Context Mode tools"],
                      [browserTools, setBrowserTools, "Browser tools (Playwright)"],
                      [trajectory, setTrajectory, "Trajectory logging"],
                      [learn, setLearn, "Learn from trajectories"],
                      [allowFullAccess, setAllowFullAccess, "Allow Full Access mode"],
                      [allowExternalSkillDirs, setAllowExternalSkillDirs, "Allow registered external skill folders"],
                      [skillUserHomes, setSkillUserHomes, "Load personal skill homes (~/.codex, ~/.claude, ~/.agents)"],
                    ] as const
                  ).map(([checked, setChecked, label], i) => (
                    <label
                      key={i}
                      className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => setChecked(e.target.checked)}
                      />
                      {label}
                    </label>
                  ))}
                  <div className="grid grid-cols-2 gap-2 pt-1">
                    <label className="text-xs text-gray-500 dark:text-gray-400">
                      Action mode
                      <select
                        value={actionMode}
                        onChange={(e) => setActionMode(e.target.value)}
                        className="mt-1 w-full px-2 py-1.5 text-sm border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 dark:text-gray-100"
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
                        placeholder="ask / architect / code"
                        className="mt-1 w-full px-2 py-1.5 text-sm border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 dark:text-gray-100"
                      />
                    </label>
                  </div>
                </section>
              )}

              {tab === "data" && (
                <>
                  <BackupPanel />
                  <section className="space-y-2 pt-4 border-t border-gray-200 dark:border-gray-800">
                    <h3 className="text-sm font-medium text-gray-800 dark:text-gray-100">
                      Housekeeping
                    </h3>
                    <button
                      type="button"
                      onClick={() => {
                        const n = clearAllDrafts();
                        pushToast(`Cleared ${n} draft${n === 1 ? "" : "s"}.`, "success");
                      }}
                      className="px-3 py-1.5 text-xs border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200"
                    >
                      Clear all composer drafts
                    </button>
                    {loaded && (
                      <p className="text-[11px] text-gray-400">
                        Settings file loaded · provider={loaded.provider || "auto"}
                      </p>
                    )}
                  </section>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 shrink-0 px-5 sm:px-6 py-3 border-t border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-900 dark:text-gray-400"
            disabled={saving}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void save()}
            className="px-4 py-1.5 text-sm bg-teal-700 hover:bg-teal-800 text-white rounded-lg dark:bg-teal-600 dark:hover:bg-teal-500 disabled:opacity-50"
            disabled={saving}
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
