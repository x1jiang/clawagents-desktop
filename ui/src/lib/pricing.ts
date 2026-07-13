/**
 * Per-million-token prices in USD for common models. Prices are best-effort
 * snapshots and may drift as providers update their rates — treat the
 * resulting cost numbers as estimates, never invoices.
 *
 * The matching is "longest known prefix wins" so e.g. "gpt-4o-mini-2024-..."
 * still finds the "gpt-4o-mini" entry.
 */

export interface Price {
  input: number;      // USD / 1M input tokens
  cachedInput?: number;  // USD / 1M cached input tokens (if cheaper)
  output: number;     // USD / 1M output tokens
}

const PRICES: Array<[string, Price]> = [
  // OpenAI GPT-5.6 (Sol / Terra / Luna) — list prices as of July 2026
  ["gpt-5.6-sol",   { input: 5.00, output: 30.00 }],
  ["gpt-5.6-terra", { input: 2.50, output: 15.00 }],
  ["gpt-5.6-luna",  { input: 1.00, output: 6.00 }],
  ["gpt-5.6",       { input: 5.00, output: 30.00 }], // alias → Sol
  ["gpt-5.5",       { input: 5.00, output: 30.00 }],
  ["gpt-5.4-nano",  { input: 0.20, output: 1.25 }],
  ["gpt-5.4-mini",  { input: 0.75, output: 4.50 }],
  ["gpt-5.4",       { input: 2.50, output: 15.00 }],
  ["gpt-4o-mini",   { input: 0.15, cachedInput: 0.075, output: 0.60 }],
  ["gpt-4o",        { input: 2.50, cachedInput: 1.25,  output: 10.00 }],
  ["gpt-4.1-nano",  { input: 0.10,                     output: 0.40 }],
  ["gpt-4.1-mini",  { input: 0.40,                     output: 1.60 }],
  ["gpt-4.1",       { input: 2.00,                     output: 8.00 }],
  ["o4-mini",       { input: 1.10,                     output: 4.40 }],
  ["o3-mini",       { input: 1.10,                     output: 4.40 }],
  ["o3",            { input: 2.00,                     output: 8.00 }],
  // Anthropic
  ["claude-opus-4-7",    { input: 15.00, cachedInput: 1.50, output: 75.00 }],
  ["claude-opus-4-6",    { input: 15.00, cachedInput: 1.50, output: 75.00 }],
  ["claude-opus-4",      { input: 15.00, cachedInput: 1.50, output: 75.00 }],
  ["claude-sonnet-4-6",  { input: 3.00,  cachedInput: 0.30, output: 15.00 }],
  ["claude-sonnet-4",    { input: 3.00,  cachedInput: 0.30, output: 15.00 }],
  ["claude-haiku-4-5",   { input: 1.00,  cachedInput: 0.10, output: 5.00 }],
  ["claude-haiku-4",     { input: 1.00,  cachedInput: 0.10, output: 5.00 }],
  // Google Gemini
  ["gemini-3.5-flash",       { input: 1.50, output: 9.00 }],
  ["gemini-3.1-pro-preview", { input: 2.00, output: 12.00 }],
  ["gemini-3.1-flash-lite",  { input: 0.25, output: 1.50 }],
  ["gemini-3-flash-preview", { input: 0.50, output: 3.00 }],
  ["gemini-2.5-pro",         { input: 1.25, output: 10.00 }],
  ["gemini-2.5-flash",       { input: 0.30, output: 2.50 }],
  ["gemini-2.0-flash",       { input: 0.10, output: 0.40 }],
];

export function priceFor(model: string | undefined | null): Price | null {
  if (!model) return null;
  // Find the longest matching prefix.
  let best: Price | null = null;
  let bestLen = 0;
  for (const [prefix, price] of PRICES) {
    if (model.startsWith(prefix) && prefix.length > bestLen) {
      best = price;
      bestLen = prefix.length;
    }
  }
  return best;
}

export interface UsageCounts {
  input_tokens: number;
  output_tokens: number;
  cached_input_tokens: number;
}

/**
 * Estimate cost in USD from token counts. Returns null when the model is
 * unknown — the caller should hide the cost rather than show $0.00.
 */
export function estimateCostUsd(model: string | undefined | null, usage: UsageCounts): number | null {
  const p = priceFor(model);
  if (!p) return null;
  const cached = Math.min(usage.cached_input_tokens, usage.input_tokens);
  const uncached = usage.input_tokens - cached;
  const cachedRate = p.cachedInput ?? p.input;
  const costMicro =
    uncached * p.input +
    cached * cachedRate +
    usage.output_tokens * p.output;
  return costMicro / 1_000_000;
}

export function formatCostUsd(cents: number): string {
  if (cents < 0.01) return `<$0.01`;
  if (cents < 1) return `$${cents.toFixed(3)}`;
  return `$${cents.toFixed(2)}`;
}
