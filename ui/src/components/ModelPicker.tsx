import { useEffect, useState } from "react";
import { useProjectGateway } from "../lib/project_client";

interface Props {
  value: string;
  onChange: (model: string) => void;
  // Which project's provider catalog / settings to read. undefined/null =
  // the projectless (global) scope. Without this, every caller read the
  // LOCAL machine's catalog even for an SSH-connected project with its own
  // independently-configured remote gateway — models actually usable on the
  // remote showed disabled (or vice versa), so a selection could fail at
  // send time with a provider error.
  projectId?: string | null;
}

interface ProviderRow {
  id: string;
  name: string;
  available: boolean;
  models: Array<{ id: string; label: string; available: boolean }>;
}

export function ModelPicker({ value, onChange, projectId }: Props) {
  const client = useProjectGateway(projectId);
  const [providers, setProviders] = useState<ProviderRow[]>([]);
  const [defaultModel, setDefaultModel] = useState<string>("");

  useEffect(() => {
    if (!client) return;
    client.listProviders(projectId ?? null, projectId == null).then(setProviders);
    // The workspace default — surfaced in the (default) option label so
    // users know what "default" actually picks. Best-effort.
    client.getAppSettings(projectId ?? null, projectId == null)
      .then((s) => setDefaultModel(s.default_model || ""))
      .catch(() => { /* ignore */ });
  }, [client, projectId]);

  return (
    <select
      className="text-xs border border-gray-300 dark:border-gray-700 rounded-md px-2 py-1 bg-white dark:bg-gray-800 dark:text-gray-100"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      title={value === "" && defaultModel ? `Auto → ${defaultModel}` : undefined}
    >
      {value === "" && (
        <option value="">
          {defaultModel ? `Auto (→ ${defaultModel})` : "Auto (pick a model)"}
        </option>
      )}
      {providers.map((p) => (
        <optgroup key={p.id} label={p.name + (p.available ? "" : " (no key)")}>
          {p.models.map((m) => (
            <option key={m.id} value={m.id} disabled={!m.available}>
              {m.label}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}
