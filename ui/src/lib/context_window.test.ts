import { describe, test, expect } from "vitest";
import { contextWindowFor, compactHint, contextUsage } from "./context_window";

describe("contextWindowFor", () => {
  test("exact known model", () => {
    expect(contextWindowFor("gpt-4o-mini")).toBe(128_000);
  });

  test("prefix match", () => {
    expect(contextWindowFor("claude-opus-4-7-1m")).toBe(1_000_000);
  });

  test("unknown model returns null", () => {
    expect(contextWindowFor("totally-imaginary")).toBeNull();
    expect(contextWindowFor(null)).toBeNull();
  });
});

describe("compactHint", () => {
  test("below threshold returns null", () => {
    expect(compactHint("gpt-4o-mini", 50_000)).toBeNull();
  });

  test("at 75% returns hint", () => {
    const hint = compactHint("gpt-4o-mini", 96_000);
    expect(hint).not.toBeNull();
    expect(hint!.window).toBe(128_000);
    expect(hint!.ratio).toBeGreaterThanOrEqual(0.75);
  });

  test("unknown model returns null even at high usage", () => {
    expect(compactHint("imaginary-model", 5_000_000)).toBeNull();
  });
});

describe("contextWindowFor — current model catalog", () => {
  test("gpt-5.6 family resolves to 1.05M", () => {
    expect(contextWindowFor("gpt-5.6")).toBe(1_050_000);
    expect(contextWindowFor("gpt-5.6-sol")).toBe(1_050_000);
    expect(contextWindowFor("gpt-5.6-terra")).toBe(1_050_000);
    expect(contextWindowFor("gpt-5.6-luna")).toBe(1_050_000);
  });

  test("gpt-5.5 family resolves to 400k", () => {
    expect(contextWindowFor("gpt-5.5")).toBe(400_000);
    expect(contextWindowFor("gpt-5.5-2026-04-23")).toBe(400_000);
  });

  test("gpt-5.4 mini and nano resolve to 400k", () => {
    expect(contextWindowFor("gpt-5.4-mini")).toBe(400_000);
    expect(contextWindowFor("gpt-5.4-nano")).toBe(400_000);
  });

  test("gemini-3.5 and 3.1 family resolve to 1M", () => {
    expect(contextWindowFor("gemini-3.5-flash")).toBe(1_000_000);
    expect(contextWindowFor("gemini-3.1-pro-preview")).toBe(1_000_000);
    expect(contextWindowFor("gemini-3.1-flash-lite")).toBe(1_000_000);
  });
});

describe("contextUsage", () => {
  test("returns ratio + window when both known", () => {
    const u = contextUsage("gpt-4o-mini", 64_000);
    expect(u).not.toBeNull();
    expect(u!.window).toBe(128_000);
    expect(u!.ratio).toBeCloseTo(0.5, 5);
  });

  test("clamps ratio to 1.0 when usage exceeds window", () => {
    const u = contextUsage("gpt-4o-mini", 200_000);
    expect(u!.ratio).toBe(1.0);
  });

  test("returns null for unknown model", () => {
    expect(contextUsage("not-a-real-model", 100)).toBeNull();
    expect(contextUsage(null, 100)).toBeNull();
  });

  test("returns null when input tokens are zero or negative", () => {
    expect(contextUsage("gpt-4o-mini", 0)).toBeNull();
    expect(contextUsage("gpt-4o-mini", -1)).toBeNull();
  });
});
