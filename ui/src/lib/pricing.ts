/**
 * Per-million-token prices in USD. Mirrors clawagents_vscode's
 * `webview/src/pricing.ts` / `python/pricing.py`, which are the maintained
 * tables — keep the three in sync when rates change.
 *
 * Prices are best-effort snapshots and may drift as providers update their
 * rates: treat the resulting cost numbers as estimates, never invoices.
 *
 * Four rates per model, because a long agent turn spends most of its input
 * budget on cache traffic and billing that at the list input rate is off by a
 * large factor:
 *   input       — uncached prompt tokens
 *   cachedInput — prompt-cache reads (~10% of input)
 *   cacheWrite  — prompt-cache writes (1.25× input; the 0.25× is the premium)
 *   output      — completion tokens
 *
 * Bedrock / Mantle is a separate table: Claude is at parity with Anthropic
 * direct, OpenAI-on-Bedrock is ~+10%. GovCloud rates are a different table
 * again and are deliberately not modelled here.
 */

export interface Price {
  input: number;
  output: number;
  cachedInput: number;
  cacheWrite: number;
}

function withCache(input: number, output: number, cached?: number, write?: number): Price {
  return {
    input,
    output,
    cachedInput: cached ?? input * 0.1,
    cacheWrite: write ?? input * 1.25,
  };
}

/** Direct-from-provider list prices. */
const PRICES: Record<string, Price> = {
  // OpenAI. GPT-5.6 luna/terra were cut on 2026-07-30; sol unchanged.
  "gpt-5.6": withCache(5, 30, 0.5, 6.25),
  "gpt-5.6-sol": withCache(5, 30, 0.5, 6.25),
  "gpt-5.6-terra": withCache(2, 12, 0.2, 2.5),
  "gpt-5.6-luna": withCache(0.2, 1.2, 0.02, 0.25),
  "gpt-5.5": withCache(5, 30, 0.5, 6.25),
  "gpt-5.5-pro": withCache(30, 180, 3, 37.5),
  "gpt-5.4": withCache(2.5, 15, 0.25, 3.125),
  "gpt-5.4-mini": withCache(0.75, 4.5, 0.075, 0.9375),
  "gpt-5.4-nano": withCache(0.2, 1.25, 0.02, 0.25),
  "gpt-5.4-pro": withCache(30, 180, 3, 37.5),
  "gpt-4o": withCache(2.5, 10, 1.25, 3.125),
  "gpt-4o-mini": withCache(0.15, 0.6, 0.075, 0.1875),
  "gpt-4.1": withCache(2, 8),
  "gpt-4.1-mini": withCache(0.4, 1.6),
  "gpt-4.1-nano": withCache(0.1, 0.4),
  o3: withCache(2, 8),
  "o3-mini": withCache(1.1, 4.4),
  "o4-mini": withCache(1.1, 4.4),
  // Anthropic
  "claude-opus-4": withCache(5, 25, 0.5, 6.25),
  "claude-opus-4-5": withCache(5, 25, 0.5, 6.25),
  "claude-opus-4-6": withCache(5, 25, 0.5, 6.25),
  "claude-opus-4-7": withCache(5, 25, 0.5, 6.25),
  "claude-opus-4-8": withCache(5, 25, 0.5, 6.25),
  "claude-sonnet-4": withCache(3, 15, 0.3, 3.75),
  "claude-sonnet-4-5": withCache(3, 15, 0.3, 3.75),
  "claude-sonnet-4-6": withCache(3, 15, 0.3, 3.75),
  "claude-sonnet-5": withCache(2, 10, 0.2, 2.5),
  "claude-haiku-4-5": withCache(1, 5, 0.1, 1.25),
  "claude-haiku-4-5-20251001": withCache(1, 5, 0.1, 1.25),
  // Google Gemini
  "gemini-3.6-flash": withCache(1.5, 7.5),
  "gemini-3.5-flash": withCache(1.5, 9),
  "gemini-3.5-flash-lite": withCache(0.3, 2.5),
  "gemini-3.1-pro-preview": withCache(2, 12),
  "gemini-3.1-flash-lite": withCache(0.25, 1.5),
  "gemini-3-flash-preview": withCache(0.5, 3),
  "gemini-2.5-pro": withCache(1.25, 10),
  "gemini-2.5-flash": withCache(0.3, 2.5),
  "gemini-2.0-flash": withCache(0.1, 0.4),
  // xAI Grok — short-context (<200K) from https://docs.x.ai/developers/pricing
  "grok-4.5": withCache(2, 6, 0.3, 2.5),
  "grok-4.3": withCache(1.25, 2.5, 0.2, 1.5625),
  "grok-4.20-0309-reasoning": withCache(1.25, 2.5, 0.2, 1.5625),
  "grok-4.20-0309-non-reasoning": withCache(1.25, 2.5, 0.2, 1.5625),
  "grok-4.20-multi-agent-0309": withCache(1.25, 2.5, 0.2, 1.5625),
  "grok-4.20": withCache(1.25, 2.5, 0.2, 1.5625),
  "grok-build-0.1": withCache(1, 2, 0.2, 1.25),
  "grok-build": withCache(1, 2, 0.2, 1.25),
};

/** Bedrock / Mantle US Standard on-demand (aws.amazon.com/bedrock/pricing/). */
const BEDROCK_PRICES: Record<string, Price> = {
  "claude-opus-4": withCache(5, 25, 0.5, 6.25),
  "claude-opus-4-5": withCache(5, 25, 0.5, 6.25),
  "claude-opus-4-6": withCache(5, 25, 0.5, 6.25),
  "claude-opus-4-7": withCache(5, 25, 0.5, 6.25),
  "claude-opus-4-8": withCache(5, 25, 0.5, 6.25),
  "claude-sonnet-4": withCache(3, 15, 0.3, 3.75),
  "claude-sonnet-4-5": withCache(3, 15, 0.3, 3.75),
  "claude-sonnet-4-6": withCache(3, 15, 0.3, 3.75),
  "claude-sonnet-5": withCache(2, 10, 0.2, 2.5),
  "claude-haiku-4-5": withCache(1, 5, 0.1, 1.25),
  "gpt-5.6": withCache(5.5, 33, 0.55, 6.875),
  "gpt-5.6-sol": withCache(5.5, 33, 0.55, 6.875),
  "gpt-5.6-terra": withCache(2.2, 13.2, 0.22, 2.75),
  "gpt-5.6-luna": withCache(0.22, 1.32, 0.022, 0.275),
  "gpt-5.5": withCache(5.5, 33, 0.55, 6.875),
  "gpt-5.4": withCache(2.75, 16.5, 0.275, 3.4375),
  "gpt-oss-20b": withCache(0.07, 0.3),
  "gpt-oss-120b": withCache(0.15, 0.6),
  "gpt-oss-safeguard-20b": withCache(0.07, 0.2),
  "gpt-oss-safeguard-120b": withCache(0.15, 0.6),
  "grok-4.5": withCache(2, 6, 0.3, 2.5),
  "grok-4.3": withCache(1.25, 2.5, 0.2, 1.5625),
  "grok-4.20-0309-reasoning": withCache(1.25, 2.5, 0.2, 1.5625),
  "grok-4.20-0309-non-reasoning": withCache(1.25, 2.5, 0.2, 1.5625),
  "grok-4.20-multi-agent-0309": withCache(1.25, 2.5, 0.2, 1.5625),
  "grok-4.20": withCache(1.25, 2.5, 0.2, 1.5625),
  "grok-build-0.1": withCache(1, 2, 0.2, 1.25),
  "grok-build": withCache(1, 2, 0.2, 1.25),
  "deepseek.v3.2": withCache(0.62, 1.85),
  "deepseek.v3.1": withCache(0.6, 1.73),
  "kimi-k2.5": withCache(0.6, 3),
  "kimi-k2-thinking": withCache(0.6, 2.5),
  "glm-5": withCache(1, 3.2),
  "glm-4.7": withCache(0.6, 2.2),
  "glm-4.7-flash": withCache(0.07, 0.4),
  "glm-4.6": withCache(0.6, 2.2),
};

const GEO_PREFIXES = ["global.", "us.", "eu.", "apac.", "ap.", "af.", "me.", "ca.", "sa."] as const;
const PROVIDER_DOT_PREFIXES = [
  "anthropic.",
  "openai.",
  "amazon.",
  "meta.",
  "mistral.",
  "cohere.",
  "ai21.",
  "xai.",
  "moonshot.",
  "moonshotai.",
  "zai.",
] as const;
// DeepSeek's Mantle ids are literally "deepseek.v3.2" — the dot is part of the
// key, not a provider prefix, so stripping it would lose the match.
const MANTLE_KEEP_DOT_PREFIXES = ["deepseek."] as const;

function looksBedrock(modelId: string): boolean {
  const m = modelId.trim().toLowerCase();
  if (!m) return false;
  if (m.startsWith("bedrock/") || m.startsWith("bedrock.")) return true;
  if (GEO_PREFIXES.some((p) => m.startsWith(p))) return true;
  if (PROVIDER_DOT_PREFIXES.some((p) => m.startsWith(p))) return true;
  if (MANTLE_KEEP_DOT_PREFIXES.some((p) => m.startsWith(p))) return true;
  return false;
}

/** Strip gateway/geo/provider decoration down to the bare model id. */
export function normalizeModelId(modelId: string): string {
  let key = modelId.trim().toLowerCase();
  if (!key) return key;
  if (key.startsWith("bedrock/")) key = key.slice("bedrock/".length);
  for (const p of GEO_PREFIXES) {
    if (key.startsWith(p)) {
      key = key.slice(p.length);
      break;
    }
  }
  if (MANTLE_KEEP_DOT_PREFIXES.some((p) => key.startsWith(p))) {
    if (key.includes(":")) key = key.split(":", 1)[0]!;
    return key;
  }
  for (const p of PROVIDER_DOT_PREFIXES) {
    if (key.startsWith(p)) {
      key = key.slice(p.length);
      break;
    }
  }
  if (key.includes(":")) key = key.split(":", 1)[0]!;
  return key;
}

function lookupTable(table: Record<string, Price>, key: string): Price | null {
  if (table[key]) return table[key]!;
  // Longest matching prefix wins, but only at a separator: "gpt-4o-mini-2024"
  // must not resolve against "gpt-4o", whose input rate is 16× higher.
  let best: Price | null = null;
  let bestLen = -1;
  for (const [prefix, rates] of Object.entries(table)) {
    if (key.startsWith(`${prefix}-`) || key.startsWith(`${prefix}_`)) {
      if (prefix.length > bestLen) {
        best = rates;
        bestLen = prefix.length;
      }
    }
  }
  return best;
}

/**
 * Rates for a model id, or null when unknown. Callers must render nothing for
 * null rather than $0.00 — a confident zero is worse than a blank.
 */
export function priceFor(
  model: string | undefined | null,
  provider?: string | null,
): Price | null {
  if (!model) return null;
  const raw = model.trim();
  const key = normalizeModelId(raw);
  if (!key || key === "default") return null;
  const prov = (provider || "").trim().toLowerCase();
  const forceBedrock = ["bedrock", "mantle", "amazon", "aws"].includes(prov);
  const primary = forceBedrock || looksBedrock(raw) ? BEDROCK_PRICES : PRICES;
  const hit = lookupTable(primary, key);
  if (hit) return hit;
  const other = primary === BEDROCK_PRICES ? PRICES : BEDROCK_PRICES;
  return lookupTable(other, key);
}

/** GPT-5.6: >272K → 2× input-side, 1.5× output. xAI Grok: ≥200K → 2× all. */
const LONG_CONTEXT_THRESHOLD_GPT56 = 272_000;
const LONG_CONTEXT_THRESHOLD_GROK = 200_000;
const LONG_CONTEXT_INPUT_MULT = 2;
const LONG_CONTEXT_OUTPUT_MULT_GPT56 = 1.5;
const LONG_CONTEXT_OUTPUT_MULT_GROK = 2;

function isGpt56Family(modelId: string): boolean {
  return normalizeModelId(modelId).includes("gpt-5.6");
}

function isGrokFamily(modelId: string): boolean {
  return normalizeModelId(modelId).startsWith("grok");
}

function longContextMultipliers(
  modelId: string,
  promptTokens: number,
): { input: number; output: number } | null {
  const prompt = Math.max(0, promptTokens || 0);
  if (isGpt56Family(modelId) && prompt > LONG_CONTEXT_THRESHOLD_GPT56) {
    return { input: LONG_CONTEXT_INPUT_MULT, output: LONG_CONTEXT_OUTPUT_MULT_GPT56 };
  }
  if (isGrokFamily(modelId) && prompt >= LONG_CONTEXT_THRESHOLD_GROK) {
    return { input: LONG_CONTEXT_INPUT_MULT, output: LONG_CONTEXT_OUTPUT_MULT_GROK };
  }
  return null;
}

export interface UsageCounts {
  input_tokens: number;
  output_tokens: number;
  cached_input_tokens: number;
  /** Prompt-cache writes. Optional so existing call sites keep type-checking. */
  cache_creation_tokens?: number;
}

/**
 * Estimate cost in USD from token counts. Returns null when the model is
 * unknown — the caller should hide the cost rather than show $0.00.
 *
 * `input_tokens` is the whole prompt; `cached_input_tokens` is the part of it
 * served from cache. Cache *writes* are billed on top of the normal input rate,
 * so only the premium (write − input) is added for them — charging the full
 * write rate would double-count tokens already billed as prompt.
 */
export function estimateCostUsd(
  model: string | undefined | null,
  usage: UsageCounts,
  provider?: string | null,
): number | null {
  const rates = priceFor(model, provider);
  if (!rates) return null;

  const prompt = Math.max(0, usage.input_tokens || 0);
  const completion = Math.max(0, usage.output_tokens || 0);
  const cached = Math.min(Math.max(0, usage.cached_input_tokens || 0), prompt);
  const uncached = prompt - cached;
  const creation = Math.max(0, usage.cache_creation_tokens || 0);

  let inp = rates.input;
  let out = rates.output;
  let cachedRate = rates.cachedInput;
  let writeRate = rates.cacheWrite;
  const mults = longContextMultipliers(model || "", prompt);
  if (mults) {
    inp *= mults.input;
    cachedRate *= mults.input;
    writeRate *= mults.input;
    out *= mults.output;
  }
  const writePremium = Math.max(0, writeRate - inp);

  return (
    (uncached / 1_000_000) * inp +
    (cached / 1_000_000) * cachedRate +
    (creation / 1_000_000) * writePremium +
    (completion / 1_000_000) * out
  );
}

export function formatCostUsd(cost: number): string {
  if (cost < 0.01) return `<$0.01`;
  if (cost < 1) return `$${cost.toFixed(3)}`;
  return `$${cost.toFixed(2)}`;
}
