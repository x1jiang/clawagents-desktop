import { describe, expect, test } from "vitest";
import { looksLikePath, extractPath } from "./looks_like_path";

describe("looksLikePath", () => {
  test("typical source files", () => {
    expect(looksLikePath("src/foo.ts")).toBe(true);
    expect(looksLikePath("backend/src/clawagents/agent.py")).toBe(true);
    expect(looksLikePath("docs/README.md")).toBe(true);
    expect(looksLikePath(".agents/skills/docx/SKILL.md")).toBe(true);
  });

  test("path with trailing line number still counts as path", () => {
    expect(looksLikePath("src/foo.ts:42")).toBe(true);
    expect(looksLikePath("src/foo.ts:42:17")).toBe(true);
  });

  test("rejects domain-like strings", () => {
    expect(looksLikePath("example.com")).toBe(false);
    expect(looksLikePath("foo.bar")).toBe(false);
    expect(looksLikePath("v1.2.3")).toBe(false);
  });

  test("rejects URLs", () => {
    expect(looksLikePath("https://example.com/foo.ts")).toBe(false);
    expect(looksLikePath("git+https://example.com/repo.git")).toBe(false);
  });

  test("rejects absolute paths (system roots)", () => {
    expect(looksLikePath("/etc/passwd")).toBe(false);
    expect(looksLikePath("/Users/me/x.ts")).toBe(false);
  });

  test("rejects bare filenames without a slash", () => {
    // Treating bare "foo.ts" as a path produces too many false positives in
    // prose ("install foo.ts via npm…") so we require a slash.
    expect(looksLikePath("foo.ts")).toBe(false);
  });

  test("rejects whitespace, empty, no extension", () => {
    expect(looksLikePath("")).toBe(false);
    expect(looksLikePath("src/dir")).toBe(false);
    expect(looksLikePath("foo bar/baz.ts")).toBe(false);
  });
});

describe("extractPath", () => {
  test("strips a single :LINE suffix", () => {
    expect(extractPath("src/foo.ts:42")).toBe("src/foo.ts");
  });

  test("strips :LINE:COL suffix", () => {
    expect(extractPath("src/foo.ts:42:17")).toBe("src/foo.ts");
  });

  test("leaves bare paths alone", () => {
    expect(extractPath("src/foo.ts")).toBe("src/foo.ts");
  });

  test("doesn't strip non-numeric suffixes", () => {
    expect(extractPath("src/foo.ts:label")).toBe("src/foo.ts:label");
  });
});
