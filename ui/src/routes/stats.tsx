import { useEffect, useState } from "react";
import { createRoute } from "@tanstack/react-router";
import { Route as RootRoute } from "./__root";
import { useProjects } from "../stores/projects";
import { estimateCostUsd, formatCostUsd } from "../lib/pricing";
import type { ModelUsage } from "../lib/gateway";

interface Stats {
  overall: Record<string, ModelUsage>;
  projectless: Record<string, ModelUsage>;
  projects: Array<{ project_id: string; project_name: string; by_model: Record<string, ModelUsage> }>;
}

function formatTokens(n: number): string {
  if (n < 1000) return n.toString();
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

function totalCost(by_model: Record<string, ModelUsage>): number | null {
  let total = 0;
  let any = false;
  for (const [model, u] of Object.entries(by_model)) {
    const c = estimateCostUsd(model, {
      input_tokens: u.input_tokens,
      output_tokens: u.output_tokens,
      cached_input_tokens: u.cached_input_tokens,
    });
    if (c !== null) { total += c; any = true; }
  }
  return any ? total : null;
}

function totalTokens(by_model: Record<string, ModelUsage>): number {
  return Object.values(by_model).reduce((s, u) => s + u.total_tokens, 0);
}

function totalTurns(by_model: Record<string, ModelUsage>): number {
  return Object.values(by_model).reduce((s, u) => s + u.turns, 0);
}

function ModelRow({ model, usage }: { model: string; usage: ModelUsage }) {
  const cost = estimateCostUsd(model, {
    input_tokens: usage.input_tokens,
    output_tokens: usage.output_tokens,
    cached_input_tokens: usage.cached_input_tokens,
  });
  return (
    <tr className="border-b border-gray-100 dark:border-gray-800">
      <td className="px-2 py-1 font-mono">{model}</td>
      <td className="px-2 py-1 text-right">{formatTokens(usage.input_tokens)}</td>
      <td className="px-2 py-1 text-right">{formatTokens(usage.output_tokens)}</td>
      <td className="px-2 py-1 text-right">{formatTokens(usage.cached_input_tokens)}</td>
      <td className="px-2 py-1 text-right">{usage.turns}</td>
      <td className="px-2 py-1 text-right">{cost === null ? "—" : formatCostUsd(cost)}</td>
    </tr>
  );
}

function Section({ title, byModel }: { title: string; byModel: Record<string, ModelUsage> }) {
  const entries = Object.entries(byModel);
  if (entries.length === 0) {
    return (
      <section className="mb-6">
        <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-1">{title}</h2>
        <p className="text-xs text-gray-400">No usage recorded yet.</p>
      </section>
    );
  }
  const c = totalCost(byModel);
  const tok = totalTokens(byModel);
  const turns = totalTurns(byModel);
  return (
    <section className="mb-6">
      <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-1">
        {title}
        <span className="ml-2 text-xs text-gray-500 dark:text-gray-400">
          · {turns} turns · {formatTokens(tok)} tok{c !== null && ` · ${formatCostUsd(c)}`}
        </span>
      </h2>
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
            <th className="px-2 py-1 font-normal">Model</th>
            <th className="px-2 py-1 font-normal text-right">Input</th>
            <th className="px-2 py-1 font-normal text-right">Output</th>
            <th className="px-2 py-1 font-normal text-right">Cached</th>
            <th className="px-2 py-1 font-normal text-right">Turns</th>
            <th className="px-2 py-1 font-normal text-right">Est. cost</th>
          </tr>
        </thead>
        <tbody className="text-gray-700 dark:text-gray-200">
          {entries.map(([model, u]) => <ModelRow key={model} model={model} usage={u} />)}
        </tbody>
      </table>
    </section>
  );
}

export const Route = createRoute({
  getParentRoute: () => RootRoute,
  path: "/stats",
  component: function StatsPage() {
    const client = useProjects((s) => s.client);
    const [stats, setStats] = useState<Stats | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
      if (!client) return;
      (async () => {
        try { setStats(await client.usageStats()); }
        catch (e) { setError((e as Error).message); }
      })();
    }, [client]);

    if (error) return <div className="p-6 text-sm text-red-600">{error}</div>;
    if (!stats) return <div className="p-6 text-sm text-gray-500">Loading…</div>;

    return (
      <div className="p-6 max-w-3xl">
        <h1 className="text-lg font-semibold text-gray-800 dark:text-gray-100 mb-4">Usage statistics</h1>
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-6">
          Cost estimates use a snapshot of public per-token prices — treat as a ballpark, not an invoice.
        </p>

        <Section title="Overall" byModel={stats.overall} />
        <Section title="Projectless chats" byModel={stats.projectless} />

        {stats.projects.length > 0 && (
          <>
            <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-2">Per project</h2>
            {stats.projects.map((p) => (
              <Section key={p.project_id} title={p.project_name} byModel={p.by_model} />
            ))}
          </>
        )}
      </div>
    );
  },
});
