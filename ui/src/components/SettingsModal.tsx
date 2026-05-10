import { useState } from "react";
import { useSettings } from "../stores/settings";

interface Props {
  onClose: () => void;
}

const PROVIDERS = [
  { id: "openai", name: "OpenAI" },
  { id: "anthropic", name: "Anthropic" },
  { id: "gemini", name: "Google Gemini" },
];

export function SettingsModal({ onClose }: Props) {
  const apiKeys = useSettings((s) => s.apiKeys);
  const setApiKey = useSettings((s) => s.setApiKey);
  const [drafts, setDrafts] = useState<Record<string, string>>(() =>
    Object.fromEntries(PROVIDERS.map((p) => [p.id, apiKeys[p.id] ?? ""])),
  );
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      for (const p of PROVIDERS) {
        if (drafts[p.id] !== (apiKeys[p.id] ?? "")) {
          await setApiKey(p.id, drafts[p.id]);
        }
      }
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl p-6 w-[480px] space-y-4">
        <h2 className="text-base font-semibold text-gray-800">Settings</h2>

        <section className="space-y-3">
          <h3 className="text-sm font-medium text-gray-700">API Keys (stored in macOS Keychain)</h3>
          {PROVIDERS.map((p) => (
            <label key={p.id} className="block text-sm">
              <span className="text-gray-600">{p.name}</span>
              <input
                type="password"
                className="mt-1 w-full border border-gray-300 rounded px-2 py-1 text-sm font-mono"
                value={drafts[p.id] ?? ""}
                onChange={(e) => setDrafts({ ...drafts, [p.id]: e.target.value })}
                placeholder={apiKeys[p.id] ? "(saved)" : "(unset)"}
              />
            </label>
          ))}
        </section>

        <div className="flex justify-end gap-2 pt-2 border-t border-gray-200">
          <button onClick={onClose} className="px-3 py-1 text-sm text-gray-600 hover:text-gray-800" disabled={saving}>
            Cancel
          </button>
          <button onClick={save} className="px-3 py-1 text-sm bg-gray-900 text-white rounded hover:bg-gray-700" disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
