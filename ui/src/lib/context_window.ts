/**
 * Per-model context-window sizes used by the auto-compact hint. Like the
 * pricing table this is a snapshot — providers shift these limits over time,
 * so treat output as a hint, not a guarantee.
 *
 * Longest-prefix-wins matching keeps dated model ids (e.g. gpt-4o-mini-2024-…)
 * mapping to their family entry.
 */

const WINDOWS: Array<[string, number]> = [
  // OpenAI — GPT-5.6 advertises ~1.05M; earlier GPT-5.x is 400K; 4o is 128K.
  ["gpt-5.6",     1_050_000],
  ["gpt-5.5",     400_000],
  ["gpt-5.4",     400_000],
  ["gpt-5.2",     400_000],
  ["gpt-5",       400_000],
  ["gpt-4o-mini", 128_000],
  ["gpt-4o",      128_000],
  ["gpt-4.1",     1_000_000],
  ["o4-mini",     200_000],
  ["o3-mini",     200_000],
  ["o3",          200_000],
  // Anthropic — 4.x family caps at 200K by default, opus at 1M with caching.
  ["claude-opus-4-7",   1_000_000],
  ["claude-opus-4-6",   1_000_000],
  ["claude-opus-4",     200_000],
  ["claude-sonnet-4-6", 1_000_000],
  ["claude-sonnet-4",   200_000],
  ["claude-haiku-4-5",  200_000],
  ["claude-haiku-4",    200_000],
  // Gemini — 3.x / 2.5 family ~1M.
  ["gemini-3.6",       1_000_000],
  ["gemini-3.5",       1_000_000],
  ["gemini-3.1",       1_000_000],
  ["gemini-3",         1_000_000],
  ["gemini-2.5-pro",   1_000_000],
  ["gemini-2.5-flash", 1_000_000],
  ["gemini-2.0-flash", 1_000_000],
];

export function contextWindowFor(model: string | undefined | null): number | null {
  if (!model) return null;
  let best: number | null = null;
  let bestLen = 0;
  for (const [prefix, size] of WINDOWS) {
    if (model.startsWith(prefix) && prefix.length > bestLen) {
      best = size;
      bestLen = prefix.length;
    }
  }
  return best;
}

/**
 * Decide whether to surface an auto-compact hint. Returns null if the model
 * is unknown or usage is comfortably under the soft threshold (75%).
 */
export function compactHint(
  model: string | undefined | null,
  inputTokensThisTurn: number,
): { ratio: number; window: number } | null {
  const window = contextWindowFor(model);
  if (window === null) return null;
  // Per-turn `input_tokens` is roughly the context the model just had to read.
  const ratio = inputTokensThisTurn / window;
  if (ratio < 0.75) return null;
  return { ratio, window };
}

/**
 * Always-on usage ratio for the context meter. Unlike `compactHint`, this
 * returns at any usage level (so the meter can show 12% as well as 87%).
 * Returns null for unknown models or non-positive token counts so the meter
 * can hide gracefully when usage data isn't meaningful yet.
 */
export function contextUsage(
  model: string | undefined | null,
  inputTokensThisTurn: number,
): { ratio: number; window: number } | null {
  if (inputTokensThisTurn <= 0) return null;
  const window = contextWindowFor(model);
  if (window === null) return null;
  // Clamp to 1.0 so the bar can't overflow when usage briefly exceeds the
  // catalog value (provider raised the cap, or tokenizer estimate differs).
  const ratio = Math.min(1.0, inputTokensThisTurn / window);
  return { ratio, window };
}
