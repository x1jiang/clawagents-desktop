import { useCallback, useEffect, useState } from "react";
import { useProjects } from "../stores/projects";

interface Props {
  projectId: string;
}

/**
 * Inline editor for `.clawagents/pinned-context.md`.
 *
 * Unlike the project system prompt (sent once, then it lives in history), this
 * text is re-injected with the rules block on *every* LLM round. That makes it
 * the right home for short situational facts the agent keeps forgetting — which
 * interpreter to use, what is off-limits this week — and the wrong home for
 * anything long. The server enforces the cap; this shows the budget so the
 * limit is visible before it bites.
 */
export function PinnedContextPanel({ projectId }: Props) {
  const client = useProjects((s) => s.client);
  const [saved, setSaved] = useState("");
  const [draft, setDraft] = useState("");
  const [maxChars, setMaxChars] = useState(4000);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!client) return;
    setLoading(true);
    try {
      const res = await client.getPinnedContext(projectId);
      setSaved(res.text);
      setDraft(res.text);
      setMaxChars(res.max_chars);
      setStatus(null);
    } catch (e) {
      setStatus(`Load failed: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, [client, projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  const dirty = draft !== saved;
  const over = draft.trim().length > maxChars;

  async function save() {
    if (!client) return;
    setBusy(true);
    setStatus(null);
    try {
      // Adopt the server's version, not the draft: it truncates past the cap,
      // and showing the untruncated draft as "Saved" would be a lie.
      const res = await client.setPinnedContext(projectId, draft);
      setSaved(res.text);
      setDraft(res.text);
      setStatus(res.truncated ? `Saved (truncated to ${res.max_chars} chars).` : "Saved.");
      setTimeout(() => setStatus(null), 2000);
    } catch (e) {
      setStatus(`Save failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-6">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200">Pinned context</h2>
        {status && <span className="text-xs text-gray-400">{status}</span>}
      </div>
      <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
        Always-on instructions injected with the rules block on every model call, so keep it short.
        Stored as{" "}<code className="font-mono">.clawagents/pinned-context.md</code>{" "}
        — editable outside the app and shared with every ClawAgents front end.
      </p>
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        disabled={loading}
        rows={4}
        placeholder="Use .venv312 for every python call. Staging DB is read-only this week."
        className="w-full px-2 py-1 text-sm font-mono border border-gray-300 dark:border-gray-700 rounded bg-white dark:bg-gray-900 dark:text-gray-100 disabled:opacity-50"
      />
      <div className="mt-2 flex items-center gap-2">
        <button
          onClick={save}
          disabled={!dirty || busy || loading}
          className="px-3 py-1 text-sm bg-gray-900 text-white rounded hover:bg-gray-700 disabled:opacity-50 dark:bg-gray-100 dark:text-gray-900"
        >
          Save
        </button>
        {dirty && (
          <button
            onClick={() => setDraft(saved)}
            disabled={busy}
            className="px-3 py-1 text-sm text-gray-500 hover:text-gray-800 dark:text-gray-300"
          >
            Reset
          </button>
        )}
        <span
          className={`ml-auto text-xs ${over ? "text-amber-600 dark:text-amber-400" : "text-gray-400"}`}
        >
          {draft.trim().length} / {maxChars}
          {over && " — will be truncated"}
        </span>
      </div>
    </div>
  );
}
