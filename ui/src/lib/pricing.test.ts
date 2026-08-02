import { describe, test, expect } from "vitest";
import { estimateCostUsd, formatCostUsd, normalizeModelId, priceFor } from "./pricing";

describe("priceFor", () => {
  test("exact match", () => {
    expect(priceFor("gpt-4o-mini")?.input).toBe(0.15);
  });

  test("prefix match for dated model id", () => {
    expect(priceFor("gpt-4o-mini-2024-07-18")?.input).toBe(0.15);
  });

  test("prefix match only at a separator", () => {
    // "gpt-4o-mini-…" must resolve to gpt-4o-mini (0.15), never to gpt-4o (2.50).
    expect(priceFor("gpt-4o-mini-2024-07-18")?.input).not.toBe(2.5);
  });

  test("longest prefix wins", () => {
    expect(priceFor("claude-opus-4-7")?.input).toBe(5.0);
    expect(priceFor("claude-opus-4-7")?.output).toBe(25.0);
  });

  test("unknown model returns null", () => {
    expect(priceFor("totally-made-up")).toBeNull();
  });

  test("null/undefined input returns null", () => {
    expect(priceFor(null)).toBeNull();
    expect(priceFor(undefined)).toBeNull();
  });

  test('"default" is not a model', () => {
    expect(priceFor("default")).toBeNull();
  });

  test("Mantle catalog ids resolve AWS list prices", () => {
    expect(priceFor("xai.grok-4.3")?.input).toBe(1.25);
    expect(priceFor("xai.grok-4.3")?.output).toBe(2.5);
    expect(priceFor("deepseek.v3.2")?.input).toBe(0.62);
    expect(priceFor("openai.gpt-oss-20b")?.input).toBe(0.07);
  });

  test("geo-prefixed Bedrock ids normalize", () => {
    expect(priceFor("us.anthropic.claude-sonnet-4-6")?.input).toBe(3.0);
    expect(priceFor("global.anthropic.claude-haiku-4-5")?.input).toBe(1.0);
  });

  test("Bedrock/Mantle OpenAI carries the ~10% uplift", () => {
    expect(priceFor("gpt-5.6-luna")?.input).toBe(0.2);
    expect(priceFor("openai.gpt-5.6-luna")?.input).toBeCloseTo(0.22, 6);
    expect(priceFor("gpt-5.6-luna", "bedrock")?.input).toBeCloseTo(0.22, 6);
  });

  test("every model carries all four rates", () => {
    const p = priceFor("claude-sonnet-4-6")!;
    expect(p.cachedInput).toBe(0.3);
    expect(p.cacheWrite).toBe(3.75);
  });
});

describe("normalizeModelId", () => {
  test("strips geo and provider prefixes", () => {
    expect(normalizeModelId("us.anthropic.claude-opus-4-7")).toBe("claude-opus-4-7");
    expect(normalizeModelId("bedrock/openai.gpt-5.6-sol")).toBe("gpt-5.6-sol");
  });

  test("keeps the dot for deepseek, whose id contains one", () => {
    expect(normalizeModelId("deepseek.v3.2")).toBe("deepseek.v3.2");
  });

  test("drops a trailing :version suffix", () => {
    expect(normalizeModelId("anthropic.claude-sonnet-4-6:0")).toBe("claude-sonnet-4-6");
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

  test("cached input uses the cheaper rate", () => {
    const cost = estimateCostUsd("gpt-4o-mini", {
      input_tokens: 1_000_000,
      output_tokens: 0,
      cached_input_tokens: 1_000_000,
    });
    expect(cost).toBeCloseTo(0.075, 5);
  });

  test("cache writes add only the premium over the input rate", () => {
    const base = estimateCostUsd("claude-sonnet-4-6", {
      input_tokens: 1_000_000,
      output_tokens: 0,
      cached_input_tokens: 0,
    })!;
    const withWrite = estimateCostUsd("claude-sonnet-4-6", {
      input_tokens: 1_000_000,
      output_tokens: 0,
      cached_input_tokens: 0,
      cache_creation_tokens: 1_000_000,
    })!;
    // cacheWrite 3.75 − input 3.00 = 0.75 premium per 1M, not the full 3.75.
    expect(withWrite - base).toBeCloseTo(0.75, 5);
  });

  test("omitting cache_creation_tokens matches passing zero", () => {
    const a = estimateCostUsd("claude-sonnet-4-6", {
      input_tokens: 500_000, output_tokens: 1000, cached_input_tokens: 0,
    });
    const b = estimateCostUsd("claude-sonnet-4-6", {
      input_tokens: 500_000, output_tokens: 1000, cached_input_tokens: 0,
      cache_creation_tokens: 0,
    });
    expect(a).toBe(b);
  });

  test("cached tokens are clamped to the prompt size", () => {
    const cost = estimateCostUsd("gpt-4o-mini", {
      input_tokens: 1000,
      output_tokens: 0,
      cached_input_tokens: 999_999,
    })!;
    // Never negative, never billing more cached tokens than were sent.
    expect(cost).toBeGreaterThanOrEqual(0);
    expect(cost).toBeCloseTo((1000 / 1_000_000) * 0.075, 9);
  });

  test("GPT-5.6 above 272K applies 2x input / 1.5x output", () => {
    const under = estimateCostUsd("gpt-5.6-luna", {
      input_tokens: 272_000, output_tokens: 10_000, cached_input_tokens: 0,
    })!;
    const over = estimateCostUsd("gpt-5.6-luna", {
      input_tokens: 300_000, output_tokens: 10_000, cached_input_tokens: 0,
    })!;
    expect(under).toBeCloseTo((272_000 / 1e6) * 0.2 + (10_000 / 1e6) * 1.2, 9);
    expect(over).toBeCloseTo((300_000 / 1e6) * 0.4 + (10_000 / 1e6) * 1.8, 9);
  });

  test("Grok at or above 200K applies 2x input and output", () => {
    const under = estimateCostUsd("grok-4.5", {
      input_tokens: 199_999, output_tokens: 1000, cached_input_tokens: 0,
    })!;
    const over = estimateCostUsd("grok-4.5", {
      input_tokens: 200_000, output_tokens: 1000, cached_input_tokens: 0,
    })!;
    expect(under).toBeCloseTo((199_999 / 1e6) * 2 + (1000 / 1e6) * 6, 9);
    expect(over).toBeCloseTo((200_000 / 1e6) * 4 + (1000 / 1e6) * 12, 9);
  });

  test("the long-context cliff does not apply to other families", () => {
    const cost = estimateCostUsd("claude-sonnet-4-6", {
      input_tokens: 500_000, output_tokens: 1000, cached_input_tokens: 0,
    })!;
    expect(cost).toBeCloseTo((500_000 / 1e6) * 3 + (1000 / 1e6) * 15, 9);
  });

  test("unknown model returns null rather than a confident zero", () => {
    expect(
      estimateCostUsd("totally-made-up", {
        input_tokens: 100, output_tokens: 100, cached_input_tokens: 0,
      }),
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
