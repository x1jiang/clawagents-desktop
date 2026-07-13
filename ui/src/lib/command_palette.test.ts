import { describe, expect, test } from "vitest";
import {
  filterPaletteActions,
  groupPaletteActions,
  recentChatLabel,
  type CommandPaletteAction,
} from "./command_palette";

const actions: CommandPaletteAction[] = [
  { group: "Navigate", label: "Go to Usage stats", run: () => {} },
  { group: "Navigate", label: "Go to Settings", run: () => {} },
  { group: "Help", label: "Show keyboard shortcuts", run: () => {} },
  { group: "Model", label: "Switch model: gpt-5.4", disabledReason: "Open a chat first", run: () => {} },
];

describe("command palette helpers", () => {
  test("fuzzy filter matches non-contiguous text and ranks direct matches first", () => {
    const result = filterPaletteActions(actions, "uset");

    expect(result.map((a) => a.label)).toEqual(["Go to Usage stats"]);
  });

  test("filter includes disabled actions so users can discover unavailable commands", () => {
    const result = filterPaletteActions(actions, "gpt");

    expect(result).toHaveLength(1);
    expect(result[0].disabledReason).toBe("Open a chat first");
  });

  test("groups actions with section order preserved", () => {
    const groups = groupPaletteActions(actions);

    expect(groups.map((g) => g.group)).toEqual(["Navigate", "Help", "Model"]);
    expect(groups[0].actions.map((a) => a.label)).toEqual([
      "Go to Usage stats",
      "Go to Settings",
    ]);
  });

  test("recent chat labels prefer titles over raw ids", () => {
    const label = recentChatLabel("c2", [
      { id: "c1", title: "Older chat" },
      { id: "c2", title: "Refactor gateway tests" },
    ]);

    expect(label).toBe("Open chat: Refactor gateway tests");
  });
});

