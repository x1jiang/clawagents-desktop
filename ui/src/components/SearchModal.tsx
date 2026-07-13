import { useEffect, useState } from "react";
import { useRouter } from "@tanstack/react-router";
import { useUI } from "../stores/ui";
import { useProjects } from "../stores/projects";
import { HighlightedText } from "./HighlightedText";

interface Hit {
  chat_id: string;
  project_id: string | null;
  title: string;
  role: string;
  snippet: string;
}

// Last N successful queries, persisted to localStorage so the user can reuse
// them across sessions. Keep this small — the value is convenience, not history.
const RECENT_KEY = "clawagents:recentSearches";
const RECENT_MAX = 6;

function loadRecent(): string[] {
  try {
    const raw = window.localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.filter((x) => typeof x === "string");
  } catch { /* ignore */ }
  return [];
}

function saveRecent(items: string[]): void {
  try { window.localStorage.setItem(RECENT_KEY, JSON.stringify(items)); }
  catch { /* ignore */ }
}

export function SearchModal() {
  const open = useUI((s) => s.searchModalOpen);
  const close = useUI((s) => s.closeSearchModal);
  const client = useProjects((s) => s.client);
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [active, setActive] = useState(0);
  const [busy, setBusy] = useState(false);
  const [recent, setRecent] = useState<string[]>(loadRecent);

  // Reset when reopened.
  useEffect(() => {
    if (open) {
      setQuery("");
      setHits([]);
      setActive(0);
      setRecent(loadRecent());
    }
  }, [open]);

  // Debounced search: 200ms after typing stops. We deliberately keep `recent`
  // out of the dependency list — it's only read inside the timeout's success
  // branch as the latest snapshot, and including it would loop (recent change
  // → effect re-runs → query stays → search runs again).
  useEffect(() => {
    if (!open || !client) return;
    const q = query.trim();
    if (!q) { setHits([]); return; }
    let cancelled = false;
    const id = setTimeout(async () => {
      setBusy(true);
      try {
        const results = await client.searchChats(q);
        if (!cancelled) {
          setHits(results);
          setActive(0);
          // Only record the query if it actually found something.
          if (results.length > 0) {
            setRecent((prev) => {
              const next = [q, ...prev.filter((r) => r !== q)].slice(0, RECENT_MAX);
              saveRecent(next);
              return next;
            });
          }
        }
      } catch {
        if (!cancelled) setHits([]);
      } finally {
        if (!cancelled) setBusy(false);
      }
    }, 200);
    return () => { cancelled = true; clearTimeout(id); };
  }, [query, open, client]);

  function openHit(h: Hit) {
    close();
    if (h.project_id) {
      router.navigate({ to: "/project/$id/chat/$cid", params: { id: h.project_id, cid: h.chat_id } });
    } else {
      router.navigate({ to: "/chat/$cid", params: { cid: h.chat_id } });
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black/40 flex items-start justify-center z-50 pt-24" onClick={close}>
      <div
        className="bg-white dark:bg-gray-900 rounded-lg shadow-lg w-[32rem] max-h-[70vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          autoFocus
          type="text"
          placeholder="Search all chats…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") { e.preventDefault(); close(); return; }
            if (hits.length === 0) return;
            if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => (a + 1) % hits.length); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => (a - 1 + hits.length) % hits.length); }
            else if (e.key === "Enter") { e.preventDefault(); openHit(hits[active]); }
          }}
          className="w-full px-4 py-3 text-sm bg-transparent border-b border-gray-200 dark:border-gray-700 dark:text-gray-100 outline-none"
        />
        <div className="overflow-y-auto flex-1">
          {!query ? (
            recent.length === 0 ? (
              <p className="px-4 py-6 text-xs text-gray-400">Type to search across all chats.</p>
            ) : (
              <div className="px-4 py-3">
                <div className="text-[10px] uppercase tracking-wide text-gray-400 mb-2">Recent searches</div>
                <div className="flex flex-wrap gap-1.5">
                  {recent.map((r) => (
                    <button
                      key={r}
                      onClick={() => setQuery(r)}
                      className="text-xs px-2 py-0.5 rounded border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
                    >
                      {r}
                    </button>
                  ))}
                </div>
              </div>
            )
          ) : busy ? (
            <p className="px-4 py-6 text-xs text-gray-400">Searching…</p>
          ) : hits.length === 0 ? (
            <p className="px-4 py-6 text-xs text-gray-400">No matches.</p>
          ) : (
            hits.map((h, i) => (
              <button
                key={`${h.chat_id}|${i}`}
                onMouseEnter={() => setActive(i)}
                onClick={() => openHit(h)}
                className={
                  "block w-full text-left px-4 py-2 text-xs border-b border-gray-100 dark:border-gray-800 " +
                  (i === active
                    ? "bg-blue-50 dark:bg-blue-900/40"
                    : "hover:bg-gray-50 dark:hover:bg-gray-800")
                }
              >
                <div className="flex items-center justify-between mb-0.5">
                  <span className="font-semibold text-gray-800 dark:text-gray-100 truncate">{h.title}</span>
                  <span className="text-[10px] text-gray-400 ml-2 shrink-0">{h.role}</span>
                </div>
                <div className="text-gray-600 dark:text-gray-300 truncate font-mono">
                  <HighlightedText text={h.snippet} query={query} />
                </div>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
