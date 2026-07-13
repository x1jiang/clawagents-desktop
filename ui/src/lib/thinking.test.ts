import { describe, expect, test } from "vitest";
import { splitThinking } from "./thinking";

describe("splitThinking", () => {
  test("extracts complete think blocks", () => {
    expect(splitThinking("<think>a</think>hello")).toEqual({
      content: "hello",
      thinking: "a",
    });
  });

  test("hides incomplete open think while streaming", () => {
    expect(splitThinking("<think>partial")).toEqual({
      content: "",
      thinking: undefined,
    });
  });
});
