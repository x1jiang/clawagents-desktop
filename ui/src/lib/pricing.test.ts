import { describe, test, expect } from "vitest";
import { estimateCostUsd, formatCostUsd, priceFor } from "./pricing";

describe("priceFor", () => {
  test("exact match", () => {
    expect(priceFor("gpt-4o-mini")?.input).toBe(0.15);
  });

  test("prefix match for dated model id", () => {
    expect(priceFor("gpt-4o-mini-2024-07-18")?.input).toBe(0.15);
  });

  test("longest prefix wins", () => {
    // claude-opus-4-7 should beat claude-opus-4
    expect(priceFor("claude-opus-4-7")?.input).toBe(15.0);
  });

  test("unknown model returns null", () => {
    expect(priceFor("totally-made-up")).toBeNull();
  });

  test("null/undefined input returns null", () => {
    expect(priceFor(null)).toBeNull();
    expect(priceFor(undefined)).toBeNull();
  });
});

describe("estimateCostUsd", () => {
  test("known model: gpt-4o-mini, no cached input", () => {
    const cost = estimateCostUsd("gpt-4o-mini", {
      input_tokens: 1_000_000,
      output_tokens: 1_000_000,
      cached_input_tokens: 0,
    });
    // 1M input @ $0.15 + 1M output @ $0.60 = $0.75
    expect(cost).toBeCloseTo(0.75, 5);
  });

  test("cached input uses cheaper rate", () => {
    const cost = estimateCostUsd("gpt-4o-mini", {
      input_tokens: 1_000_000,
      output_tokens: 0,
      cached_input_tokens: 1_000_000,
    });
    // 1M cached input @ $0.075 = $0.075
    expect(cost).toBeCloseTo(0.075, 5);
  });

  test("unknown model returns null", () => {
    expect(
      estimateCostUsd("totally-made-up", { input_tokens: 100, output_tokens: 100, cached_input_tokens: 0 }),
    ).toBeNull();
  });
});

describe("formatCostUsd", () => {
  test("very small cost", () => {
    expect(formatCostUsd(0.001)).toBe("<$0.01");
  });

  test("small cost shows three decimals", () => {
    expect(formatCostUsd(0.123)).toBe("$0.123");
  });

  test("dollars show two decimals", () => {
    expect(formatCostUsd(12.345)).toBe("$12.35");
  });
});
