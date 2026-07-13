import { useEffect, useState } from "react";
import { createRoute } from "@tanstack/react-router";
import { Route as RootRoute } from "./__root";
import { useProjects } from "../stores/projects";
import { useCustomCommands } from "../stores/custom_commands";

interface Command {
  name: string;
  description: string;
  body: string;
}

const NAME_RE = /^[a-z][a-z0-9_-]{0,40}$/;

export const Route = createRoute({
  getParentRoute: () => RootRoute,
  path: "/commands",
  component: function CommandsPage() {
    const client = useProjects((s) => s.client);
    const [commands, setCommands] = useState<Command[]>([]);
    const [selected, setSelected] = useState<string | null>(null);
    const [draft, setDraft] = useState<Command>({ name: "", description: "", body: "" });
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

    async function reload() {
      if (!client) return;
      try {
        const list = await client.listCustomCommands();
        setCommands(list);
        // Refresh global store so the Composer picker is in sync.
        await useCustomCommands.getState().load(() => client.listCustomCommands());
      } catch (e) {
        setError((e as Error).message);
      }
    }
    useEffect(() => { reload(); }, [client]);

    function startNew() {
      setSelected(null);
      setDraft({ name: "", description: "", body: "" });
      setError(null);
    }

    function startEdit(c: Command) {
      setSelected(c.name);
      setDraft({ ...c });
      setError(null);
    }

    async function save() {
      if (!client) return;
      const name = draft.name.trim();
      if (!NAME_RE.test(name)) {
        setError("Name must be lowercase letters, digits, hyphens or underscores (1-41 chars, starts with a letter).");
        return;
      }
      if (!draft.body.trim()) {
        setError("Body cannot be empty.");
        return;
      }
      setBusy(true);
      try {
        await client.upsertCustomCommand(name, { description: draft.description, body: draft.body });
        setSelected(name);
        setError(null);
        await reload();
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(false);
      }
    }

    async function remove() {
      if (!client || !selected) return;
      if (!window.confirm(`Delete /${selected}? This cannot be undone.`)) return;
      setBusy(true);
      try {
        await client.deleteCustomCommand(selected);
        startNew();
        await reload();
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(false);
      }
    }

    return (
      <div className="p-6 max-w-4xl">
        <div className="flex items-center justify-between mb-2">
          <h1 className="text-lg font-semibold text-gray-800 dark:text-gray-100">Custom slash commands</h1>
          <button
            onClick={async () => {
              if (!client) return;
              try { await client.revealWellKnown("commands"); }
              catch (e) {
                // Finder either opens or it doesn't; log without scaring the user.
                console.warn("reveal failed:", (e as Error).message);
              }
            }}
            className="text-xs text-blue-600 dark:text-blue-300 hover:underline"
          >
            Open folder ↗
          </button>
        </div>
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
          Each command appears as <span className="font-mono">/&lt;name&gt;</span> in the composer's autocomplete.
          When invoked, its body is sent to the agent as a user message.
        </p>
        <div className="flex gap-4">
          <aside className="w-56 shrink-0">
            <button
              onClick={startNew}
              className="w-full mb-2 px-2 py-1 text-xs bg-gray-900 text-white rounded hover:bg-gray-700 dark:bg-gray-100 dark:text-gray-900"
            >
              + New command
            </button>
            <ul className="space-y-1">
              {commands.map((c) => (
                <li key={c.name}>
                  <button
                    onClick={() => startEdit(c)}
                    className={
                      "w-full text-left px-2 py-1 text-xs rounded font-mono truncate " +
                      (selected === c.name
                        ? "bg-gray-200 dark:bg-gray-700"
                        : "hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300")
                    }
                  >
                    /{c.name}
                  </button>
                </li>
              ))}
              {commands.length === 0 && (
                <li className="text-xs text-gray-400 px-2">No commands yet.</li>
              )}
            </ul>
          </aside>
          <section className="flex-1">
            {error && <p className="text-xs text-red-600 mb-2">{error}</p>}
            <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Name</label>
            <input
              type="text"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              disabled={selected !== null}
              placeholder="review-pr"
              className="w-full mb-3 px-2 py-1 text-sm font-mono border border-gray-300 dark:border-gray-700 rounded bg-white dark:bg-gray-900 dark:text-gray-100 disabled:opacity-60"
            />
            <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Description (optional)</label>
            <input
              type="text"
              value={draft.description}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              placeholder="Review the changes in src/"
              className="w-full mb-3 px-2 py-1 text-sm border border-gray-300 dark:border-gray-700 rounded bg-white dark:bg-gray-900 dark:text-gray-100"
            />
            <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Body — sent verbatim to the agent</label>
            <textarea
              value={draft.body}
              onChange={(e) => setDraft({ ...draft, body: e.target.value })}
              rows={10}
              className="w-full mb-3 px-2 py-1 text-sm font-mono border border-gray-300 dark:border-gray-700 rounded bg-white dark:bg-gray-900 dark:text-gray-100"
            />
            <div className="flex gap-2">
              <button
                onClick={save}
                disabled={busy}
                className="px-3 py-1 text-sm bg-gray-900 text-white rounded hover:bg-gray-700 disabled:opacity-50 dark:bg-gray-100 dark:text-gray-900"
              >
                {selected ? "Save" : "Create"}
              </button>
              {selected && (
                <button
                  onClick={remove}
                  disabled={busy}
                  className="px-3 py-1 text-sm text-red-600 hover:text-red-800 disabled:opacity-50"
                >
                  Delete
                </button>
              )}
              <button
                onClick={startNew}
                className="px-3 py-1 text-sm text-gray-500 hover:text-gray-800 dark:text-gray-300"
              >
                Cancel
              </button>
            </div>
          </section>
        </div>
      </div>
    );
  },
});
