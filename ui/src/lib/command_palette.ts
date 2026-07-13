export interface CommandPaletteAction {
  label: string;
  hint?: string;
  group: string;
  disabledReason?: string;
  keywords?: string[];
  run: () => void | Promise<void>;
}

export interface CommandPaletteGroup {
  group: string;
  actions: CommandPaletteAction[];
}

interface RecentChatTitle {
  id: string;
  title: string;
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function fuzzyScore(query: string, haystack: string): number | null {
  const q = normalize(query).replace(/\s+/g, "");
  const h = normalize(haystack);
  if (!q) return 0;
  if (h.includes(q)) return 100 - h.indexOf(q);

  let qi = 0;
  let gaps = 0;
  for (let hi = 0; hi < h.length && qi < q.length; hi += 1) {
    if (h[hi] === q[qi]) {
      qi += 1;
    } else if (h[hi] !== " ") {
      gaps += 1;
    }
  }
  if (qi !== q.length) return null;
  return Math.max(1, 60 - gaps);
}

function actionHaystack(action: CommandPaletteAction): string {
  return [action.group, action.label, action.hint, ...(action.keywords ?? [])]
    .filter(Boolean)
    .join(" ");
}

export function filterPaletteActions(
  actions: CommandPaletteAction[],
  query: string,
): CommandPaletteAction[] {
  if (!query.trim()) return actions;
  return actions
    .map((action, index) => ({
      action,
      index,
      score: fuzzyScore(query, actionHaystack(action)),
    }))
    .filter((entry): entry is { action: CommandPaletteAction; index: number; score: number } => entry.score !== null)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.action);
}

export function groupPaletteActions(actions: CommandPaletteAction[]): CommandPaletteGroup[] {
  const groups: CommandPaletteGroup[] = [];
  const byName = new Map<string, CommandPaletteGroup>();
  for (const action of actions) {
    let group = byName.get(action.group);
    if (!group) {
      group = { group: action.group, actions: [] };
      byName.set(action.group, group);
      groups.push(group);
    }
    group.actions.push(action);
  }
  return groups;
}

export function recentChatLabel(id: string, chats: RecentChatTitle[]): string {
  const title = chats.find((chat) => chat.id === id)?.title.trim();
  return `Open chat: ${title || id}`;
}

