import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import type { GatewayDiagnostics, ProviderCatalogEntry } from "../lib/gateway";
import { buildSetupReadiness, type SetupReadinessItem } from "../lib/setup_readiness";
import { useProjects } from "../stores/projects";
import { useSettings } from "../stores/settings";
import { NewProjectModal } from "./NewProjectModal";

const STATUS_CLASS: Record<SetupReadinessItem["status"], string> = {
  ready: "bg-emerald-500",
  "needs-action": "bg-red-500",
  warning: "bg-amber-500",
};

export function SetupReadinessPanel() {
  const client = useProjects((s) => s.client);
  const apiKeys = useSettings((s) => s.apiKeys);
  const [diagnostics, setDiagnostics] = useState<GatewayDiagnostics | null>(null);
  const [providers, setProviders] = useState<ProviderCatalogEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showNewProject, setShowNewProject] = useState(false);

  useEffect(() => {
    if (!client) return;
    let cancelled = false;
    void (async () => {
      try {
        const [nextDiagnostics, nextProviders] = await Promise.all([
          client.diagnostics(),
          client.listProviders(),
        ]);
        if (cancelled) return;
        setDiagnostics(nextDiagnostics);
        setProviders(nextProviders);
        setError(null);
      } catch (e) {
        if (!cancelled) {
          const msg = (e as Error).message || String(e);
          setError(
            msg.includes("404")
              ? "Load failed — gateway is missing desktop APIs (restart the app / reinstall 0.2.2+)."
              : msg,
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client]);

  const items = diagnostics ? buildSetupReadiness(diagnostics, providers, apiKeys) : [];

  return (
    <section className="w-full max-w-2xl border border-gray-200 dark:border-gray-800 rounded-lg bg-white dark:bg-gray-950 p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100">Readiness</h3>
        <div className="flex items-center gap-2">
          <Link
            to="/settings"
            className="px-2 py-1 text-xs border border-gray-300 dark:border-gray-700 rounded text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800"
          >
            Settings
          </Link>
          <button
            onClick={() => setShowNewProject(true)}
            className="px-2 py-1 text-xs border border-gray-300 dark:border-gray-700 rounded text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800"
          >
            New project
          </button>
        </div>
      </div>
      {error && <p className="text-xs text-red-600 dark:text-red-300">{error}</p>}
      {!diagnostics && !error && <p className="text-xs text-gray-500 dark:text-gray-400">Checking gateway...</p>}
      <div className="space-y-2">
        {items.map((item) => (
          <div key={item.id} className="flex items-start gap-2 text-sm">
            <span className={`mt-1.5 h-2 w-2 rounded-full ${STATUS_CLASS[item.status]}`} />
            <div>
              <p className="font-medium text-gray-800 dark:text-gray-100">{item.label}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400">{item.detail}</p>
            </div>
          </div>
        ))}
      </div>
      {showNewProject && <NewProjectModal onClose={() => setShowNewProject(false)} />}
    </section>
  );
}
