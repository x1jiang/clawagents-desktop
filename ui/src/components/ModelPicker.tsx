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

  useEffect(() => {
    if (!client) return;
    client.listProviders().then(setProviders);
  }, [client]);

  return (
    <select
      className="text-xs border border-gray-300 rounded-md px-2 py-1 bg-white"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {value === "" && <option value="">(default)</option>}
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
