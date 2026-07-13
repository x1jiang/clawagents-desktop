import { useEffect, useState } from "react";
import { useProjects } from "../stores/projects";

interface Props {
  value: string;
  onChange: (model: string) => void;
}

interface ProviderRow {
  id: string;
  name: string;
  available: boolean;
  models: Array<{ id: string; label: string; available: boolean }>;
}

export function ModelPicker({ value, onChange }: Props) {
  const client = useProjects((s) => s.client);
  const [providers, setProviders] = useState<ProviderRow[]>([]);
  const [defaultModel, setDefaultModel] = useState<string>("");

  useEffect(() => {
    if (!client) return;
    client.listProviders().then(setProviders);
    // The workspace default — surfaced in the (default) option label so
    // users know what "default" actually picks. Best-effort.
    client.getAppSettings()
      .then((s) => setDefaultModel(s.default_model || ""))
      .catch(() => { /* ignore */ });
  }, [client]);

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
