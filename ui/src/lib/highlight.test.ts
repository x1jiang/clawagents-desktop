import { describe, expect, test } from "vitest";
import { splitHighlight } from "./highlight";

describe("splitHighlight", () => {
  test("empty needle returns the whole text as a single non-match segment", () => {
    expect(splitHighlight("hello world", "")).toEqual([{ text: "hello world" }]);
    expect(splitHighlight("hello world", "   ")).toEqual([{ text: "hello world" }]);
  });

  test("no match returns a single non-match segment", () => {
    expect(splitHighlight("hello world", "xyz")).toEqual([{ text: "hello world" }]);
  });

  test("single case-insensitive match in the middle", () => {
    expect(splitHighlight("hello WORLD", "world")).toEqual([
      { text: "hello " },
      { text: "WORLD", match: true },
    ]);
  });

  test("match at start has no leading non-match segment", () => {
    expect(splitHighlight("Find me later", "find")).toEqual([
      { text: "Find", match: true },
      { text: " me later" },
    ]);
  });

  test("multiple matches", () => {
    const segs = splitHighlight("foo Foo FOO bar", "foo");
    expect(segs).toEqual([
      { text: "foo", match: true },
      { text: " " },
      { text: "Foo", match: true },
      { text: " " },
      { text: "FOO", match: true },
      { text: " bar" },
    ]);
  });

  test("preserves original casing of matched substring", () => {
    const segs = splitHighlight("XYZ", "xyz");
    expect(segs[0]).toEqual({ text: "XYZ", match: true });
  });

  test("does not match across boundaries when needle is longer than text", () => {
    expect(splitHighlight("hi", "hello world")).toEqual([{ text: "hi" }]);
  });

  test("empty text returns empty array", () => {
    expect(splitHighlight("", "x")).toEqual([]);
  });
});
